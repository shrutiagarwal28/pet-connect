# Matching & Ranking Logic — Implementation Spec

> Design doc — 2026-07-20. Pseudocode only, no code. Written to be implementable by a
> second engineer without questions.
>
> Inputs: `matching-dimension-contract.md` (tiers, null-trap rule),
> `fetchr-data-contract.md` (live columns — **only** these exist),
> `adopter-erd.md` (adopter tables), `matching-app-api.md` (endpoints that call this).
>
> **Scope discipline:** everything below uses only columns that exist in the live DB
> today: `size_enc`, `age_years_imputed`/`age_was_imputed`, `coat_type_enc`,
> `breed_group`, and the `*_enc` trits. The Phase 5 `*_score` dimensions appear only
> in §9 (Future), clearly marked. Location scoring is absent because it is blocked
> (lat/lng 100% NULL — contract §3.1), not because it was forgotten.

---

## 0. Shared pipeline shape

Both the feed and chatbot search run the same four stages; they differ only in stages
1 (extra constraints) and 4 (boosts, no diversity):

```
candidates = tier1_hard_filter(adopter [, parsed_constraints])   -- SQL WHERE, contract §2
candidates = exclude_seen(adopter, candidates)                   -- feed only, not search
scored     = score(adopter, candidates)                          -- §2 cold or §4 warm
page       = order_and_page(scored)                              -- §3 diversity (cold feed only)
```

Constants introduced below are gathered in §8 with tuning notes. All scores are
clamped to `[0, 1]` before leaving the scorer.

**Seen-exclusion note:** search does *not* exclude seen dogs (an adopter searching
"that husky I saw" must find it). The feed always excludes any dog with **any** event
row for this adopter.

---

## 1. Event weights (input to everything learned)

Per the design doc's signal-strength table, mapped to numbers:

| event_type | weight `w_e` | role |
|---|---|---|
| `contact_shelter` | 3.0 | positive |
| `save_to_watchlist` | 2.0 | positive |
| `right_swipe` | 1.0 | positive |
| `view_detail` with `duration_seconds >= 10` | 0.3 | positive |
| `view_detail` with `duration_seconds < 10` | 0.0 | ignored |
| `left_swipe` | 1.0 | **negative** (used only where §4 says so) |
| `dismiss_from_watchlist` | 1.5 | **negative** (stronger: changed mind after interest) |
| `explicit_answer` | n/a | not a scoring event — writes `adopter_preferences` directly |

A dog with multiple positive events from the same adopter counts once, at its
**highest** weight (a saved-then-contacted dog is one very-positive example, not
three examples). A positive followed by `dismiss_from_watchlist` flips that dog to
negative.

No recency decay in MVP (open — §10.1): all events in the learning window count
equally. The window is the adopter's **last 100 weighted events** (cheap via
`ix_interactions_adopter_time`).

---

## 2. Cold-start ranking (`is_cold_start = true`)

Two signals, combined into one 0–1 `match_score`.

### 2.1 Popularity term

```
saves(d)      = COUNT(*) FROM adopter_interactions
                WHERE dog_profile_id = d
                  AND event_type = 'save_to_watchlist'
                  AND event_at >= now() - INTERVAL '30 days'
                -- served by partial index ix_interactions_saves
max_saves     = MAX(saves(d)) over the candidate pool (post-Tier-1)

pop(d)        = ln(1 + saves(d)) / ln(1 + max_saves)      if max_saves > 0
              = ABSENT                                     if max_saves = 0
```

Log damping so one viral dog doesn't flatten everything else to ~0, and the
early-days difference between 1 and 3 saves stays visible. 30-day window so a dog
popular in May doesn't coast in July; window is a tunable (§8).

### 2.2 Freshness term

```
days_listed(d) = floor(extract(epoch from now() - first_seen_at) / 86400)
fresh(d)       = exp( -ln(2) * days_listed(d) / H )        with H = 14 (half-life, days)
```

Exponential with a 14-day half-life: a just-listed dog scores 1.0, two weeks old
scores 0.5, two months ~0.05. Always defined (`first_seen_at` is NOT NULL — contract
§1.2). Chosen over linear because listings age asymmetrically: the difference between
day 1 and day 10 matters much more than day 60 vs day 70.

### 2.3 Combination — freshness dominates when saves are absent

Weights `W_POP = 0.6`, `W_FRESH = 0.4`. The absence rule from the dimension contract
(open question 3) applies here too: **an absent signal is dropped and the remaining
weights renormalized — never scored as a midpoint.**

```
cold_score(d):
    if pop is ABSENT (max_saves == 0):          -- day one: zero saves anywhere
        return fresh(d)                          -- freshness dominates by construction
    else:
        return 0.6 * pop(d) + 0.4 * fresh(d)
```

Both terms are already in [0,1], so the weighted sum is too — no further
normalization. Day one behavior, explicitly: every dog's score is pure freshness;
ties broken by `id` (deterministic order for cursor stability). Popularity takes
over gradually as saves accumulate, never via a switch.

---

## 3. Diversity injection (cold-start feed only)

Resolves API-doc open question 3. Applied **after** scoring, **only** on the feed,
**only** while `is_cold_start = true`. Search never diversifies (the user asked for
something specific); warm feed never diversifies (preferences are known — §10.4 notes
the exploration follow-up).

### 3.1 Buckets

```
bucket(d) = (size_enc, breed_group)
```

`size_enc` has 4 values, `breed_group` 9 observed values → ≤ 36 buckets; live
inventory occupies far fewer. A NULL `size_enc` (none today, possible per contract)
forms its own `(NULL, group)` bucket — unknown is a category, not an exclusion.

### 3.2 Algorithm — score-ordered round-robin

```
diversify(scored_dogs):                      -- scored_dogs: post-Tier-1, post-seen-exclusion
    groups = group dogs by bucket(d)
    within each group: sort by (cold_score DESC, id ASC)
    order the groups by their best dog's cold_score DESC   -- bucket order fixed once
    sequence = []
    while any group is non-empty:
        for g in group order:                -- one pass = one "round"
            if g non-empty:
                sequence.append(g.pop_front())
    return sequence                          -- pagination cursors index into this
```

Properties, stated so the implementer doesn't have to derive them:

- A page of 20 contains dogs from `min(20, number_of_non-empty_buckets)` distinct
  buckets — the first round touches every bucket once before any bucket repeats.
- The best dog overall is always card 1 (its bucket sorts first, it heads that bucket).
- **Bucket exhaustion:** an empty bucket is simply skipped; remaining buckets keep
  cycling. When all are empty the sequence ends (`next_cursor: null`). No padding, no
  filler, and **never** any relaxation of Tier-1 to fill variety — safety filters
  outrank diversity, always.
- Deterministic given the same underlying data (`id` tie-breaks everywhere), so keyset
  cursors (position = `(round, bucket_index)` equivalent, encoded as the last-emitted
  `(round, bucket_rank, id)`) resume correctly. New saves between requests can shift
  scores and thus drift the tail — accepted, same as any personalized feed (API doc
  cursor semantics).

Why round-robin over quotas ("at least one per size bucket per page"): quotas need
infeasibility rules the moment inventory can't satisfy them; round-robin degrades
continuously with no special cases — the failure mode *is* the algorithm.

---

## 4. Warm-start scoring (`is_cold_start = false`) — existing columns only

A weighted similarity between the adopter's **learned targets** and each dog, over
five dimensions that exist today:

| dim | dog-side column | kind | range span `R` |
|---|---|---|---|
| size | `size_enc` | ordinal 1–4 | 3 |
| age | `age_years_imputed` (+ `age_was_imputed`) | continuous | — (kernel, §4.3) |
| coat | `coat_type_enc` (NULL = unknown) | ordinal 1–3 | 2 |
| breed_group | `breed_group` | nominal | — (affinity, §4.4) |
| house_trained | `house_trained_enc` (trit) | binary-ish | — (§4.5) |

Deliberately **not** scored in MVP: `vaccinated_enc` (93% known-yes — no
discriminating signal), `spayed_neutered_enc` (weak preference signal, mostly an org
policy artifact), `gender` (explicit preference only, §4.7), and the lifestyle
answers (`activity_level`, `home_type`, `experience_level`, `hours_away`) — they have
**no dog-side column to score against until Phase 5** (§9). They are stored, honored
by pop-up suppression, and unused by this scorer. Do not fake a mapping (e.g.
activity→age); that invents data.

### 4.1 Learning the targets (the inference job)

Runs per adopter after every K = 5 interactions (ERD open question 8's "batch"
option; cadence tunable). Reads the last 100 weighted events (§1); writes
`adopter_preferences` fields **only where `*_source` is NULL or `'inferred'`** —
explicit always wins, enforced by the write rule, not by hope.

```
learn(adopter):
    P = positive examples: (dog_features row, w_e) per §1, deduped per dog
    N = negative examples: (dog_features row, w_e)

    -- Ordinal dims (size, coat): weighted mean + inverse-variance importance
    for dim in {size, coat}:
        K = positives where dog value is KNOWN (coat: non-NULL; size: non-NULL)
        n_dim      = |K|
        target_dim = Σ(w_e * value) / Σ(w_e)            over K
        var_dim    = weighted variance of value          over K
        importance_dim = 1 / (1 + var_dim)              -- consistent swipes ⇒ dim matters
        learn_conf_dim = min(1, n_dim / 5)              -- ramp: <5 observations = partial trust

    -- Age: same, over age_years_imputed; observations with age_was_imputed = true
    --      count at half weight (w_e * 0.5) — imputed ages are softer evidence
    target_age, var_age, importance_age, learn_conf_age  as above
    importance_age = 1 / (1 + var_age / 4)              -- variance in years²; /4 keeps
                                                        -- scale comparable to ordinals

    -- Breed affinity: smoothed positive rate, dented by negatives
    for group g in the 9 contract values:
        pos_w(g) = Σ w_e over positives in g
        neg_w(g) = Σ w_e over negatives in g
        aff(g)   = max(0, pos_w(g) - 0.5 * neg_w(g)) + 0.5    -- +0.5 = Laplace-ish smoothing:
                                                              -- unseen groups get a small
                                                              -- nonzero affinity, not zero
    normalize: aff(g) /= max over g                     -- best-liked group = 1.0

    -- house_trained: preference rate among positives with KNOWN value
    ht_pref  = Σ(w_e where enc=1) / Σ(w_e where enc∈{0,1})   -- fraction of liked dogs
    ht_n     = count of those known observations              -- that were house-trained
    learn_conf_ht = min(1, ht_n / 5)
```

**Left swipes** affect **only** breed affinity (and dismissals, which flip a
positive). They do not shift ordinal targets: a left swipe rejects a whole dog, and
attributing that rejection to its size vs. its age vs. its photo is unidentifiable
from one bit. Breed affinity is the exception because it's a rate, not a mean —
negatives dilute a group without pretending we know *why*. (Revisit: §10.3.)

Explicit values from `adopter_preferences` override the learned targets at scoring
time: `preferred_age_range` (explicit) maps to a target age via category midpoints
(`puppy`→0.5, `young`→2, `adult`→5, `senior`→9 years) with `importance = 1.0,
learn_conf = 1.0`; explicit `max_dog_size` is already a Tier-1 cap and *additionally*
sets the size target to the cap value if no swipe-learned target exists yet.

### 4.2–4.5 Per-dimension similarity (each returns `sim ∈ [0,1]` or ABSENT)

```
-- 4.2 ordinals (size, coat):
sim_dim(d) = 1 - |value(d) - target_dim| / R_dim          if value(d) known
           = ABSENT                                        if NULL (coat: 58% today)

-- 4.3 age — Laplacian kernel, gentler than linear over an open range:
sim_age(d) = exp( -|age_years_imputed(d) - target_age| / 2.5 )     -- 2.5-year scale:
             -- 1 year off ≈ 0.67, 3 years off ≈ 0.30
             if age_was_imputed(d): dog_conf_age = 0.5 else 1.0    -- see §5

-- 4.4 breed:
sim_breed(d) = aff(breed_group(d))                        -- always known (100% populated)

-- 4.5 house_trained (trit → null-trap-safe):
sim_ht(d) = ht_pref            if house_trained_enc = 1
          = 1 - ht_pref        if house_trained_enc = 0
          = ABSENT             if house_trained_enc = -1
```

### 4.6 Combination — the weighted, absence-renormalized sum

Base dimension weights (before importance/confidence), MVP starting values:

```
B = { size: 0.25, age: 0.25, breed: 0.25, coat: 0.10, house_trained: 0.15 }
```

```
warm_score(adopter, d):
    for each dim:
        eff_w(dim) = B[dim] * importance_dim * learn_conf_dim * dog_conf_dim
        -- dog_conf_dim = 1.0 normally; 0.5 for imputed age; ABSENT dims drop out entirely
    known = dims where sim is not ABSENT and eff_w > 0
    if known is empty: return 0.5 * completeness(d)        -- nothing learnable matched;
                                                           -- neutral, damped (below)
    base = Σ_{known} eff_w * sim / Σ_{known} eff_w         -- renormalized mean ∈ [0,1]

    -- completeness damping (§5): prefer well-documented dogs *slightly*
    completeness(d) = Σ_{known} B[dim] / Σ_{all} B[dim]
    return base * (0.85 + 0.15 * completeness(d))
```

### 4.7 Gender

If `preferred_gender` is explicit and not `'any'`: multiply the final score by 0.6 on
mismatch (soft, strong — not a filter; gender is never known-unknown so no absence
case). Never inferred in MVP (§10.5).

---

## 5. Absence handling — the one rule, stated once

Resolves dimension-contract open question 3 for the MVP columns:

> **An unknown value contributes nothing — in either direction. It is removed from
> both numerator and denominator (renormalization), never scored as a midpoint. The
> only place absence costs a dog anything is the completeness damping factor, which
> is deliberately mild (max −15%).**

Concretely:

- `coat_type_enc IS NULL` → coat drops from the sum. A "medium-grooming" target does
  **not** score an unknown coat as `sim = 0.5`.
- Any trit `= -1` → that dimension drops (house_trained in the scorer; the
  `good_with_*` trits never reach the scorer — they are Tier-1 and badges).
- `age_was_imputed = true` → age stays but at half weight (`dog_conf = 0.5`): an
  imputed age is weak evidence, not no evidence.
- Adopter-side absence mirrors it: an unlearned dimension (`learn_conf = 0`) drops
  the same way. Symmetry matters — "we don't know the dog" and "we don't know the
  adopter" are the same epistemic state.

Why the damping factor at all: pure renormalization makes a one-known-field dog
score entirely on that field — a fully-unknown-except-breed dog could top the feed on
breed affinity alone. `0.85 + 0.15 * completeness` keeps unknowns competitive (the
null-trap rule) while breaking ties toward documented dogs.

---

## 6. Warm-start threshold N — proposal

**N = 20 weighted interaction events, of which at least 8 are positive (weight ≥ 1.0
per §1). Until both conditions hold, `is_cold_start` stays `true`.**

Reasoning, so it can be argued with rather than re-derived:

- The design doc estimates size preference is learnable in ~10 interactions; but our
  dimensions have missing dog-side values (coat 58% unknown, house_trained 35%
  unknown), so ~20 events yields roughly 8–12 *known* observations on the weaker
  dimensions — right at the `learn_conf` ramp's full-trust point (5) with margin.
- The positive floor matters more than the total: 20 left-swipes teach breed dents
  but no ordinal targets (§4.1 — left swipes don't move means). Without ≥8 positives
  the "targets" would be means of almost nothing.
- Cost asymmetry: flipping early serves a confidently-wrong feed; flipping late
  serves a popular-but-generic one. The second failure is milder, so err high.
- Mechanically it's the decided boolean flip (ERD `is_cold_start`), checked in the
  interaction write path when `total_interactions` crosses candidates of N. A
  blend (`β·warm + (1−β)·cold` ramping over interactions 10→30) is strictly nicer UX
  and strictly more machinery; noted as tuning, not MVP (§7).

---

## 7. Chatbot search — reusing the scorer (API doc §6)

```
search_rank(adopter, parsed_constraints, limit):
    pool = tier1_hard_filter(adopter)               -- safety ALWAYS applies (API rule 2)
             ∧ parsed_constraints                    -- struct fields → parameterized WHERE;
                                                     -- require_good_with_* means
                                                     -- IS DISTINCT FROM 0 (null-trap), per API §6
    -- no seen-exclusion (§0), no diversity injection (§3)

    for d in pool:
        s = cold_score(d)  if adopter.is_cold_start else  warm_score(adopter, d)

        -- rank boosts, additive, applied after the base score:
        for each require_good_with_* = true in constraints:
            if the corresponding *_enc = 1: s += 0.05          -- known-good beats unknown
        matched_terms = description_terms present in dog.description (case-insensitive,
                        parameterized ILIKE / FTS — soft signal only, never a filter)
        s += 0.03 * min(3, |matched_terms|)                    -- cap +0.09

        score(d) = min(1.0, s)

    return top `limit` by (score DESC, id ASC), plus total_matched = |pool|
```

The boosts are the honest complement of the null-trap rule: unknown-compat dogs stay
*in* the results (never excluded for unknownness) but confirmed-compatible dogs rank
above them, and the `not_confirmed` badge tells the adopter why. Breed constraints
are positive-only (API §6, decided 2026-07-20): `breed_groups` narrows the pool;
exclusion is inexpressible, and the scorer needs no special pit-type handling because
the struct can never ask for it.

---

## 8. Constants table (single place to tune)

| Constant | Value | Where | Tuning note |
|---|---|---|---|
| `W_POP` / `W_FRESH` | 0.6 / 0.4 | §2.3 | Raise `W_FRESH` if feed feels stale-heavy once saves accumulate. |
| Save window | 30 days | §2.1 | Widen if inventory turnover slows. |
| Freshness half-life `H` | 14 days | §2.2 | Shorter ⇒ stronger new-dog bias. |
| Event weights | table §1 | §1 | Ratios matter, not absolutes. |
| Learning window | last 100 weighted events | §1 | Proxy for recency decay until §10.1 resolves. |
| Inference cadence K | every 5 interactions | §4.1 | Matches ERD open question 8's lean. |
| `learn_conf` ramp | n/5, cap 1 | §4.1 | Min observations for full trust in a learned target. |
| Base weights `B` | size/age/breed .25, coat .10, ht .15 | §4.6 | First lever for feed-quality tuning. |
| Age kernel scale | 2.5 years | §4.3 | Bigger ⇒ age matters less. |
| Imputed-age conf | 0.5 | §4.3/§5 | |
| Completeness damping | 0.85 + 0.15·c | §4.6/§5 | Keep the floor ≥ 0.85 or the null-trap rule erodes. |
| Warm threshold | N = 20, ≥ 8 positive | §6 | Decided starting value; tune with real cohorts. |
| Gender mismatch factor | 0.6 | §4.7 | |
| Search boosts | +0.05/compat, +0.03/term (cap 3) | §7 | Keep ≤ ~0.15 total so boosts re-order, never dominate. |

---

## 9. FUTURE — Phase 5 `*_score` dimensions (explicitly not implementable today)

When the nine `*_score` columns land in `dog_features` (contract §1.5), the warm
scorer §4 extends rather than changes: each score becomes a dimension with a target
learned exactly like §4.1's ordinals (weighted mean over positives), the lifestyle
answers finally engage (`activity_level`→energy target, `hours_away`→independence/
special-needs capacity, `home_type`→energy+placement_restriction,
`experience_level`→trainability/confidence — the mapping table in
`matching-dimension-contract.md`), and the absence rule §5 already covers them
(bipolar 0 = "no signal" ⇒ ABSENT, per the contract's convention, **not** a valid
midpoint — this is the same rule, pre-decided). Normalization of bipolar (−1..+1) vs
unipolar (0..+1) dims to a shared [0,1] `sim` happens per-dimension before §4.6, per
dimension-contract open question 4 — the renormalized-sum structure needs no change.
None of this is buildable now; do not stub it.

---

## 10. NOT in MVP (explicit, so scope creep has to argue with a list)

1. Phase 5 `*_score` scoring and all lifestyle-answer scoring (§9).
2. Location radius filtering and distance-based ranking (blocked — contract §3.1).
3. Collaborative filtering / user-user similarity (Stage 3), and any use of
   `dog_profile_history` demand signals.
4. Embeddings, pgvector, semantic re-ranking, `free_text_description` matching
   (Stage 4).
5. Recency decay of interaction evidence (window proxy only).
6. Impression logging / feed-position debiasing.
7. Exploration in the warm feed (bandits, ε-greedy diversity) — cold-start diversity
   §3 is the only exploration mechanism.
8. Model-based inference (logistic regression, learned weights) — MVP learning is
   counts, means, and variances on purpose: debuggable, explainable, rebuildable.
9. Popularity debiasing (save counts are position-biased by the feed itself).
10. Reactivity/noise axis (dimension-contract open question 1 — no data source).

---

## 11. Open questions (not resolvable from the docs — listed, not guessed)

1. **Recency decay** of interaction evidence (design-doc open question; §1 uses a
   100-event window as a stopgap). Function and half-life undecided.
2. **Hard flip vs. blend at the warm threshold** (§6 picks the decided flip; whether
   to later blend `β·warm + (1−β)·cold` over interactions 10→30 is a product-feel
   call needing real users).
3. **Should left swipes ever shift ordinal targets?** §4.1 says no
   (unidentifiability); a contrastive scheme (penalize similarity to a left-swipe
   centroid) is defensible too. Needs data to adjudicate.
4. **Warm-feed exploration.** Once cold-start diversity stops, nothing prevents
   preference-loop collapse (the design doc's trap, warm variant). Bandit-style
   exploration is post-MVP (§10.7), but *when* it becomes necessary is unknown.
5. **Gender inference.** MVP treats `preferred_gender` as explicit-only; swipes
   plausibly carry gender signal. Deliberately unlearned — revisit with data.
6. **Search→seen semantics.** Search shows already-seen dogs (§0); should a search
   *result* the adopter then swipes count differently from a feed swipe for learning
   (self-selected pool ⇒ biased evidence)? Related to API open question 5 (searches
   aren't logged as events at all yet).
7. **Popularity position-bias** (§10.9): save counts partly reflect past feed
   placement. Ignorable at 225 dogs / few adopters; the threshold at which it isn't
   is unknown.
8. **Inference-job write skew.** §4.1 runs every K=5 events; a concurrent PATCH
   /preferences (explicit write) between job read and job write could be clobbered
   without row-level guard (e.g. `WHERE *_source IS DISTINCT FROM 'explicit'` on the
   UPDATE, or `SELECT … FOR UPDATE`). The guard belongs in the implementation; which
   mechanism is an engineering choice not settled by any doc.

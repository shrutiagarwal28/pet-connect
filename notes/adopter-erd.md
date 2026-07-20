# Adopter-Side ERD — Full Schema Design

> Design doc — 2026-07-20. No migrations yet; this is the document the first Alembic
> migration will be written from.
>
> Inputs: `fetchr-data-contract.md` (live-verified fetchr surface),
> `matching-app-schema.md` (earlier sketch), `adopter-profile-matching-design.md`
> (product model), `matching-dimension-contract.md` (dimension space).
>
> **Decided constraints honored here (not revisited):**
> - `dog_profile_id` is `VARCHAR(36)` matching fetchr's UUID-string PKs, as a **soft
>   reference** — no FK across the repo boundary.
> - `adopter_interactions` is append-only: no `updated_at`, no UPDATE path;
>   `event_type` enum + JSONB `metadata`.
> - `adopter_preferences` carries a per-field `*_source` column; explicit beats inferred.
> - Adopter-facing PKs are UUIDs — no enumerable IDs in a consumer app.
> - Onboarding collects: `zip_code`, `max_distance_miles`, `has_children`,
>   `youngest_child_age`, `has_existing_dogs`, `has_existing_cats`, **plus** four
>   lifestyle answers (`activity_level`, `home_type`, `experience_level`, `hours_away`)
>   that are stored as **explicit preference rows**, not profile columns.

---

## Entity overview

```
                         fetchr boundary (soft reference only)
                                        ┊
 adopter_profiles 1 ──── * adopter_interactions ┈┈┈┈▶ dog_profiles.id  (VARCHAR(36), no FK)
        │ 1                                     ┊
        │                                       ┊
        └──── 1 adopter_preferences             ┊
        │                                       ┊
        └──── * adopter_question_events * ──── 1 question_trigger_config
```

- `adopter_profiles` — identity + safety facts. Slow-changing. Source of truth for Tier-1.
- `adopter_interactions` — append-only event log. **The irreplaceable table.** Source of
  truth for everything learned.
- `adopter_preferences` — derived/materialized state, 1:1 with profiles. Recomputable
  from interactions + question answers at any time; never the source of truth.
- `question_trigger_config` — static rule config (engineering-owned).
- `adopter_question_events` — per-adopter pop-up history (shown / answered / dismissed).

The split is the event-sourcing shape from the design doc: facts (profiles) + events
(interactions) + projection (preferences). If inference logic changes, the projection
is rebuilt from the log; nothing is lost.

---

## 1. `adopter_profiles`

Slow-changing facts collected at onboarding. Only Tier-1 safety inputs and identity live
here — anything that is a *preference* (even one asked at onboarding) goes to
`adopter_preferences` instead, so this table never needs source-tracking columns.

| Column | Type | Null | Default | Reasoning |
|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | PK. UUID per the no-enumerable-IDs rule; `gen_random_uuid()` is built into PG13+, no extension needed. |
| `email` | `TEXT` | NOT NULL | — | Login/contact identity. Uniqueness enforced on `lower(email)` (see indexes) so `Amy@` and `amy@` can't create two accounts. |
| `zip_code` | `TEXT` | NOT NULL | — | Onboarding. TEXT, not INTEGER — ZIPs have leading zeros (`07302`). Format (5-digit US) validated app-side; a DB `CHECK (zip_code ~ '^\d{5}$')` is a cheap belt-and-braces addition. |
| `lat` | `DOUBLE PRECISION` | NULL | — | Geocoded from `zip_code` at write time (geocode once, not per feed request). Nullable because geocoding can fail; the feed must degrade (no radius clause) rather than block onboarding. Matches fetchr's `lat/lng` types for symmetric distance math. |
| `lng` | `DOUBLE PRECISION` | NULL | — | Same as `lat`. |
| `max_distance_miles` | `INTEGER` | NOT NULL | `50` | Onboarding, with a sane default. `CHECK (max_distance_miles > 0)`. |
| `has_children` | `BOOLEAN` | NOT NULL | — | Tier-1 safety fact. No default — the adopter must answer; a defaulted safety fact is a silent lie. |
| `youngest_child_age` | `INTEGER` | NULL | — | Only meaningful when `has_children`. `CHECK (has_children OR youngest_child_age IS NULL)` keeps the pair consistent; `CHECK (youngest_child_age BETWEEN 0 AND 17)` bounds it. NULL = no children (or not applicable), never "unknown" — onboarding requires it when `has_children = true` (app-side rule). |
| `has_existing_dogs` | `BOOLEAN` | NOT NULL | — | Tier-1 safety fact. No default, same reasoning. |
| `has_existing_cats` | `BOOLEAN` | NOT NULL | — | Tier-1 safety fact. No default. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Audit/cohort analysis. Always TIMESTAMPTZ, never naive timestamps. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Maintained by app code (or trigger) on change. This table *does* update — unlike the event log. |
| `deleted_at` | `TIMESTAMPTZ` | NULL | — | Soft delete (GDPR path deletes/anonymizes PII app-side; the row skeleton keeps `adopter_interactions` FKs valid). NULL = active. |

**Indexes**

```sql
-- PK index comes free.
CREATE UNIQUE INDEX uq_adopter_profiles_email ON adopter_profiles (lower(email));
```

The earlier sketch had an index on `zip_code`; dropped — no query looks adopters up by
ZIP (all access is by `id` from the auth token). Indexes that serve no query are pure
write overhead.

---

## 2. `adopter_interactions`

Append-only event log. INSERT and SELECT only — no UPDATE, no DELETE, no `updated_at`
(an immutable row cannot have one; its absence documents the invariant). This is the
one table that can never be rebuilt from anything else.

| Column | Type | Null | Default | Reasoning |
|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | PK. UUID keeps event IDs non-enumerable if ever exposed (e.g., in support tooling). |
| `adopter_id` | `UUID` | NOT NULL | — | Hard FK → `adopter_profiles(id)`. In-boundary FKs are always hard — the soft-reference rule applies only across the fetchr boundary. No `ON DELETE CASCADE`: profiles are soft-deleted, and the log must survive even that (`ON DELETE RESTRICT` semantics, the FK default, is correct). |
| `dog_profile_id` | `VARCHAR(36)` | NOT NULL | — | **Soft reference** to fetchr's `dog_profiles.id` (UUID string — decided; verified type in `fetchr-data-contract.md` §1.1). No FK across the boundary: repos stay independently deployable, and fetchr hard-deleting a row must never break an insert here. Joins must LEFT JOIN and tolerate a missing dog. |
| `event_type` | `TEXT` | NOT NULL | — | `CHECK (event_type IN ('right_swipe','left_swipe','save_to_watchlist','dismiss_from_watchlist','view_detail','contact_shelter','explicit_answer'))`. TEXT + CHECK over a native `ENUM` type: adding a value is a trivial constraint swap, not an `ALTER TYPE` with transaction caveats. The values are the design doc's list, verbatim. |
| `event_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Server-assigned event time. Client-supplied timestamps are not trusted (clock skew, replay); if client-side capture time ever matters, it goes in `metadata`, clearly second-class. |
| `idempotency_key` | `UUID` | NOT NULL | — | **Decided 2026-07-20.** Client-generated, minted once per user action, resent verbatim on retries. Unique with `adopter_id` (index below); the write path is `INSERT … ON CONFLICT DO NOTHING`, and the API returns `202` either way. This is how an append-only log tolerates retrying mobile clients without duplicate events — dedup happens at insert, since there is no UPDATE path to reconcile with later. Scoped per adopter (not globally) so one client's key reuse can never collide with another's. |
| `metadata` | `JSONB` | NOT NULL | `'{}'` | Per-event payload, shapes as documented in `matching-app-schema.md` (e.g. `view_detail` → `{duration_seconds, source_screen}`, `contact_shelter` → `{contact_url}`, `explicit_answer` → `{question_id, response}`). NOT NULL with `'{}'` default so consumers never branch on NULL-vs-empty. Shape validation is app-side (Pydantic per event type) — JSONB CHECKs for seven shapes would be unmaintainable. |

**Append-only enforcement:** convention plus, once a dedicated app DB role exists,
`REVOKE UPDATE, DELETE ON adopter_interactions FROM app_role`. The invariant should be
in the grants, not just the doc (open question §7.6 on role setup).

**Indexes** — driven by the four real read patterns:

```sql
-- (a) Inference job: "recent events for adopter X, newest first" — the hottest read.
--     Also serves the watchlist read (filter event_type after the index narrows by adopter).
CREATE INDEX ix_interactions_adopter_time
    ON adopter_interactions (adopter_id, event_at DESC);

-- (b) Feed seen-exclusion: "which dog_ids has adopter X already interacted with?"
--     Composite allows an index-only scan producing exactly the anti-join input.
CREATE INDEX ix_interactions_adopter_dog
    ON adopter_interactions (adopter_id, dog_profile_id);

-- Idempotency: dedup target for the ON CONFLICT insert (decided 2026-07-20).
CREATE UNIQUE INDEX uq_interactions_adopter_idem
    ON adopter_interactions (adopter_id, idempotency_key);

-- (c) Cold-start popularity: "save counts per dog across ALL adopters."
--     Partial index — saves are a small fraction of events; scanning only them keeps
--     the popularity aggregate cheap without indexing the whole log a third time.
CREATE INDEX ix_interactions_saves
    ON adopter_interactions (dog_profile_id, event_at)
    WHERE event_type = 'save_to_watchlist';
```

Why not an index on `event_type` alone: seven values, terrible selectivity — every
useful query already narrows by `adopter_id` (patterns a, b) or is served by the
partial index (c). Pattern (d), "count interactions since last preference recompute,"
rides on (a).

Trigger evaluation ("3 right-swipes on large dogs this session") also rides on (a):
it's always scoped to one adopter's recent window.

---

## 3. `adopter_preferences`

Derived state; a materialized projection of `adopter_interactions` + explicit answers.
1:1 with `adopter_profiles`, keyed by `adopter_id` directly (no separate surrogate id —
a 1:1 table's natural key *is* the parent's PK).

**The source-tracking pattern (decided):** every learnable field is a *pair* —
`<field>` + `<field>_source` with `CHECK (<field>_source IN ('inferred','explicit'))`.
The inference job's write rule: it may only write a field whose source is NULL or
`'inferred'`; it must never overwrite `'explicit'`. Both columns of a pair are set and
cleared together: `CHECK ((field IS NULL) = (field_source IS NULL))` per pair keeps a
value from floating without provenance.

The four onboarding lifestyle answers land here as rows with source `'explicit'` at
profile creation — they are preferences that happen to be asked early, not profile
facts. Keeping them here (decided) means the settings screen, the inference guard, and
the pop-up system treat them identically to any other preference.

| Column | Type | Null | Default | Reasoning |
|---|---|---|---|---|
| `adopter_id` | `UUID` | NOT NULL | — | PK **and** FK → `adopter_profiles(id)`. Enforces 1:1 structurally. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Staleness signal for the inference job. |
| `max_dog_size` | `SMALLINT` | NULL | — | Tier-1 cap, stored **as fetchr's `size_enc` scale (1–4)**, `CHECK (max_dog_size BETWEEN 1 AND 4)`. Storing the encoded value makes the hard filter a direct `df.size_enc <= p.max_dog_size` — no translation table in the hot query. Display mapping (1=small…4=xlarge) is app-side. NULL = no cap known. |
| `max_dog_size_source` | `TEXT` | NULL | — | `CHECK IN ('inferred','explicit')`. |
| `preferred_age_range` | `TEXT` | NULL | — | `CHECK IN ('puppy','young','adult','senior')` — matches fetchr's `age_category` values exactly so scoring compares like with like. Stored as a single category despite the name; whether it should be a true min/max range is open (§7.3). |
| `preferred_age_source` | `TEXT` | NULL | — | Source pair. |
| `preferred_breed_groups` | `JSONB` | NOT NULL | `'[]'` | Array of fetchr `breed_group` strings (`"Working"`, `"Sporting"`, …). Empty array = no preference (distinct from "unknown" — hence NOT NULL). JSONB over a join table: this is a small display/scoring list read whole, never joined or FK-validated; values validated app-side against the contract's breed-group list. |
| `preferred_breed_source` | `TEXT` | NULL | — | Source pair (pairs with a non-empty array). |
| `preferred_gender` | `TEXT` | NULL | — | `CHECK IN ('male','female','any')` — matches fetchr's observed `gender` values. |
| `preferred_gender_source` | `TEXT` | NULL | — | Source pair. |
| `activity_level` | `TEXT` | NULL | — | `CHECK IN ('sedentary','moderate','active','very_active')`. Onboarding answer → written with source `'explicit'`. Primary driver of the (future) `energy_score` dimension. Nullable because pre-onboarding rows and legacy adopters may lack it. |
| `activity_level_source` | `TEXT` | NULL | — | Source pair. |
| `home_type` | `TEXT` | NULL | — | `CHECK IN ('apartment','house_no_yard','house_with_yard','farm')`. Onboarding → `'explicit'`. Drives energy + placement_restriction dimensions. |
| `home_type_source` | `TEXT` | NULL | — | Source pair. |
| `experience_level` | `TEXT` | NULL | — | `CHECK IN ('first_time','some','experienced')`. Onboarding → `'explicit'`. Drives trainability/confidence/special_needs dimensions. |
| `experience_level_source` | `TEXT` | NULL | — | Source pair. |
| `hours_away` | `SMALLINT` | NULL | — | Typical weekday hours away from home, `CHECK (hours_away BETWEEN 0 AND 24)`. Onboarding → `'explicit'`. Drives energy (↓), independence (↑), special_needs (↓ capacity). Stored as a number, not buckets — buckets can be derived from a number, never the reverse. Question wording/bucketing is open (§7.4). |
| `hours_away_source` | `TEXT` | NULL | — | Source pair. |
| `ok_with_special_needs` | `BOOLEAN` | NULL | — | Three-state by design: TRUE / FALSE / NULL = not yet known (the design doc's `true/false/not_yet_known`). One of the few places a nullable boolean is genuinely correct. |
| `special_needs_source` | `TEXT` | NULL | — | Source pair. |
| `free_text_description` | `TEXT` | NULL | — | Pop-up free-text ("calm apartment dog…"); embedded by the matching app for Stage-4 semantic re-rank. Raw text stored here; the embedding vector does **not** live in this table (pgvector storage is a Stage-4 decision). Always explicit by nature — no source column. |
| `total_interactions` | `INTEGER` | NOT NULL | `0` | Materialized counter so the feed doesn't `COUNT(*)` the log per request. Maintained by the interaction write path; drift is repairable from the log (it's derived state, like everything here). |
| `is_cold_start` | `BOOLEAN` | NOT NULL | `true` | Feed-strategy switch (popularity vs. preference ranking). Flips at the warm-start threshold N — value of N is open (§7.1). Kept even though onboarding now yields four explicit answers: cold start is about *behavioral* signal, which onboarding answers don't provide. |

**Indexes:** none beyond the PK. All access is by `adopter_id`.

**Why wide-row-with-source-pairs, not EAV** (`adopter_id, field, value, source` rows):
EAV would make "give me this adopter's preferences" a pivot and every field untyped and
un-CHECKable. The field set is small, known, and changes with product releases —
exactly when a migration is appropriate. The cost is ~2 columns per new preference;
acceptable.

---

## 4. `question_trigger_config`

Static, engineering-owned rule config. Not adopter data.

| Column | Type | Null | Default | Reasoning |
|---|---|---|---|---|
| `id` | `SERIAL` | NOT NULL | seq | PK. The UUID rule is for *adopter-facing* consumer data; this is an internal config table with a few dozen rows, where small readable IDs help ("trigger 7 is misfiring"). It appears in `/questions/{qid}/answer` URLs, but enumerating question configs exposes nothing sensitive. |
| `trigger_condition` | `JSONB` | NOT NULL | — | The rule definition (e.g. `{"event_type":"right_swipe","field":"size_enc","value":3,"count_threshold":3,"window":"session"}`). JSONB because the rule DSL will evolve faster than the schema; the DSL itself is not yet specified (§7.5). |
| `question_text` | `TEXT` | NOT NULL | — | What the adopter sees. |
| `response_options` | `JSONB` | NULL | — | `[{label, value}, …]`; NULL = free-text question (meaningful NULL, per the API doc). |
| `maps_to_preference_field` | `TEXT` | NOT NULL | — | Which `adopter_preferences` column the answer writes (e.g. `'activity_level'`). Validated app-side against the real column list — a DB CHECK would have to be migrated in lockstep with `adopter_preferences` and adds nothing. |
| `priority` | `INTEGER` | NOT NULL | `0` | Higher first when several triggers fire at once (design rule: max one question per session). |
| `is_active` | `BOOLEAN` | NOT NULL | `true` | Kill switch without deleting history — `adopter_question_events` rows keep pointing at retired configs. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Config audit. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | Config audit. |

**Indexes:** PK only. The trigger engine loads active rows (`WHERE is_active`) into
memory; a table this size never needs more.

---

## 5. `adopter_question_events`

Per-adopter pop-up history: shown, answered, or dismissed. Near-append-only (one row per
*showing*; answering updates that row's `response`/`answered_at` — it does not create a
second row).

| Column | Type | Null | Default | Reasoning |
|---|---|---|---|---|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | PK. Adopter-facing side of the pop-up flow → UUID rule applies. |
| `adopter_id` | `UUID` | NOT NULL | — | Hard FK → `adopter_profiles(id)`. |
| `trigger_config_id` | `INTEGER` | NOT NULL | — | Hard FK → `question_trigger_config(id)`. Ties every showing to the rule that fired it, so trigger quality is measurable (answer rate vs. dismissal rate per rule). |
| `shown_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | When it was displayed. Also enforces "max 1 unanswered question in flight" app-side (look for a row with `response IS NULL AND NOT dismissed`). |
| `answered_at` | `TIMESTAMPTZ` | NULL | — | NULL until answered. Shown→answered latency is a question-quality signal the earlier sketch couldn't capture. |
| `response` | `JSONB` | NULL | — | The answer payload; NULL if unanswered or dismissed. JSONB because responses are option-values or free text depending on the config. `CHECK (NOT (dismissed AND response IS NOT NULL))` — a dismissed showing cannot also carry an answer. |
| `dismissed` | `BOOLEAN` | NOT NULL | `false` | Dismissal rule (two dismissals of the same `(adopter_id, trigger_config_id)` → never show again) is computed from this app-side; it's a *count*, so it lives in a query, not a column. |

**Indexes**

```sql
-- "Has this adopter seen/dismissed this question before?" — checked before every fire.
CREATE INDEX ix_question_events_adopter_config
    ON adopter_question_events (adopter_id, trigger_config_id);
```

---

## 6. Stage-1 cold-start feed query — columns touched

For the MVP feed (hard filters + popularity + diversity; no preference scoring), the
exact touch list. Everything fetchr-side is inside the contract (`fetchr-data-contract.md` §1).

**Adopter side:**

| Table | Columns | Role |
|---|---|---|
| `adopter_profiles` | `id`, `lat`, `lng`, `max_distance_miles` | radius filter — *blocked until fetchr geocodes; see contract §3.1* |
| | `has_children`, `youngest_child_age` | gates the kids clause |
| | `has_existing_dogs`, `has_existing_cats` | gates the dogs/cats clauses |
| `adopter_preferences` | `is_cold_start` | strategy switch (this query is the `true` branch) |
| | `max_dog_size` | size cap — usually NULL in cold start, clause self-disables |
| `adopter_interactions` | `adopter_id`, `dog_profile_id` | seen-exclusion anti-join (index b) |
| | `dog_profile_id`, `event_type='save_to_watchlist'`, `event_at` | cross-adopter popularity counts (index c) |

**fetchr side (per the contract):**

| Table | Columns | Role |
|---|---|---|
| `dog_profiles` | `status`, `deleted_at` | Tier-1 entry filter |
| | `first_seen_at` | freshness rank term (the `days_listed` substitute) |
| | `id`, `name`, `breed_primary`, `age_category`, `age_years_approx`, `gender`, `size`, `city`, `state`, `photos`, `shelter_name`, `org_adoption_url`/`org_website`/`source_url` | feed-card display |
| `dog_features` | `good_with_kids_enc`, `good_with_dogs_enc`, `good_with_cats_enc` | Tier-1 trit filters (`IS DISTINCT FROM 0`) |
| | `size_enc` | size cap + diversity bucketing |
| | `breed_group` | diversity bucketing |
| | `good_with_cats_enc = -1` (etc.) | `compatibility_notes` ("not confirmed") UI warnings |

Day-one note (from the contract §3.7): with zero adopters there are no saves, so the
popularity term is zero everywhere and ranking degrades to freshness + diversity. That
is acceptable and by design.

---

## 7. Open questions (not resolvable from the docs — listed, not guessed)

1. **Warm-start threshold N.** The `is_cold_start` flip point ("N interactions") is
   explicitly "needs experimentation" in the design doc. The schema doesn't care; the
   write path does.
2. **Geocoding provider** for adopter `zip_code → lat/lng` (Google, PostGIS-adjacent,
   free batch service) — flagged as undecided in the schema doc's open questions. Same
   decision ideally shared with fetchr's dog-side geocoding (contract gap §3.1).
3. **`preferred_age_range` — single category or true range?** The docs use a single
   value (`'young'`) under a name that says "range." A real min/max pair would change
   two columns. Product call.
4. **`hours_away` question wording and bucketing.** The docs mention "daily schedule /
   hours away (e.g. 9–6 job)" but never define the question's answer format. Stored
   here as raw hours (0–24) since a number can always be bucketed later, but the
   onboarding UI format is undecided.
5. **The `trigger_condition` rule DSL.** The JSONB example shows one shape
   (`event_type/field/value/count_threshold/window`), but the full grammar (AND/OR?
   trait-based conditions once `*_score` columns land? cross-session windows?) is
   unspecified. Must be defined before the trigger engine is built.
6. **Dedicated app DB role.** Append-only enforcement via `REVOKE UPDATE, DELETE`
   needs a non-owner role for the app. No doc mentions role/user setup for the shared
   Postgres instance.
7. **Auth provider vs. `email` column.** If Supabase/Clerk is chosen (API doc leans
   managed), is `email` here the identity of record or a denormalized copy of the auth
   provider's — and does this table gain an `auth_provider_user_id`? Undecided until
   the auth decision (design doc step 6) is made.
8. **Preference recompute cadence.** Per-event or batched (schema doc suggests "every
   5 interactions")? Doesn't change columns, but determines `updated_at` churn and
   whether `total_interactions` increments transactionally with the event insert.
9. **Re-engagement / preference decay.** Dormant-adopter reset-or-preserve and
   recency-weighted swipes (design doc open questions) may eventually want
   per-preference `inferred_at` timestamps or decay metadata. Deliberately not added
   now — no defined consumer.
10. **Multi-person households.** The model is one adopter per profile; the design doc
    flags partner decision-making as unresolved. Would touch `adopter_profiles`
    cardinality (household entity?) if ever addressed — too structural to pre-build.

---

## Relationship to other docs

- Column names/types on the fetchr side: `fetchr-data-contract.md` (live-verified).
- Earlier sketch this supersedes: the table DDL in `matching-app-schema.md` (that doc
  remains the home of the fetchr contract summary and index requests).
- Product rules encoded here (append-only log, explicit-beats-inferred, dismissal
  rule, cold-start diversity): `adopter-profile-matching-design.md`.
- The dimension space the preferences feed: `matching-dimension-contract.md`.

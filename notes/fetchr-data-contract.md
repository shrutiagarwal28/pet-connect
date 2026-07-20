# fetchr Data Contract

> Contract doc — 2026-07-20. No code.
> Every column name, type, and value distribution below was **verified against the live
> fetchr database** (`psql fetchr`) on this date, over 225 dog profiles (224 available,
> 1 adopted, 0 soft-deleted). This supersedes the column names in the June 2026 docs;
> `matching-dimension-contract.md` explains the `*_enc` / `*_score` naming that replaced
> `*_ord` / `*_flag` / `trait_*`.
>
> **The rule:** the matching app reads the columns in §1 and nothing else. Anything not
> listed here, fetchr may rename, drop, or repurpose freely without coordination.
> Anything listed here is a versioned API: no rename, type change, semantic change, or
> drop without a coordinated update to this doc.

---

## 1. Column dependency list

### 1.1 Identity and join keys

**Both tables key on `VARCHAR(36)` UUID strings — not integers.** The adopter schema
has been reconciled accordingly: `adopter_interactions.dog_profile_id` is a
`VARCHAR(36)` soft reference.

| Table | Column | Type | Nulls | Semantics |
|---|---|---|---|---|
| `dog_profiles` | `id` | `varchar(36)` | NOT NULL | PK; UUID string. The value the matching app stores in `adopter_interactions.dog_profile_id`. |
| `dog_features` | `dog_profile_id` | `varchar(36)` | NOT NULL | FK → `dog_profiles.id`, `ON DELETE CASCADE`, UNIQUE — the join is guaranteed **1:1** (verified: all 225 live profiles have exactly one features row). |

### 1.2 From `dog_profiles` — filters and freshness

| Column | Type | Nulls | Semantics / live observations |
|---|---|---|---|
| `status` | `varchar(20)` | NOT NULL | Hard filter. Observed values: `available`, `adopted`. Filter is `status = 'available'`. |
| `deleted_at` | `timestamptz` | NULL = live | Soft delete. Always add `deleted_at IS NULL`; a NULL means the listing is live. |
| `city` | `varchar(100)` | nullable; 224/225 populated | Location display. |
| `state` | `varchar(10)` | nullable; populated | Location display. |
| `zip` | `varchar(20)` | nullable; 224/225 populated | **Note the name: `zip`, not `postal_code`.** 5-digit US ZIPs observed. Currently the only usable location signal (see §3.1). |
| `lat`, `lng` | `double precision` | nullable; **currently 100% NULL** | Columns exist but no geocoding pipeline populates them. Radius filtering is blocked until they're filled (§3.1). |
| `first_seen_at` | `timestamptz` | NOT NULL | Freshness signal. **Use this to derive days-listed** — there is no `days_listed` column, and `listed_at` is 0% populated (do not depend on it). |

### 1.3 From `dog_profiles` — display (feed card / detail page)

| Column | Type | Nulls | Semantics / live observations |
|---|---|---|---|
| `source_id` | `varchar(255)` | NOT NULL | Dedup/display reference; unique together with `source`. |
| `name` | `varchar(255)` | NOT NULL | 100% populated. |
| `breed_primary` | `varchar(255)` | NOT NULL | Display only — never a filter (breed-bias trap). |
| `breed_canonical_id` | `integer` | nullable | FK → `petfinder_breeds.id`; breed-group lookup path. |
| `age_category` | `varchar(20)` | NOT NULL | Values: `puppy`, `young`, `adult`, `senior`. Display fallback. |
| `age_years_approx` | `double precision` | nullable; 100% populated today | Feed display. For scoring, prefer `dog_features.age_years_imputed`. |
| `gender` | `varchar(20)` | NOT NULL | Values: `male`, `female`. |
| `size` | `varchar(20)` | NOT NULL | Values: `small`, `medium`, `large`, `xlarge`. Display; filtering uses `dog_features.size_enc`. |
| `description` | `text` | nullable; 210/225 populated | Display + embedding source (matching app computes embeddings — see repo-boundary decision). |
| `photos` | `jsonb` | NOT NULL | Array; 100% non-empty today. Feed card image. |
| `shelter_name` | `varchar(255)` | nullable; 100% populated today | Display. |
| `source_url` | `text` | NOT NULL | **There is no `shelter_url` column** (older docs assumed one). Contact-link fallback chain: `org_adoption_url` (71% populated) → `org_website` (67%) → `source_url` (100%, the PetFinder listing). |
| `org_adoption_url` | `text` | nullable; 160/225 | Preferred "contact shelter" link when present. |
| `org_website` | `text` | nullable; 151/225 | Second-choice contact link. |

### 1.4 From `dog_features` — Tier-1 filters and Tier-2 scoring

**Two different unknown-value conventions coexist — do not conflate them:**

- The six `*_enc` compatibility/boolean-ish columns are **trits with no NULLs**:
  `-1` = unknown, `0` = known-no, `1` = known-yes. Unknown is a *value* (−1), not NULL.
- The ordinal `coat_type_enc` uses **NULL** for unknown (58% NULL today).

The null-trap rule ("only exclude known-bad") therefore translates to SQL as
`column IS DISTINCT FROM 0` for the trit columns — it excludes only `0`, keeping both
`1` and `-1` (and stays correct if NULLs ever appear).

| Column | Type | Nulls / distribution (live) | Semantics |
|---|---|---|---|
| `size_enc` | `smallint` | no NULLs today; 1:37, 2:117, 3:70, 4:1 | Ordinal 1=small … 4=xlarge. Tier-1 cap (`size_enc <= max`) + Tier-2 soft preference. |
| `age_category_enc` | `smallint` | no NULLs today; 1:40, 2:84, 3:86, 4:15 | Ordinal 1=puppy … 4=senior. Tier-2. |
| `age_years_imputed` | `double precision` | 100% populated | Tier-2 continuous age. More reliable than `age_category`. |
| `age_was_imputed` | `boolean` | 100% populated (all `false` today) | Confidence weight — down-weight age when `true`. |
| `coat_type_enc` | `smallint` | **NULL = unknown; 58% NULL** (1:54, 2:11, 3:30) | Ordinal 1–3 grooming effort. Tier-2. Matcher must treat NULL as "no signal," not midpoint. |
| `good_with_kids_enc` | `smallint` | trit; −1:108, 0:12, 1:105 | Tier-1: exclude `= 0` when adopter has children under 8. 48% unknown. |
| `good_with_dogs_enc` | `smallint` | trit; −1:68, 0:15, 1:142 | Tier-1: exclude `= 0` when adopter has dogs. 30% unknown. |
| `good_with_cats_enc` | `smallint` | trit; −1:144, 0:27, 1:54 | Tier-1: exclude `= 0` when adopter has cats. **64% unknown** — hard-filtering unknowns would drop most inventory; surface a "not confirmed" UI note instead. |
| `house_trained_enc` | `smallint` | trit; −1:78, 0:17, 1:130 | Tier-2 preference scoring. |
| `vaccinated_enc` | `smallint` | trit; −1:15, 1:210 (no 0 observed) | Tier-2 preference scoring. |
| `spayed_neutered_enc` | `smallint` | trit; −1:66, 0:6, 1:153 | Tier-2 preference scoring. |
| `breed_group` | `varchar(50)` | 100% populated | Tier-2 nominal. Observed: `Mixed/Unknown` (85), `Working` (40), `Sporting` (29), `Pit Bull Type` (29), `Herding` (16), `Toy` (9), `Non-Sporting` (9), `Hound` (6), `Terrier` (2). Per the dimension contract, `Pit Bull Type` is audit-only — never a filter. |
| `computed_at` | `timestamptz` | NOT NULL | Feature-vector staleness check. |

### 1.5 Reserved — Phase 5 dimension scores (NOT yet in the live schema)

The dimension contract's Tier-2 space depends on nine `*_score` columns.
**None of them exist in the live `dog_features` table yet** (verified 2026-07-20; no
other table holds them either). They join this contract, with the semantics below,
the moment fetchr's Phase 5 feature engineering lands:

| Column (planned) | Range | Convention |
|---|---|---|
| `energy_score` | bipolar −1..+1 | 0 = **no signal**, not "medium" |
| `affection_score` | unipolar 0..+1 | |
| `sociability_score` | unipolar 0..+1 | |
| `playfulness_score` | unipolar 0..+1 | |
| `trainability_score` | bipolar −1..+1 | 0 = no signal |
| `confidence_score` | bipolar −1..+1 | 0 = no signal |
| `independence_score` | bipolar −1..+1 | 0 = no signal |
| `special_needs_score` | unipolar 0..+1 | |
| `placement_restriction_score` | unipolar 0..+1 | |

Until these land, Tier-2 scoring is limited to size / age / coat / breed group and the
`*_enc` columns above (see §3.2).

### 1.6 Explicitly NOT depended on

For the avoidance of doubt, the matching app does **not** read: `raw_scrapes`,
`urls_to_visit`, `breed_supply_snapshots`, `alembic_version`, any `org_*` column not
listed in §1.3, `personality_traits` (raw JSONB — the `*_score` columns are its contracted
form), the raw `good_with_kids/dogs/cats` booleans on `dog_profiles` (the `*_enc` trits
are the contracted form), `listed_at` (unpopulated), or `internal_notes` / contact PII
columns. `dog_profile_history` is out of contract for the MVP; it becomes a dependency
only when Stage-3 collaborative filtering starts (will be added here explicitly then).

---

## 2. Query spec — Tier-1 hard-filter stage

### 2.1 The query

Per the dimension contract: Tier-1 is pure SQL `WHERE`, applied before any scoring, and
only ever excludes dogs that are *known bad* (`= 0`) — never merely unknown. Each
household clause is included only when the adopter fact makes it apply; the parameterized
form below folds that into the SQL so it's a single statement (`$n IS FALSE/NULL` short-
circuits the clause when it doesn't apply).

```sql
-- Parameters:
--   $1 adopter.has_children AND adopter.youngest_child_age < 8   (boolean)
--   $2 adopter.has_existing_dogs                                 (boolean)
--   $3 adopter.has_existing_cats                                 (boolean)
--   $4 adopter.max_dog_size as size_enc 1–4, or NULL if no cap   (smallint)
SELECT dp.id
FROM dog_profiles dp
JOIN dog_features df ON df.dog_profile_id = dp.id      -- 1:1, enforced unique
WHERE dp.status = 'available'
  AND dp.deleted_at IS NULL
  -- location radius filter goes here once lat/lng are populated (see §3.1);
  -- not expressible against the live DB today
  AND (NOT $1 OR df.good_with_kids_enc IS DISTINCT FROM 0)
  AND (NOT $2 OR df.good_with_dogs_enc IS DISTINCT FROM 0)
  AND (NOT $3 OR df.good_with_cats_enc IS DISTINCT FROM 0)
  AND ($4 IS NULL OR df.size_enc IS NULL OR df.size_enc <= $4);
```

Why these exact predicates:

- **`IS DISTINCT FROM 0`, not `<> 0`:** the trits carry no NULLs today, but if a NULL
  ever appears, `<> 0` would evaluate to NULL and silently *exclude* an unknown dog —
  the exact null-trap the contract forbids. `IS DISTINCT FROM 0` keeps unknowns in the
  pool under both conventions.
- **`df.size_enc IS NULL OR …` in the size cap:** same rule applied to the ordinal — an
  unknown size must not be excluded by a size cap.
- **`deleted_at IS NULL` even though `status` exists:** they're independent axes (a
  soft-deleted row can still say `available`).
- **No exclusion of already-seen dogs here:** the `NOT IN (SELECT … FROM
  adopter_interactions …)` clause belongs to the feed query in the matching app's own
  schema; this contract covers only the fetchr side of that statement.

### 2.2 Verified against the live DB

Run 2026-07-20 with the worst-case adopter (young kids + dogs + cats + medium size cap):
returns **126 of 225** dogs in ~1.3 ms. Sanity-checks the null-trap rule: a naïve
`= 1` filter on the same three columns would return only 20-odd dogs, because unknowns
(−1) dominate `good_with_cats_enc`.

```
Hash Join  (actual rows=126)
  -> Seq Scan on dog_profiles   Filter: deleted_at IS NULL AND status='available'
  -> Seq Scan on dog_features   Filter: (the three trit clauses + size cap)
Execution Time: 1.304 ms
```

### 2.3 Index support

**Exists today (relevant to this query):**

| Index | Covers |
|---|---|
| `dog_profiles_pkey` (btree `id`) | join target |
| `ix_dog_features_dog_profile_id` + `uq_dog_features_dog_profile_id` | join, 1:1 guarantee |
| `ix_dog_profiles_deleted_at` | soft-delete filter (marginal alone) |

**Missing (to request from fetchr, in priority order):**

1. `CREATE INDEX ix_dog_profiles_status_live ON dog_profiles (status) WHERE deleted_at IS NULL;`
   — the every-query entry filter. Irrelevant at 225 rows (planner correctly seq-scans);
   becomes the driving index at ~10k+ rows.
2. **Location index — blocked, not just missing** (§3.1). Once lat/lng are populated:
   PostGIS `GiST` on `geography(Point)`, or `earthdistance`/`cube` GiST as a lighter
   alternative. Nothing to create until the columns have data and an extension is chosen.
3. `CREATE INDEX ix_dog_features_breed_group ON dog_features (breed_group);` — Tier-2
   scoring/grouping, not Tier-1. Low priority.
4. A `size_enc` index is **not** worth requesting: 4 distinct values over a table the
   planner will hash-join anyway; the Tier-1 clauses on `dog_features` filter ~44% of
   rows, below useful btree selectivity.

---

## 3. Gaps — what the matching app needs that fetchr doesn't provide yet

### 3.1 Location radius filter is blocked (the big one)

Three compounding gaps, verified live:

1. **`lat`/`lng` are 100% NULL** — the columns exist on `dog_profiles` but no geocoding
   pipeline fills them. `zip` is the only usable location signal (224/225 populated).
2. **No PostGIS** — the only installed extension is `plpgsql`. The dimension contract's
   "location radius (PostGIS)" filter cannot run at all today.
3. Consequently no spatial index exists or can exist yet.

**Ask of fetchr:** geocode `zip → lat/lng` at scrape/ingest time (one lookup per new
profile; ZIP-centroid precision is plenty for a radius filter) and install PostGIS or
`earthdistance`. Interim fallback if the matching app must ship first: state-level or
ZIP-prefix filtering on `zip`/`state` — coarse but honest.

### 3.2 The nine Phase 5 `*_score` columns don't exist yet

Tier-2's personality dimensions (energy, affection, sociability, playfulness,
trainability, confidence, independence, special_needs, placement_restriction) have no
live columns (§1.5). Until Phase 5 lands, warm-start scoring can only use size, age,
coat, breed group, and the `*_enc` columns. The pop-up system's activity-level question
has nothing to score against until `energy_score` exists — sequence accordingly.

### 3.3 No `shelter_url` column

The schema and API docs assumed a `shelter_url` for the "contact shelter" link and the
`contact_shelter` event metadata. It doesn't exist. Contracted fallback chain (§1.3):
`org_adoption_url` (71%) → `org_website` (67%) → `source_url` (100%). No ask of fetchr
needed — the chain suffices — but the API doc's `contact_shelter` metadata should store
whichever URL was actually shown.

### 3.4 `dog_profiles.id` is a UUID string, not an integer

`adopter_interactions.dog_profile_id` (and the API's `dog_profile_id: 123` examples)
assumed an integer. Live PK is `varchar(36)` UUID. The matching app schema must use
`VARCHAR(36)`/`UUID`, and API responses will carry UUID strings.

### 3.5 No `days_listed`; `listed_at` is unpopulated

Cold-start ranking wanted `days_listed` (urgency/freshness). No such column; `listed_at`
exists but is 0% populated. **Derive freshness from `first_seen_at`** (100% populated,
NOT NULL) — e.g. `now() - first_seen_at`. No ask of fetchr needed unless true
listing-date fidelity matters later.

### 3.6 No `is_purebred`

Referenced by the old contract table; never built. `is_mixed` (boolean, NOT NULL) exists
if a purebred display flag is ever wanted. Dropped from the contract per the dimension
doc.

### 3.7 Popularity signal for cold start is entirely matching-side

Stage-1 ranking ("most-saved dogs") needs save counts — those live in the matching app's
own `adopter_interactions`, so no fetchr gap; noted here so nobody goes looking for a
popularity column in fetchr. Day-one cold start (zero adopters) has only freshness
(`first_seen_at`) + diversity injection to rank with.

### 3.8 Known open questions, not gaps

Reactivity/noise axis (no data source; deliberately deferred), absence-handling rule for
score = 0 / NULL in the matcher, and bipolar-vs-unipolar normalization are open *design*
questions tracked in `matching-dimension-contract.md` — fetchr owes nothing for them yet.

---

## Relationship to other docs

- `matching-dimension-contract.md` — the dimension space this contract's columns feed;
  defines Tier-1 vs Tier-2 and the null-trap rule.
- `matching-app-schema.md` — adopter-side tables; its "Data Contract with fetchr"
  section now mirrors §1 of this doc (reconciled 2026-07-20).
- `adopter-profile-matching-design.md` — product/behavioral model and repo boundary;
  `dog_features` + the `dog_profiles` columns above are the entire interface.

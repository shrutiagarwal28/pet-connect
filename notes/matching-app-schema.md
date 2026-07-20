# Matching App — Schema Design

> Design doc — not yet implemented.
> All adopter-side tables live in the matching app repository.
> fetchr tables (`dog_profiles`, `dog_features`, etc.) are read-only from the matching app's perspective.

---

## Data Contract with fetchr

The matching app queries these columns and nothing else from fetchr's schema.
fetchr must treat these as a versioned API — no rename or drop without coordination.

> Reconciled 2026-07-20 against the live database and the Phase 5 `*_enc`/`*_score`
> naming (see `matching-dimension-contract.md`). The authoritative, live-verified
> version of this contract — with types, null semantics, and value distributions —
> is **`fetchr-data-contract.md`**; the tables below are the summary.

### From `dog_profiles`

| Column | Used for |
|---|---|
| `id` | FK target from `adopter_interactions.dog_profile_id` — **`VARCHAR(36)` UUID string, not an integer** |
| `source_id` | Display / dedup reference |
| `name` | Feed display |
| `breed_primary` | Display |
| `breed_canonical_id` | Breed group lookup |
| `age_category` | Display fallback |
| `age_years_approx` | Feed display |
| `gender` | Display + soft filter |
| `size` | Display |
| `status` | Hard filter: `WHERE status = 'available'` (plus `deleted_at IS NULL`) |
| `deleted_at` | Soft-delete guard on every query |
| `city`, `state`, `zip` | Location display; radius filter blocked — `lat`/`lng` exist but are 100% NULL and PostGIS is not installed (see gaps in `fetchr-data-contract.md`) |
| `description` | Display + embedding computation (matching app computes embeddings) |
| `photos` | Feed card display |
| `shelter_name` | Display |
| `org_adoption_url` → `org_website` → `source_url` | "Contact shelter" link fallback chain — there is no `shelter_url` column |
| `first_seen_at` | Freshness signal; also the `days_listed` substitute (`listed_at` is unpopulated) |

Hard filtering on kid/dog/cat compatibility uses the `good_with_*_enc` trits in
`dog_features` below — the raw `good_with_*` booleans on `dog_profiles` are not part
of the contract.

### From `dog_features`

Trit convention for the `*_enc` compatibility columns: `-1` = unknown, `0` = known-no,
`1` = known-yes (no NULLs). `coat_type_enc` instead uses NULL for unknown.

| Column | Used for |
|---|---|
| `dog_profile_id` | FK join to `dog_profiles` (`VARCHAR(36)`, unique — join is 1:1) |
| `size_enc` | Hard size cap (`size_enc <= adopter.max_size_enc`) + preference scoring |
| `age_category_enc` | Preference scoring |
| `age_years_imputed` | Preference scoring; more reliable than `age_category` |
| `age_was_imputed` | Confidence weighting — imputed ages carry less weight |
| `coat_type_enc` | Preference scoring (grooming effort; NULL = unknown, 58% today) |
| `good_with_kids_enc` | Hard filter: exclude where `= 0` if adopter has children under 8 |
| `good_with_dogs_enc` | Hard filter: exclude where `= 0` if adopter has dogs |
| `good_with_cats_enc` | Hard filter: exclude where `= 0` if adopter has cats (64% unknown — only exclude known bad) |
| `house_trained_enc` | Preference scoring |
| `vaccinated_enc` | Preference scoring |
| `spayed_neutered_enc` | Preference scoring |
| `breed_group` | Preference scoring; breed group filtering |
| `computed_at` | Feature staleness check |

**Phase 5 dimension scores (planned — not yet in the live schema).** These join the
contract when fetchr's Phase 5 feature engineering lands; until then Tier-2 scoring is
limited to the columns above:

| Column (planned) | Used for |
|---|---|
| `energy_score` | Tier-2 scoring, bipolar −1..+1 (0 = no signal, not "medium") |
| `affection_score` | Tier-2 scoring, unipolar 0..+1 |
| `sociability_score` | Tier-2 scoring, unipolar 0..+1 |
| `playfulness_score` | Tier-2 scoring, unipolar 0..+1 |
| `trainability_score` | Tier-2 scoring, bipolar −1..+1 |
| `confidence_score` | Tier-2 scoring, bipolar −1..+1 |
| `independence_score` | Tier-2 scoring, bipolar −1..+1 |
| `special_needs_score` | Tier-2 scoring, unipolar 0..+1 |
| `placement_restriction_score` | Tier-2 scoring, unipolar 0..+1 |

(Former references to `trait_*` multi-hot columns, `other_traits_count`, `is_purebred`,
and `days_listed` are removed — the first two were replaced by the `*_score` dimensions,
the last two were never built.)

---

## Adopter-Side Tables

### `adopter_profiles`

Slow-changing facts. Collected at onboarding. Rarely updated.

```sql
CREATE TABLE adopter_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT NOT NULL UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Location (Tier 1 hard filter)
    zip_code            TEXT NOT NULL,
    lat                 DOUBLE PRECISION,       -- geocoded from zip_code at write time
    lng                 DOUBLE PRECISION,
    max_distance_miles  INTEGER NOT NULL DEFAULT 50,

    -- Household composition (Tier 1 — safety constraints, not preferences)
    has_children        BOOLEAN NOT NULL,
    youngest_child_age  INTEGER,                -- null if has_children = false
    has_existing_dogs   BOOLEAN NOT NULL,
    has_existing_cats   BOOLEAN NOT NULL,

    deleted_at          TIMESTAMPTZ             -- soft delete
);

CREATE INDEX ix_adopter_profiles_zip ON adopter_profiles (zip_code);
```

**Why UUID for PK:** Consumer-facing IDs should not be enumerable. Sequential integers in a URL let anyone iterate over all adopter profiles.

**Why geocode at write time:** PostGIS radius queries need `lat/lng`. Geocoding at read time on every feed request is slow and expensive. Geocode once on insert.

---

### `adopter_interactions`

Append-only event log. Never update. Never delete (soft-delete the adopter profile if needed, not individual events).

```sql
CREATE TABLE adopter_interactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adopter_id          UUID NOT NULL REFERENCES adopter_profiles(id),
    dog_profile_id      VARCHAR(36) NOT NULL,   -- soft reference to fetchr's dog_profiles.id
                                                -- (UUID string — fetchr's PK type)
                                                -- no hard FK: fetchr owns that table
    event_type          TEXT NOT NULL,          -- see event type enum below
    event_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata            JSONB                   -- flexible per-event payload
);

-- Inference job reads all events for a given adopter constantly
CREATE INDEX ix_interactions_adopter_time ON adopter_interactions (adopter_id, event_at DESC);

-- Feed construction needs to know which dogs an adopter has already seen
CREATE INDEX ix_interactions_adopter_dog ON adopter_interactions (adopter_id, dog_profile_id);
```

**Why soft reference for `dog_profile_id`:** A hard FK would require fetchr and the matching app to share the same Postgres schema or use cross-schema references. Soft reference keeps the repos independently deployable. The matching app must tolerate a dog being deleted from fetchr (soft-deleted) — it should handle nulls gracefully in the join.

**Event type values:**
```
right_swipe
left_swipe
save_to_watchlist
dismiss_from_watchlist
view_detail
contact_shelter
explicit_answer             -- pop-up question answered; detail in metadata
```

**`metadata` JSONB payload per event type:**
```
right_swipe / left_swipe:   { source_screen: "feed" | "watchlist" }
view_detail:                { duration_seconds: int, source_screen: str }
contact_shelter:            { contact_url: str }   -- the link actually shown: org_adoption_url,
                                                   -- org_website, or source_url (no shelter_url
                                                   -- column exists in fetchr)
explicit_answer:            { question_id: int, response: str | bool }
```

---

### `adopter_preferences`

Derived state. Recomputable from `adopter_interactions` at any time. Never treat this as the source of truth — that is `adopter_interactions`.

```sql
CREATE TABLE adopter_preferences (
    adopter_id              UUID PRIMARY KEY REFERENCES adopter_profiles(id),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Tier 1 size constraint (inferred or explicit)
    max_dog_size            TEXT,               -- small / medium / large / xlarge
    max_dog_size_source     TEXT,               -- inferred / explicit

    -- Tier 2 preferences
    preferred_age_range     TEXT,               -- puppy / young / adult / senior
    preferred_age_source    TEXT,
    preferred_breed_groups  JSONB,              -- ["Bully", "Hound"] — empty = no preference
    preferred_breed_source  TEXT,
    preferred_gender        TEXT,               -- male / female / any
    preferred_gender_source TEXT,

    -- Lifestyle (hard to infer from swipes — usually set via pop-up)
    activity_level          TEXT,               -- sedentary / moderate / active / very_active
    activity_level_source   TEXT,
    home_type               TEXT,               -- apartment / house_no_yard / house_with_yard / farm
    home_type_source        TEXT,
    experience_level        TEXT,               -- first_time / some / experienced
    experience_level_source TEXT,

    ok_with_special_needs   BOOLEAN,
    special_needs_source    TEXT,

    -- Semantic preference (from pop-up free text; used for embedding matching)
    free_text_description   TEXT,

    -- Confidence signal
    total_interactions      INTEGER NOT NULL DEFAULT 0,
    is_cold_start           BOOLEAN NOT NULL DEFAULT true   -- false once >= N interactions
);
```

**Why source tracking per field:** Explicit answers from pop-ups override inferred values. Tracking the source lets the inference job know not to overwrite an explicit answer with a new inference.

**Why `is_cold_start`:** The feed construction query needs to know whether to use popularity-based ranking or preference-based ranking. Rather than recomputing `COUNT(interactions)` on every feed request, keep it materialized here.

---

### `question_trigger_config`

Static configuration. Defines which behavioral patterns fire which questions.
Populated by the engineering team — not by adopters.

```sql
CREATE TABLE question_trigger_config (
    id                          SERIAL PRIMARY KEY,
    trigger_condition           JSONB NOT NULL,
    -- Example:
    -- { "event_type": "right_swipe", "field": "size_enc", "value": 2,
    --   "count_threshold": 3, "window": "session" }

    question_text               TEXT NOT NULL,
    response_options            JSONB,
    -- Example: [{"label": "Sedentary", "value": "sedentary"},
    --            {"label": "Moderate",  "value": "moderate"},
    --            {"label": "Active",    "value": "active"}]
    -- null = free-text response

    maps_to_preference_field    TEXT NOT NULL,
    priority                    INTEGER NOT NULL DEFAULT 0,
    is_active                   BOOLEAN NOT NULL DEFAULT true
);
```

---

### `adopter_question_events`

Per-adopter pop-up history. Tracks what was shown, answered, and dismissed.

```sql
CREATE TABLE adopter_question_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adopter_id              UUID NOT NULL REFERENCES adopter_profiles(id),
    trigger_config_id       INTEGER NOT NULL REFERENCES question_trigger_config(id),
    shown_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    response                JSONB,              -- null if dismissed
    dismissed               BOOLEAN NOT NULL DEFAULT false
);

-- Don't show a dismissed question again; check this before firing
CREATE INDEX ix_question_events_adopter ON adopter_question_events (adopter_id, trigger_config_id);
```

**Dismissal rule:** If `dismissed = true` appears twice for the same `(adopter_id, trigger_config_id)`, never show that question to that adopter again.

---

## Indexes to Request from fetchr

These indexes need to exist on fetchr's tables for the matching app's feed query to be
performant. Verified against the live DB 2026-07-20 — see `fetchr-data-contract.md` §2.3
for the full analysis:

```sql
-- Hard filter: status is always the first WHERE clause.
-- Verified MISSING — request from fetchr (matters at ~10k+ rows).
CREATE INDEX ix_dog_profiles_status_live ON dog_profiles (status) WHERE deleted_at IS NULL;

-- Preference scoring join.
-- Verified: ALREADY EXISTS (ix_dog_features_dog_profile_id + unique constraint).

-- Breed group scoring. Verified MISSING — low priority (Tier-2 only).
CREATE INDEX ix_dog_features_breed_group ON dog_features (breed_group);

-- Size filter index dropped from the request: 4 distinct values — too low
-- selectivity for a btree to help; the planner hash-joins dog_features anyway.

-- Location (PostGIS GiST) index: blocked, not just missing — lat/lng are 100% NULL
-- and PostGIS is not installed. See gaps in fetchr-data-contract.md.
```

---

## Open Schema Questions

- **Hard vs. soft FK on `adopter_interactions.dog_profile_id`:** Final decision deferred until database sharing strategy is confirmed. If shared DB, make it a hard FK with `ON DELETE SET NULL`. If separate DBs later, soft reference is correct from the start.
- **Geocoding service:** What geocodes `zip_code → lat/lng` at adopter profile creation? Options: Google Maps API, PostGIS built-in, a free batch geocoder. Decide before building the onboarding flow.
- **`adopter_preferences` update frequency:** Does the inference job run after every interaction or in batches? Batch (e.g., after every 5 interactions) is simpler to start.

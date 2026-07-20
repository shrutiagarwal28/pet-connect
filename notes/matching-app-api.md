# Matching App — API Contract (FastAPI)

> Definitive contract — 2026-07-20. Doc only, no code. Supersedes the June sketch.
>
> Inputs: `adopter-erd.md` (adopter-side tables), `fetchr-data-contract.md`
> (live-verified fetchr surface — all dog IDs are **`VARCHAR(36)` UUID strings**),
> `matching-dimension-contract.md` (Tier-1/Tier-2 rules).
>
> **Decisions honored (not revisited):**
> - Auth is **stubbed**: every protected endpoint assumes a `get_current_adopter`
>   FastAPI dependency that yields the caller's adopter row. No login endpoints here.
> - Feed responses return **full dog cards** (one call renders the card) plus a
>   `match_score`.
> - **Cursor pagination from day one** on feed and watchlist.
> - Chatbot search: **text in → validated constraint struct + ranked dogs out.**
>   The parser fills a typed struct; it never produces SQL.

---

## Conventions (apply to every endpoint)

**Identity comes from the token, never the URL.** Protected paths use `/adopters/me/…`;
`get_current_adopter` resolves `me`. There is no `/adopters/{id}/…` surface at all —
an ID the client can't supply is an IDOR class that can't exist. (Trade-off vs. the
June sketch's `{id}` + 403 check: admin tooling will eventually need explicit-ID
routes; those become a separate `/admin` surface, not a loosening of `/me`.)

**Errors.** Uniform body; internal details are logged server-side, never returned:

```json
{ "error": { "code": "adopter_not_found", "message": "human-readable, safe" } }
```

| Status | Meaning here |
|---|---|
| `401` | Missing/invalid credentials (from the auth stub). |
| `404` | Resource genuinely doesn't exist (e.g., unknown `dog_profile_id`). |
| `409` | Conflict (duplicate email on create). |
| `422` | Request body fails validation (FastAPI/Pydantic default). Response includes field-level detail, but **never** echoes internal exception text. |
| `429` | Rate limited (strategy open — §Open questions). |

**Pagination.** `limit` (default 20, max 50) + opaque `cursor` string. Cursors are
base64-encoded keyset positions (`(rank_key, id)`), not page numbers — the feed is
personalized and shifting, and offsets skip/duplicate rows when the underlying set
changes between requests. `next_cursor: null` means end of results. Cursors are
short-lived by nature (they embed a ranking position); clients must tolerate a `422
invalid_cursor` by restarting from page one.

**Timestamps** are ISO-8601 UTC. **All dog IDs are UUID strings** (fetchr's
`VARCHAR(36)` PKs), e.g. `"69d37410-135e-4a0d-9d90-a31d88adc666"`. Adopter IDs are
UUIDs too.

**The dog card** (shared response shape for feed, watchlist, and search):

```json
{
  "dog_profile_id": "69d37410-135e-4a0d-9d90-a31d88adc666",
  "name": "Biscuit",
  "breed_primary": "Pit Bull Terrier",
  "breed_group": "Pit Bull Type",
  "age_years_approx": 2.5,
  "age_category": "young",
  "size": "medium",
  "gender": "female",
  "city": "Jersey City",
  "state": "NJ",
  "distance_miles": null,
  "photo_url": "https://cdn.example.com/dogs/biscuit-01.jpg",
  "days_listed": 12,
  "compatibility": {
    "kids": "yes",
    "dogs": "not_confirmed",
    "cats": "no"
  },
  "compatibility_notes": [
    "Dog compatibility not confirmed — check with the shelter before applying."
  ],
  "contact_url": "https://happypawsnj.org/adopt/biscuit",
  "match_score": 0.84
}
```

Field sourcing (all within `fetchr-data-contract.md` §1):

- `compatibility.*` maps the `good_with_*_enc` trits: `1 → "yes"`, `0 → "no"`,
  `-1 → "not_confirmed"`. Badges show all three states; `compatibility_notes` carries
  the human sentence only for `not_confirmed` axes *relevant to this adopter's
  household* (a cat-free household gets no cat note).
- `contact_url` is the fallback chain `org_adoption_url` → `org_website` → `source_url`
  (there is no `shelter_url` column). The chain is resolved server-side; the client
  gets one URL.
- `days_listed` is derived: `floor(now() - first_seen_at)` in days (`listed_at` is
  unpopulated in fetchr — contract §3.5).
- `distance_miles` is `null` until the location gap closes (lat/lng 100% NULL, no
  PostGIS — contract §3.1). The field is in the shape from day one so its arrival is
  not a breaking change.
- `match_score` is a 0–1 rank score. In cold start it is normalized
  popularity+freshness, not preference similarity — same field, different generator;
  clients must not interpret it as "percent match."
- `age_category`, `size`, `gender` pass through fetchr's lowercase values
  (`young`, `medium`, `female`).

---

## 1. `POST /adopters` — onboarding

Creates the adopter. **Unauthenticated in the stub** (there is no account to
authenticate yet); how this call ties into the real auth provider's signup is open
(§Open questions).

Collects the six safety/location facts **and the four lifestyle answers**. Per
`adopter-erd.md`, the lifestyle answers are stored as `adopter_preferences` rows with
source `'explicit'` — they are preferences asked early, not profile columns.

**Request:**

```json
{
  "email": "amy@example.com",
  "zip_code": "07302",
  "max_distance_miles": 50,
  "has_children": true,
  "youngest_child_age": 4,
  "has_existing_dogs": false,
  "has_existing_cats": true,
  "activity_level": "moderate",
  "home_type": "apartment",
  "experience_level": "first_time",
  "hours_away": 9
}
```

Validation (Pydantic, mirrors the ERD CHECKs): `zip_code` matches `^\d{5}$`;
`max_distance_miles > 0`; `youngest_child_age` required iff `has_children`, range
0–17; the four lifestyle fields required, values from the ERD enums; `hours_away`
0–24. All inputs validated before any DB write — no value reaches a query except as a
bind parameter.

**Response `201 Created`:**

```json
{
  "id": "3f8a2c1e-9b4d-4e6a-8c7f-2d5b9e0a1f64",
  "email": "amy@example.com",
  "created_at": "2026-07-20T15:04:05Z",
  "geocoded": false
}
```

`geocoded: false` tells the client the zip→lat/lng lookup failed or is pending; the
feed still works, just without the radius filter. Onboarding never blocks on the
geocoder.

**Errors:** `409 email_taken` (checked against `lower(email)` unique index) ·
`422` validation.

**Reads/writes:**

| Table | Access |
|---|---|
| `adopter_profiles` | INSERT (profile facts + geocoded lat/lng if available) |
| `adopter_preferences` | INSERT (one row: the 4 lifestyle fields + their `*_source = 'explicit'`, `is_cold_start = true`, `total_interactions = 0`) |

Both inserts in one transaction — a profile without its preferences row is an invalid
state every other endpoint would trip over.

---

## 2. `GET /adopters/me/feed` — ranked dog feed

The core product endpoint. One call returns everything the card UI needs.

**Query params:** `limit` (default 20, max 50) · `cursor` (opaque, optional).

**Response `200 OK`:**

```json
{
  "dogs": [ { "…dog card…": "see Conventions" } ],
  "next_cursor": "eyJrIjpbMC44NCwiNjlkMzc0MTAtLi4uIl19",
  "is_cold_start": true
}
```

**Server-side construction:**

1. **Tier-1 hard filter** — exactly the contracted SQL (`fetchr-data-contract.md` §2):
   `status = 'available' AND deleted_at IS NULL`; household clauses gated on the
   caller's profile facts, excluding only known-bad (`good_with_*_enc IS DISTINCT FROM 0`);
   size cap if `max_dog_size` is set; radius clause **omitted until the location gap
   closes**.
2. **Seen-exclusion** — anti-join against the caller's `adopter_interactions`
   (`ix_interactions_adopter_dog`).
3. **Rank** — `is_cold_start = true`: normalized save-popularity (partial index
   `ix_interactions_saves`) + freshness (`first_seen_at`), with diversity injection
   across `size_enc` × `breed_group` buckets (exact mechanism open).
   `is_cold_start = false`: preference-weighted scoring against `dog_features`
   (limited to size/age/coat/breed until the Phase 5 `*_score` columns land —
   contract §3.2).
4. **Card assembly** — trit→badge mapping, contact-link chain, `days_listed`
   derivation, household-relevant `compatibility_notes`.

**Errors:** `401` · `422 invalid_cursor`.

**Reads/writes:**

| Table | Access |
|---|---|
| `adopter_profiles` | READ (household gates, lat/lng, max_distance_miles) |
| `adopter_preferences` | READ (`is_cold_start`, `max_dog_size`, warm-start weights) |
| `adopter_interactions` | READ (seen-exclusion; popularity aggregate) |
| fetchr `dog_profiles` + `dog_features` | READ (contract columns only) |

No writes. Serving a feed is not an interaction; impressions-as-events is deliberately
out of MVP (an `impression` event type would 10× the log for unproven value).

---

## 3. `POST /adopters/me/interactions` — record a behavioral event

The highest-traffic endpoint. Append-only write path.

**Request:**

```json
{
  "dog_profile_id": "69d37410-135e-4a0d-9d90-a31d88adc666",
  "event_type": "right_swipe",
  "idempotency_key": "f4b9c2d7-6a1e-4c3b-9d8f-0e5a7b2c4d61",
  "metadata": { "source_screen": "feed" }
}
```

**Idempotency (decided 2026-07-20):** `idempotency_key` is a **required**,
client-generated UUID, minted once per user action and reused verbatim on retries.
The server enforces uniqueness on `(adopter_id, idempotency_key)` (unique index in
`adopter-erd.md`); the insert is `ON CONFLICT DO NOTHING`. A repeated key returns
`202` exactly as if accepted and **writes nothing** — retries are invisible, and the
append-only log stays duplicate-free. No `409` exists for this: from the client's
view, a retry succeeded.

`event_type` ∈ `right_swipe · left_swipe · save_to_watchlist · dismiss_from_watchlist ·
view_detail · contact_shelter · explicit_answer` (the ERD CHECK list, verbatim).

Per-type `metadata` validation (Pydantic discriminated union on `event_type`):

```
right_swipe / left_swipe:    { source_screen: "feed" | "watchlist" }
view_detail:                 { duration_seconds: int >= 0, source_screen: str }
contact_shelter:             { contact_url: str }   ← the URL actually shown (chain result)
explicit_answer:             { question_id: int, response: str | bool }
save_to_watchlist /
dismiss_from_watchlist:      { source_screen: str }
```

**Response `202 Accepted`, no body.** Fire-and-forget from the client's perspective;
`202` (not `204`) because side effects (threshold flip, trigger evaluation) may run
after the response.

**Server-side validation & side effects:**

- `dog_profile_id` is checked to exist in fetchr's `dog_profiles` (single PK lookup).
  Soft reference ≠ no validation — junk IDs in the irreplaceable log are forever.
  Unknown ID → `404 dog_not_found`.
- INSERT into `adopter_interactions` and increment
  `adopter_preferences.total_interactions` in the same transaction.
- If the count crosses the warm-start threshold N (value open), flip
  `is_cold_start = false`.
- Evaluate `question_trigger_config` rules against the caller's recent events; a fired
  question is *queued* (written to `adopter_question_events` at delivery time —
  delivery mechanism is post-MVP, see §Open questions).
- `explicit_answer` events additionally write the answer through to
  `adopter_preferences` (field from `question_trigger_config.maps_to_preference_field`,
  source `'explicit'`) and update `adopter_question_events.response/answered_at`.

**Errors:** `401` · `404 dog_not_found` · `422` (bad event_type, metadata shape
mismatch, missing or non-UUID `idempotency_key`). A duplicate `idempotency_key` is
**not** an error — it returns `202` with no write (see above).

**Reads/writes:**

| Table | Access |
|---|---|
| fetchr `dog_profiles` | READ (existence check on `id`) |
| `adopter_interactions` | INSERT `ON CONFLICT (adopter_id, idempotency_key) DO NOTHING` (never UPDATE) |
| `adopter_preferences` | UPDATE (counter, threshold flip, explicit answers) |
| `question_trigger_config` | READ (trigger evaluation) |
| `adopter_question_events` | UPDATE (only for `explicit_answer`) |

---

## 4. `GET /adopters/me/watchlist` — saved dogs

Dogs with a `save_to_watchlist` event not followed by a later
`dismiss_from_watchlist` (computed from the log — there is no watchlist table; the log
is the truth).

**Query params:** `limit` (default 20, max 50) · `cursor`.

**Response `200 OK`:**

```json
{
  "dogs": [
    {
      "…dog card…": "see Conventions — match_score omitted here",
      "saved_at": "2026-07-18T21:12:44Z",
      "status": "available",
      "status_changed_since_save": false,
      "still_listed": true
    }
  ],
  "next_cursor": null
}
```

Watchlist cards extend the shared card with save-state fields and **include dogs that
are no longer available** (`status_changed_since_save: true` when fetchr's status moved
after `saved_at`) — "Biscuit is now pending" is a feature, not a filter. If the dog was
hard-deleted from fetchr (soft reference means this is survivable), `still_listed:
false` and the card renders from the minimal fields the log retains
(`dog_profile_id` + saved_at) with a "no longer listed" state. Ordered by `saved_at
DESC`; cursor is keyset on `(saved_at, id)`.

**Errors:** `401` · `422 invalid_cursor`.

**Reads/writes:**

| Table | Access |
|---|---|
| `adopter_interactions` | READ (save/dismiss pairs via `ix_interactions_adopter_time`) |
| fetchr `dog_profiles` + `dog_features` | READ (card fields, current `status`) — LEFT JOIN; must tolerate missing rows |

No writes.

---

## 5. `GET /adopters/me/preferences` · `PATCH /adopters/me/preferences`

Powers the "your profile" settings screen: see what the app has learned, override it.

**GET response `200 OK`:**

```json
{
  "max_dog_size": "medium",
  "max_dog_size_source": "inferred",
  "preferred_age_range": "young",
  "preferred_age_source": "explicit",
  "preferred_breed_groups": ["Pit Bull Type", "Working"],
  "preferred_breed_source": "inferred",
  "preferred_gender": null,
  "preferred_gender_source": null,
  "activity_level": "moderate",
  "activity_level_source": "explicit",
  "home_type": "apartment",
  "home_type_source": "explicit",
  "experience_level": "first_time",
  "experience_level_source": "explicit",
  "hours_away": 9,
  "hours_away_source": "explicit",
  "ok_with_special_needs": null,
  "special_needs_source": null,
  "free_text_description": null,
  "is_cold_start": false,
  "total_interactions": 34
}
```

`null` = not yet known (UI: "still learning…"). Note the size translation at the API
boundary: stored as `SMALLINT` 1–4 (fetchr's `size_enc` scale, per the ERD), exposed
as `"small" | "medium" | "large" | "xlarge"` — clients never see encoding integers.

**PATCH request** (partial — send only what changes):

```json
{ "max_dog_size": "large", "activity_level": "active" }
```

Every field written via PATCH gets `*_source = 'explicit'` — a settings-screen edit is
by definition explicit, and the inference job will never overwrite it afterward.
Setting a field to `null` clears both value and source (back to "unknown, learnable").
`is_cold_start` / `total_interactions` are read-only; sending them → `422`.

**PATCH response `200 OK`:** the full updated object (same shape as GET).

**Errors:** `401` · `422` (unknown field, bad enum value, read-only field).

**Reads/writes:**

| Table | Access |
|---|---|
| `adopter_preferences` | GET: READ · PATCH: UPDATE (value+source pairs) |

---

## 6. `POST /adopters/me/search` — chatbot parse + search

Natural-language search: *"a calm smallish dog that's ok with my cat, not a puppy"* →
parsed constraints + ranked dogs. Two hard rules:

1. **The parser fills a validated struct, never SQL.** Whatever does the parsing (LLM
   or rules), its output is deserialized into the constraint schema below and
   Pydantic-validated — enums checked, ranges bounded, unknown keys rejected. The
   struct's fields map 1:1 onto contract columns, and the query builder binds them as
   parameters into the same Tier-1-shaped SQL as the feed. A hostile or hallucinated
   parse can produce at worst a wrong *filter*, never an injection.
2. **Tier-1 safety filters always apply**, unioned with the parsed constraints. "Show
   me huskies" from an adopter with a toddler still excludes `good_with_kids_enc = 0`
   — search is a lens on the safe pool, never a bypass (hard filters are never soft).

**Request:**

```json
{
  "query": "a calm smallish dog that's ok with my cat, not a puppy",
  "limit": 10
}
```

**The constraint struct** (the parser's entire output vocabulary — every field
optional, `null` = not constrained):

```json
{
  "size_max": "medium",
  "size_exact": null,
  "age_categories": ["young", "adult", "senior"],
  "gender": null,
  "breed_groups": [],
  "require_good_with_kids": null,
  "require_good_with_dogs": null,
  "require_good_with_cats": true,
  "house_trained": null,
  "max_days_listed": null,
  "description_terms": ["calm"]
}
```

- `size_max` / `size_exact` / `age_categories` / `gender` / `breed_groups`: enums
  matching contract values exactly (breed groups validated against the contract's
  observed list).
- **Breed constraints are positive-selection only (decided 2026-07-20).** There is no
  breed-exclusion field in the struct, and the parser must never translate a negative
  breed request into a constraint. "Show me pit bulls" parses into
  `breed_groups: ["Pit Bull Type"]`; **"no pit bulls" parses into nothing** — the
  phrase lands in `unmatched_terms` and the result set is unchanged. This makes
  pit-type exclusion structurally inexpressible rather than policy-checked, consistent
  with the dimension contract's rule that pit-type breed data is audit-only and never
  an exclusion filter (and with the breed-bias trap: 13% of live inventory is
  `Pit Bull Type`, 38% `Mixed/Unknown` — exclusion semantics on either would gut the
  pool). Adopters steer away from any breed the same way they always could: by
  swiping, which teaches the ranker without hiding dogs.
- `require_good_with_*: true` applies the **null-trap rule**, not a known-good
  requirement: it excludes known-bad (`IS DISTINCT FROM 0`) and *rank-boosts* known-good
  (`= 1`), with `not_confirmed` badges doing the honest work. Requiring `= 1` would
  silently hide most inventory (64% of cats-compat is unknown — contract §1.4).
- `description_terms`: soft signal only — rank boost via parameterized `ILIKE`/FTS on
  `description`, never a hard filter (descriptions are marketing text).
- No free-form field reaches SQL; `description_terms` entries are bound parameters.

**Response `200 OK`:**

```json
{
  "parsed_constraints": { "…the struct above, as applied…": "" },
  "unmatched_terms": ["fluffy"],
  "dogs": [ { "…dog card…": "see Conventions" } ],
  "total_matched": 14
}
```

`parsed_constraints` is echoed so the UI can show *"Showing: size ≤ medium · not a
puppy · cat-friendly"* chips — the adopter sees exactly what the parser understood,
and can correct it. `unmatched_terms` lists query fragments the parser couldn't map to
any constraint (honesty about the vocabulary boundary; e.g. "fluffy" until a coat
constraint is added). `total_matched` is the post-filter count (search is bounded, not
cursor-paginated — `limit` max 25; refine the query rather than paginate, MVP call).

**Ranking:** constraint-satisfying pool ranked by the same scorer as the feed
(cold-start popularity+freshness, or warm preference scoring), plus boosts for
known-good compat (`= 1` on required axes) and `description_terms` hits.

**Errors:** `401` · `422 query_too_long` (cap ~500 chars) · `422 unparseable_query`
(parser produced nothing usable **and** no terms matched — response includes
`unmatched_terms` so the UI can coach).

**Reads/writes:**

| Table | Access |
|---|---|
| `adopter_profiles` | READ (Tier-1 household gates) |
| `adopter_preferences` | READ (ranking weights, `is_cold_start`) |
| `adopter_interactions` | READ (popularity aggregate) — **no write**: there is no `search` event type in the decided enum; whether searches enter the log is open (§Open questions) |
| fetchr `dog_profiles` + `dog_features` | READ (contract columns; `description` for term boost) |

---

## Post-MVP surface (named so MVP doesn't paint over them)

```
GET    /adopters/me/questions/pending          — pop-up delivery (if not inline with feed)
POST   /adopters/me/questions/{qid}/answer     — pop-up answer (writes adopter_question_events)
DELETE /adopters/me                            — GDPR soft-delete + PII scrub
GET    /dogs/{dog_profile_id}                  — full detail page (feeds view_detail events)
/admin/…                                       — trigger config CRUD; explicit-ID adopter lookup
```

---

## Open questions (not resolvable from the docs — listed, not guessed)

1. **Onboarding ↔ auth-provider handshake.** `POST /adopters` is unauthenticated in
   the stub. With Supabase/Clerk (leaning, undecided), does signup happen provider-first
   (then this endpoint runs authenticated with a provider user-ID) or app-first? Decides
   whether `email` here is identity or a denormalized copy — same as ERD open question 7.
2. **Warm-start threshold N** for the `is_cold_start` flip (ERD open question 1).
3. **Cold-start diversity mechanism.** "Inject diversity across `size_enc` ×
   `breed_group` buckets" has no defined algorithm (round-robin buckets? quota per
   page?) nor a rule for when inventory can't fill the quota. Carried over from the
   June doc, still unresolved.
4. **Pop-up delivery channel.** Inline field on the feed response vs.
   `GET /questions/pending` polling. Affects the feed response shape, so it should be
   decided before the feed response is frozen — but it's a product-timing call the
   docs don't make.
5. **Should chatbot searches be logged as interactions?** Parsed constraints are
   strong explicit preference signal, but `search` is not in the decided event-type
   enum, and the enum was a do-not-revisit constraint. Needs an explicit decision to
   extend it.
6. **What parses the query.** LLM vs. rule-based parser (and if LLM: model, cost,
   latency budget, and whether `unmatched_terms` come from the model or a validator
   diff). The contract above is parser-agnostic on purpose.
7. **Rate limiting.** Both the swipe endpoint (bots) and the search endpoint (if
   LLM-backed, each call costs real money) need limits; strategy/provider undecided
   (carried over from June).
8. **Cursor lifetime/versioning.** Keyset cursors embed ranking keys; a ranking-logic
   deploy invalidates in-flight cursors. Silent restart vs. explicit `422` handling is
   a client-contract decision not covered by any doc.
9. **Geocoder failure follow-up.** `geocoded: false` at onboarding — is there a retry
   job, and does the client ever need to re-prompt for location? Depends on the
   geocoding-provider decision (ERD open question 2).

> Resolved since first draft (2026-07-20): **idempotency** (required client UUID key,
> unique on `(adopter_id, idempotency_key)`, duplicate → `202` no-write — see §3) and
> **breed exclusion in search** (positive selection only; "no pit bulls" is never
> parsed — see §6).

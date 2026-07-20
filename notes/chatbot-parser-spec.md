# Chatbot Parser Specification

> Definitive design for translating adopter search text into the constraint struct
> accepted by `POST /adopters/me/search`. Doc only; no implementation yet.
>
> This replaces the fetchr Streamlit demo plan for this app and resolves API open
> question 6: parsing uses the Anthropic API with structured output.

## 1. Scope and invariant

The parser performs extraction only:

```text
validated text
  -> Anthropic structured-output call
  -> validated parser envelope
  -> constraint struct + unmatched_terms
  -> shared matcher described in matching-logic.md §7
```

The LLM never writes SQL, SQL fragments, column names, or ordering expressions. It
may populate only a typed, enum-constrained Pydantic model. Unknown fields are
forbidden. The application converts the validated struct into parameterized queries
and passes the resulting candidate pool to the existing scorer.

This is an anti-corruption layer: model output is untrusted data until Pydantic has
validated it.

## 2. Public request validation

Before acquiring an Anthropic client or spending an API token:

1. Require `query` to be a string.
2. Trim leading and trailing Unicode whitespace.
3. Reject an empty result with `422 empty_query`.
4. Reject text longer than 500 Unicode code points with `422 query_too_long`.
5. Validate the endpoint's `limit` using the API contract (`1..25`).

Do not silently truncate. Truncation can remove negation and change meaning. Raw
query text is not logged by default because it may contain personal information.

## 3. Shared vocabulary

The parser imports controlled values from the same application vocabulary module as
the matcher and API schemas. It must not redeclare literals in its own module or
derive them dynamically during a request.

The module is generated/verified from the fetchr data contract and contains:

- Sizes: `small`, `medium`, `large`, `xlarge`.
- Age categories: `puppy`, `young`, `adult`, `senior`.
- Genders: `male`, `female`.
- Breed groups: `Mixed/Unknown`, `Working`, `Sporting`, `Pit Bull Type`, `Herding`,
  `Toy`, `Non-Sporting`, `Hound`, `Terrier`.

These are the live observed values documented in `fetchr-data-contract.md`. Contract
changes require an intentional vocabulary update and parser eval run.

## 4. Structured output contract

Anthropic structured output targets a parser envelope, not the endpoint response:

```text
ParsedSearch:
  constraints:
    size_max: Size | null
    size_exact: Size | null
    age_categories: list[AgeCategory]
    gender: Gender | null
    breed_groups: list[BreedGroup]
    require_good_with_kids: bool | null
    require_good_with_dogs: bool | null
    require_good_with_cats: bool | null
    house_trained: bool | null
    max_days_listed: integer[0..36500] | null
    description_terms: list[string]
  unmatched_terms: list[string]
```

Defaults are empty lists or `null`; unknown keys are rejected. Additional validation:

- `size_max` and `size_exact` are mutually exclusive. If both are emitted, reject the
  model output rather than choosing one.
- Lists are deduplicated while preserving first occurrence.
- `description_terms` contains at most 5 entries; each is trimmed, non-empty, and at
  most 40 code points. Terms remain bound SQL/FTS parameters downstream.
- `unmatched_terms` contains at most 10 short source phrases, each trimmed, non-empty,
  and at most 80 code points.
- A false compatibility value means the user explicitly requested incompatibility.
  Because the API currently documents only positive/null-trap behavior, false values
  must fail validation until their downstream semantics are decided (open question 1).

The endpoint returns `constraints` as `parsed_constraints` after validation. It does
not expose model prose or raw provider output.

## 5. Producing `unmatched_terms`

`unmatched_terms` is produced by the LLM in the same structured response as the
constraints. The system prompt requires short, verbatim-or-near-verbatim source
phrases that influenced no constraint.

This is preferable to a validator diff. A text diff cannot reliably account for
paraphrase, morphology, negation, or one phrase mapping to several enum values. For
example, `not a puppy` maps to three allowed age categories; subtracting serialized
values from the source text would incorrectly label most of the input unmatched.

The application still validates and normalizes this list, but does not invent terms.
If a valid constraint and an unmatched term conflict, the constraint wins for
execution and the conflict is logged for eval review.

Required breed behavior:

- Positive selection is allowed: `show me pit bulls` ->
  `breed_groups=["Pit Bull Type"]`.
- Breed exclusion is forbidden for every group. `no pit bulls` produces no breed
  constraint and places `no pit bulls` in `unmatched_terms`.
- The schema has no negative-breed or excluded-breed field. Prompt injection cannot
  make that operation expressible.

## 6. System prompt contract

The stable system prompt must state:

1. Extract only fields in `ParsedSearch`; never output SQL or prose.
2. Use only imported enum values supplied in the schema/prompt.
3. Populate a field only when supported by the user's words; do not infer household
   facts or safety constraints from stereotypes.
4. Map ordinary synonyms to contract values where unambiguous (`tiny` -> `small`,
   `older dog` -> `senior`).
5. Treat negated ages as an allowed set (`not a puppy` -> `young, adult, senior`).
6. Permit positive breed-group selection only. Put every negative breed request in
   `unmatched_terms` and emit no breed constraint.
7. Put unsupported concepts and ambiguous fragments in `unmatched_terms` rather than
   guessing or fabricating a dimension.
8. Put fuzzy descriptive words such as `calm` in `description_terms`; these are soft
   rank signals, never hard filters.
9. Do not weaken or override adopter safety filters. The parser does not receive or
   modify those filters.

The complete enum vocabulary and instructions form a stable prompt block marked for
Anthropic prompt caching. The adopter's text is a separate user message and is never
included in the cached block.

## 7. Anthropic client and model configuration

FastAPI provides an async Anthropic client through dependency injection. No client is
created at import time. This keeps credentials scoped, supports connection reuse, and
allows tests to inject a fake client.

The endpoint is `async` because the provider call can hold the HTTP connection open
for seconds. Database work should not occupy a transaction while awaiting the model.
Parse first, then open/use the DB session for filtering and ranking.

Configuration comes from environment-backed application settings:

- `ANTHROPIC_API_KEY`: required secret; never logged.
- `SEARCH_MODEL`: model identifier. The deployment default is configured centrally,
  not embedded in parser code.
- `SEARCH_MAX_TOKENS`: small extraction budget; start at `512` and tune from observed
  structured-output sizes.

The original plan's model policy survives: use the configured default for quality,
and document a cheaper/faster model as a one-setting swap after the golden eval set
shows acceptable accuracy. Model names are operational configuration because provider
availability changes; this spec does not freeze one.

## 8. Parse flow pseudocode

```text
parse_and_search(current_adopter, request):
    text = validate_and_normalize_input(request.query)       # no API spend yet
    enforce_search_rate_limit(current_adopter, client_ip)

    parsed = await anthropic_client.structured_message(
        model = settings.search_model,
        max_tokens = settings.search_max_tokens,
        cached_system_prompt = build_stable_prompt(shared_vocab),
        user_text = text,
        output_schema = ParsedSearch,
    )

    if response_is_refusal(parsed.response):
        raise SafeSearchError("We couldn't understand that search. Try rephrasing it.")

    validated = ParsedSearch.model_validate(parsed.output)
    constraints = validate_cross_field_rules(validated.constraints)

    if constraints.is_empty() and validated.unmatched_terms is empty:
        raise 422 unparseable_query

    return shared_matcher.search_rank(
        adopter = current_adopter,
        parsed_constraints = constraints,
        limit = request.limit,
    ) plus validated.unmatched_terms
```

The parser never opens a fetchr table directly. The shared matcher owns candidate
selection and ranking, including Tier-1 adopter safety, null-trap behavior, cold/warm
base score, known-good compatibility boosts, and description-term boosts exactly as
specified in `matching-logic.md` §7. Search remains a lens on the safe pool, not a
parallel query path.

## 9. Error handling and logging

Provider and parser failures map to one safe user-facing failure message; internal
details are never returned:

| Internal class | Server action | Client behavior |
|---|---|---|
| Anthropic authentication/configuration | Log at error level; alert operations | Safe `503 search_unavailable` |
| Provider rate limit | Honor retry metadata; bounded SDK retry only | Safe `503 search_unavailable` |
| Provider 5xx/network timeout | Bounded retry; log at warning/error | Safe `503 search_unavailable` |
| Model refusal | Log refusal category, not content | Safe `422 unparseable_query` |
| Structured-output/Pydantic validation failure | Log schema errors and output fingerprint | Safe `422 unparseable_query` |

For every provider call, log structured fields: internal correlation ID, Anthropic
request ID, adopter ID (or one-way operational identifier), model, latency, input
length, token usage, prompt-cache read/write tokens, outcome class, constraint field
names populated, unmatched-term count, and result count. Do not log the API key, raw
provider output, or raw user text by default.

## 10. MVP denial-of-wallet protection

Use an application-level token bucket backed by Redis, keyed by authenticated adopter
ID, with a secondary IP key for the stub-auth/public edge:

- Per adopter: capacity 10 searches, refill 1 token every 60 seconds.
- Per IP: capacity 20 searches, refill 1 token every 60 seconds.
- A request must pass both buckets; rejected requests return `429 rate_limited` with
  `Retry-After` and do not call Anthropic.
- Validate empty/oversized input before consuming a token; consume immediately before
  the provider call.
- Set a global circuit breaker/budget guard that disables new parser calls when a
  configurable hourly request or spend ceiling is reached; return `503
  search_unavailable` rather than continuing to spend.

Redis makes limits consistent across FastAPI workers and survives process restarts.
Until Redis is available in local-only development, a single-process in-memory bucket
may implement the same interface, but it is explicitly not acceptable for public
deployment. This protects cost as well as availability; endpoint auth alone does not.

## 11. Tests and eval harness

Deterministic unit tests use an injected fake Anthropic client and make no network
calls. Cover input validation, schema rejection, cross-field rules, breed negation,
refusal/auth/rate-limit/validation mapping, prompt-cache configuration, and the rule
that no DB session is used before parsing succeeds.

The LLM eval harness contains a versioned golden set of:

```text
(input text, expected constraints, expected unmatched_terms)
```

Minimum categories: direct enum requests, synonyms, combined constraints, age
negation, positive Pit Bull Type selection, negative breed requests, unsupported
concepts, ambiguous text, prompt-injection attempts, and empty/no-constraint output.

It runs on demand against the real configured model, records model and prompt version,
and is marked/skipped in CI by default. Prompt or model changes require a before/after
eval report; ordinary CI uses mocked parser tests only.

## 12. Explicitly not in MVP

- LLM-generated SQL or direct model access to the database.
- A separate Streamlit search application or fetchr-owned query path.
- Embeddings, semantic reranking, conversational memory, multi-turn clarification, or
  tool-calling agents.
- Using searches as behavioral interactions or updating inferred preferences from
  search text.
- Negative breed filtering.
- Dynamic per-request vocabulary reads from fetchr tables.
- Logging full user prompts by default.
- Provider fallback or multi-model routing.
- Pagination of search results; the API's bounded `limit <= 25` remains authoritative.

## 13. Open questions

1. **Negative compatibility semantics.** The API struct types the fields as booleans,
   but only `true` behavior is specified. Should phrases such as `not good with cats`
   be rejected, unmatched, or become a known-negative filter?
2. **Description term language support.** Is MVP English-only, and if not, where does
   normalization/translation occur before matching English descriptions?
3. **Operational budget ceiling.** What exact hourly request or dollar ceiling should
   trip the global denial-of-wallet circuit breaker?
4. **Timeout and retry budget.** The docs do not define the endpoint latency SLO,
   provider timeout, or maximum total retry time.
5. **Redis deployment.** Hosting is currently local-only, so the production Redis
   provider and failure policy (fail open vs. fail closed) are undecided.
6. **Prompt and eval ownership.** The repository docs do not name who approves prompt,
   vocabulary, model, and golden-set changes.
7. **Search logging as product data.** The API leaves open whether successful searches
   should become a new append-only interaction event; this spec deliberately does not
   extend the locked event enum.

# Adopter Web Roadmap — Deferred Decisions

This note records adopter-web decisions that are intentionally **not** part of the current
landing-page slice. The authoritative matching, schema, API, and fetchr-boundary contracts remain
in the other documents in this directory.

## Public discovery, later

- Add two homepage paths only after both are functional: **Find my match** and **Browse all dogs**.
- Browse should be a photo-led grid with a sticky filter bar. A map is a later enhancement.
- Public filters use the shared dimension vocabulary. Do not expose raw breed-name filters; use
  breed groups, and do not add an energy filter before the live contract provides the score.
- Reconcile browse and matching routes with `matching-app-api.md`; do not invent generic `/dogs`
  or `/match` endpoints in isolation.

## Rendering and data flow, later

- Next.js communicates only with FastAPI, never directly with Postgres.
- FastAPI keeps the fetchr boundary: read only `dog_features JOIN dog_profiles`, and never import
  fetchr's SQLAlchemy models or write to fetchr-owned tables.
- Keep public search and filtering in Postgres at launch. Elasticsearch is unnecessary.
- Use SSR or ISR for public dog-detail pages when those routes exist. Public browse inventory may
  use stale-while-revalidate caching; personalized questionnaire results must not be cached.
- Continue using `next/image`. When shelter photos are integrated, copy them into controlled object
  storage/CDN so the product does not depend on disappearing source URLs.

## Experience improvements, later

- Make the questionnaire conversational: smaller steps, large tappable choices, and visible
  progress. Preserve the same typed preference vocabulary.
- If embeddings are introduced in a later matching stage, reuse dog vectors for both personalized
  matching and "similar dogs." Do not introduce pgvector or embeddings during the structured v1.

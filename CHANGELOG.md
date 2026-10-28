# Changelog

All work in this repository was built during the Meta Global AI Developer Hackathon
(27 Oct – 4 Nov 2026). Dates are Sydney time. No code is copied from earlier Lumina
repositories (`LuminaSpatialInsightsXR`, `LuminaSpatial`, `extended-tableau-mcp`).

## 2026-10-28 (Wed), afternoon

### Added
- API contracts (`src/lib/contracts.ts`): `MapAction` identical to the Quest app, facts, follow-ups,
  chart requests, `AskRequest` / `AskResponse`, verification.
- Station registry for the 10 stations (approximate coordinates until GTFS ingest).
- PostGIS schema (`db/schema.sql`) with governed aggregate views, minimum cell size of 10 sales,
  and a read-only `agent_ro` role that cannot read row-level tables.
- Database client: PGlite + PostGIS in process for dev and tests, node-postgres for managed Postgres.
- Synthetic demo data generator, labelled "Demo data" in datasets, facts, sources and answers.
- Metrics catalogue: median price, price per m² of land, sales count, 12-month momentum, transit
  premium, transit-affordable share, patronage and patronage change, four land-use cover metrics.
- Governed tools: `query_metric`, `land_use`, `run_sql` (libpg-query parse, view allowlist,
  function denylist, row limit, read-only transaction, timeout), `search_place`, `list_datasets`.
- Agent graph (LangGraph.js): plan ⇄ tools (max 5 calls) → compose → deterministic verify →
  retry once → template fallback → respond. Charts built server-side from cited facts (Vega-Lite).
- Providers: Muse Spark (Meta Model API), Muse Spark Open (Baseten), and an offline rule-based
  planner for tests and keyless dev.
- Headless API v1: `/ask` (JSON or streamed progress), `/stations`, `/metrics`, `/landuse/{station}`,
  `/health`; CORS for the Quest app; per-IP rate limit.
- Tests (Vitest, 41): verifier, SQL guard, metric hand checks on Chatswood and Parramatta,
  suppression, role permissions, agent retry and fallback paths.
- Eval script v1 (`npm run eval`): 22 questions; offline baseline 19/22.

- Portal Ask page: MapLibre map (open basemap with an offline fallback ground) that runs the
  agent's map actions; conversation with streamed progress; every figure rendered as a
  numbered, traceable fact with a ledger of label, source and as-of date; verification
  details (checks, tool calls, SQL); Vega-Lite charts; land-use panel; follow-ups; demo-data
  and offline-planner notices. Responsive down to phone width; dark mode.
- `templates` in `AskResponse`: the answer lines with `{fN}` placeholders for clients.

### Changed
- Public Sans loaded from Google Fonts in the browser instead of `next/font` (the build
  environment cannot reach Google Fonts).

## 2026-10-28 (Wed), morning

### Added
- Next.js app scaffold (App Router, TypeScript, Tailwind, ESLint) via `create-next-app`.
- `CHANGELOG.md`, `LICENSE` placeholder (licence to be chosen before the repo goes public),
  `.env.example` for the Meta Model API key and model ids.
- Day-1 spike harness in `spikes/`:
  - `01-muse-spark-tools.ts`: Muse Spark native tool calling through LangChain.js
    (`ChatOpenAI` against `https://api.meta.ai/v1`), on Chat Completions and Responses,
    with Zod argument checks and a fact-placeholder check on the answer.
  - `fetch-nsw-chips.ts` + `02-sam-landuse.ts`: two 1024 px aerial chips (Parramatta,
    Chatswood) from NSW Spatial Services, segmented by SAM 3.1 for building, tree canopy,
    car park and construction site; % cover per class and SVG overlays.
  - `03-voice-transcribe.ts`: Muse Voice Transcribe one-shot upload, with and without
    station-name keyword biasing, scored by word error rate.
  - `mock-meta-server.ts`: offline stand-in that checks request shapes against the
    documented API rules and logs payloads.
- Spike notes: `docs/spikes/2026-10-28-day1.md` (model ids, API call shapes, dry-run
  findings, live-run checklist).

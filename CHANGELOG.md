# Changelog

All work in this repository was built during the Meta Global AI Developer Hackathon
(27 Oct – 4 Nov 2026). Dates are Sydney time. No code is copied from earlier Lumina
repositories (`LuminaSpatialInsightsXR`, `LuminaSpatial`, `extended-tableau-mcp`).

## 2026-10-28 (Wed)

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

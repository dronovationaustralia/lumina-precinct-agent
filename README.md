# Lumina Precinct Agent

**Screen any of Sydney's 185 train and metro station precincts in minutes. Ask in plain English;
every figure is computed from NSW open data, checked before you see it, and shown on the map.**

A Dronovation Labs product, built for the Meta Global AI Developer Hackathon (27 Oct – 4 Nov 2026),
Startup track, theme *Build for Your World*.

**Live:** https://lumina.dronovation.com.au · click **Try the demo (no account)** · [About](https://lumina.dronovation.com.au/about)

**Demo video (2:59):** https://youtu.be/T2Vyb7nBRpg

## The problem

NSW is putting new homes near train stations (the Transport Oriented Development reforms). The
people deciding where (developers, site-acquisition analysts, lenders and planners) still judge
a station precinct from spreadsheets, scattered open data and site visits. Answering "is this
precinct worth a feasibility study?" takes days, and the numbers are rarely traceable.

Lumina answers those questions in seconds, for every station at once, with a source and date on
every figure and a map that shows the answer.

| Who | What they ask | What Lumina gives them |
| --- | --- | --- |
| **Developers and site analysts** (primary) | Where is momentum? Where is land? | Station screener across all 185 stations, opportunity sites found by SAM 3.1, precinct due diligence playbook |
| **Lenders and valuers** | Is this median supported by enough sales? How is it trending? | Sales counts behind every median, 12-month change, suppression below 10 sales |
| **Planners** | How is this centre changing? | Patronage and its change, land use, aerial cover, corridor tours |

## Try it (two minutes)

1. Open the live link and choose **Try the demo**. Pick a work type; it shapes the playbooks.
2. **Screen:** ask *"Which stations under $900k unit median had the strongest unit price growth?"*
   All 185 station dots recolour and the leaders pulse.
3. **See what SAM saw:** select **Chatswood** (SAM 3.1 layers cover 10 stations: Auburn, Chatswood,
   Granville, Harris Park, Milsons Point, North Sydney, Parramatta, St Leonards, Westmead, Wynyard), open the land-use panel and click
   **Show what SAM 3.1 saw**. The map switches to the aerial photo and reveals buildings, tree
   canopy, car parks and construction sites as SAM segmented them.
4. **Find land:** ask *"Show me large car parks near Parramatta."*
5. **Ask by voice** with the microphone, **Brief me** for a Muse Image precinct card, **Tour** the
   North Shore line, and **Share** any answer as a public link.
6. Under every answer, open **How this answer was made**: the model trail, data calls and checks.

## Where Meta AI is used

| Model | What it does in Lumina | Code |
| --- | --- | --- |
| **Muse Spark 1.3** | The agent. Plans which governed data calls answer the question (native tool calling), then writes the answer with a placeholder for every figure, plus map actions. Also writes optional tour headlines, verified the same way. | `src/server/agent/`, `src/server/tour.ts` |
| **SAM 3.1** | Segments NSW aerial imagery around stations into building, tree canopy, car park and construction site: cover % per ring, the "What SAM 3.1 sees" map layer, and opportunity sites (car parks and construction sites as outlines with area and distance). | `scripts/sam/`, `src/server/db/real-cover*.ts`, `real-sites.ts` |
| **Muse Voice Transcribe** | Ask by voice; hinted with station names. | `src/server/voice.ts`, `MicButton.tsx` |
| **Muse Image** | "Brief me" precinct cards: an illustration with no text or numbers; the verified figures are drawn over it by our code and the picture is labelled AI-generated. | `src/server/briefing.ts` |
| **Muse Code** | Built parts of Lumina itself: 10 commits marked `Built-with: Muse Code` (see below). | `docs/muse-code/` |

## How every figure is checked

- **The model never writes a number.** Tools register each figure as a numbered fact; Muse Spark
  writes `{f3}`, never digits. A deterministic verifier (no model) checks every placeholder, bans
  causal, predictive and advice wording, validates map actions and charts, and confirms all SQL
  went through the guard. A failed draft is retried once, then replaced by a template answer.
  The result is returned as `verification` on every answer.
- **Governed data.** Metrics are defined once (`src/server/metrics/catalogue.ts`). The agent's
  database role can read only aggregate views, never individual sales; medians from fewer than
  10 sales are suppressed. `run_sql` is parsed with the real Postgres parser, allowlisted,
  row-limited and run read-only with a timeout. The deployed app holds only read-only credentials.
- **Share links cannot be forged.** Answers are signed by the server when they are produced; a
  public link carries the signed answer and never re-runs the agent.

## Architecture

```
Clients: Portal | Quest app | curl / agents
                 \     |     /
        Headless API  /api/v1/*  (Next.js 16 route handlers, sign-in or API key)
                       |
        Agent graph (LangGraph.js on Muse Spark)
  plan <-> tools (governed) -> compose -> verify -> respond
                                  ^          |
                                  +-- retry once, then template fallback
                       |
  Tools: query_metric | rank_stations | find_sites | land_use | run_sql | search_place | list_datasets
                       |
  Postgres 16 + PostGIS (Azure): aggregate views only, read-only agent role
                       ^
  Offline pipelines: NSW sales, patronage, land use, GTFS; SAM 3.1 batch on NSW aerial imagery
```

Map actions (`fly_to`, `set_radius`, `highlight`, `compare`, `show_layer`) and Vega-Lite charts are
data, so the portal and the Quest app render the same answer.

## Evaluation

26 fixed questions (prices, momentum, transit premium, patronage, land use, aerial cover,
screening, opportunity sites, out-of-scope and advice traps), scored on schema, verified numbers,
wording and tool choice. Latest results: [`evals/results-meta.md`](evals/results-meta.md); every run
is archived in `evals/runs/`.

| Run | Data | Pass | p50 | p95 | Cost per answer |
| --- | --- | --- | --- | --- | --- |
| Muse Spark 1.3, reasoning effort low, 2 Nov | Real NSW data, 185 stations, Azure Postgres | **26 / 26, all verified** | 9.2 s | 15.5 s | US$0.024 |
| Muse Spark 1.3, reasoning effort low, 29 Oct | Demo data, 10 stations | 22 / 22 | 7.2 s | 12.0 s | US$0.016 |
| Offline rules baseline (no model) | Demo data | 19 / 22 | 0.3 s | 1.3 s | none |

```bash
npm run eval -- --provider meta       # Muse Spark (needs MODEL_API_KEY)
npm run eval -- --provider offline    # rule-based baseline
```

## Data

| Dataset | Use | Licence |
| --- | --- | --- |
| NSW Valuer General property sales | Medians, sales counts, momentum, price hexagons | Valuer General NSW; locations from G-NAF © Geoscape Australia (Open G-NAF EULA) |
| Transport for NSW train station entries and exits | Station trips and their change | CC BY 4.0, Transport for NSW |
| Transport for NSW GTFS | Stations, lines, line order | CC BY 4.0, Transport for NSW |
| NSW Landuse 2017 v1.5 | Land-use mix per ring and map layer | CC BY 4.0, NSW DCCEEW |
| NSW Spatial Services aerial imagery | SAM 3.1 input and the aerial basemap | CC BY 4.0, © Spatial Services, NSW Department of Customer Service |
| ABS ASGS (suburbs, LGAs, postcodes) | Boundaries | CC BY 4.0, Australian Bureau of Statistics |
| OpenStreetMap / OpenFreeMap | Basemap | ODbL, © OpenStreetMap contributors |

Individual sales never leave the private data pipeline; the app stores aggregates per ring and
per hexagon only. SAM figures come from one aerial capture: they show land cover, not change.

## Built during the hackathon

The product was built between 28 Oct and 4 Nov 2026 (commits after 4 Nov add only the licence, the video link, demo-video tooling, freezing deploys, a read-only uptime monitor and removing personal details from docs); [`CHANGELOG.md`](CHANGELOG.md)
records the progress day by day. Muse Code built these features from the task pack in
`docs/muse-code/`, each reviewed before merge (`git log --grep "Built-with: Muse Code"`):

| Commit | Feature |
| --- | --- |
| `d77eef2`, `d28d619` | Voice questions: endpoint and microphone button |
| `da6e7a3` | Brief me: Muse Image briefing card |
| `a8ada36` | SAM 3.1 checker and shared concepts |
| `52b5edb` | Station screener across all 185 stations |
| `bd1391e` | Opportunity sites found by SAM 3.1 |
| `57d1c16` | Corridor tours |
| `b8bc157` | Share links with rich previews |
| `f204387` | What SAM 3.1 sees: segmentation over the aerial photo |
| `bf5cabb` | Guided playbooks, "What can I ask?" and the any-city story |

## Built to work for any city

Live for Sydney. The engine is city-agnostic: stations and lines come from GTFS (published by
1,000+ transit agencies), places and land use from OpenStreetMap, aerial cover from SAM 3.1 on
any aerial or drone imagery (Dronovation's own drone surveys can replace public imagery), and
prices from a pluggable registry adapter (NSW Valuer General today; UK Land Registry and New York
rolling sales are next).

## Run it locally

Requires Node.js 22.9 or later.

```bash
npm install
cp .env.example .env.local   # paste your Meta Model API key into MODEL_API_KEY
npm run dev                  # http://localhost:3000
npm test                     # verifier, SQL guard, metrics, agent graph, share links, SAM georeferencing
```

Without `MODEL_API_KEY` a rule-based offline planner answers (not a model; for tests and keyless
development). Without `DATABASE_URL` the app runs an in-process PGlite database with PostGIS and
synthetic data labelled "Demo data" everywhere.

## API (v1)

All routes need a session or an API key, except `/api/v1/health`.

| Route | Purpose |
| --- | --- |
| `POST /api/v1/ask` | Question → lines, facts, sources, actions, follow-ups, chart, verification, meta, share token. `Accept: text/event-stream` streams progress |
| `POST /api/v1/transcribe` | Audio → text (Muse Voice Transcribe) |
| `GET /api/v1/briefing/{station}` | Muse Image illustration and verified figures |
| `GET /api/v1/tour/{tour}` | Stops with verified figures and headlines |
| `GET /api/v1/stations`, `/metrics`, `/landuse/{station}`, `/summary` | Stations, metrics, land use |
| `GET /api/v1/layers/{sales-hex, station-metric, sites, sam, landuse}` | Map layers |
| `POST /api/v1/share` | Public link for a server-signed answer or a precinct card |
| `GET /api/v1/health` | Provider, model, build commit, database, dataset versions |

## Deploy

Azure, Australia East: App Service (Node 22, Next.js standalone) and Azure Database for PostgreSQL
Flexible Server 16 with PostGIS. Deploys run from GitHub Actions with OpenID Connect, replace the
app folder, restart, and wait until the live app reports the new commit. Sign-in: Microsoft Entra
ID (invited users only) plus a no-account demo session.

## Limits, stated plainly

- General information, not financial advice. Figures describe what happened; Lumina does not
  forecast or say why.
- SAM 3.1 tree canopy is likely an undercount where canopy is continuous or shaded; construction
  site is the least reliable class. Opportunity sites are candidates for investigation; zoning and
  ownership are not checked.
- Rents, schools and planning controls are not included yet.

## Licence

Source available under the [PolyForm Noncommercial License 1.0.0](LICENSE): free to read, run and
adapt for noncommercial purposes (personal use, research, education, hackathon judging).
Commercial use needs a licence from Dronovation Australia; contact info@dronovation.com.au.
The datasets keep their own licences (see Data above).

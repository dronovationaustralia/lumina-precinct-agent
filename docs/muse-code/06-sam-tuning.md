Tune the SAM 3.1 aerial land-cover batch (`scripts/sam/batch.ts`) so its cover figures for Chatswood are believable, then run it for the 10 featured stations.

Context: read `AGENTS.md` and the header of `scripts/sam/batch.ts`. The batch fetches NSW aerial imagery chips (1024 px at 0.5 m) around a station, asks SAM 3.1 (Meta Model API, key `MODEL_API_KEY` in `.env.local`) for masks per prompt, merges them and writes cover % within 400 m and 800 m to `data/derived/sam_cover.csv`, plus `data/derived/sam/<station>.svg` overlays and `summary.json`. SAM returns at most ~100 objects per image; tiles that hit the ceiling are split into quarters. Responses are cached under `data/derived/sam/cache/`, so re-runs only pay for new tiles; if you change prompts or tiling, the cache key changes.

Known problems in the last Chatswood run (building 22.8%, tree canopy 4% within 800 m):
- Buildings: well found in the centre, west and south, but the east side (chips `chatswood-0.5-3-*`) came back with almost no objects although it is dense housing.
- Tree canopy: "tree" finds single crowns only; "forest" catches a few bush patches. Most street and garden canopy and the Blue Gum Creek bushland (west) are missed. Sydney's North Shore has high canopy, so 4% is far too low.

Do this:
1. Run `npm run sam:batch -- --stations chatswood` and read `data/derived/sam/summary.json`.
2. Write `scripts/sam/check.ts` (npm script `sam:check`) that, for a station, reports per chip and per class: number of objects and cover %, and a rough vegetation share from the imagery itself (fraction of pixels where excess green 2G - R - B is clearly positive, using `sharp`). Flag chips where building objects are under 10 or tree cover is under a third of the vegetation share. Use it after every run.
3. Improve the batch until no chip is flagged for buildings and tree canopy is within a sensible range of the vegetation share (canopy is a subset of vegetation; grass is green too). Options to try, one at a time, measuring each: different prompts (e.g. "rooftop", "roof", "trees", "tree canopy", "woodland"), smaller start tiles for some classes, a lower split ceiling. Keep what helps, drop what does not.
4. Then run all featured stations: `npm run sam:batch`.

Budget: at most 1,500 new SAM calls in total (the batch prints the count). Stop and report if you would exceed it.

Rules: never commit anything under `data/`; do not change the app or the verifier; keep the code changes in `scripts/sam/` plus the npm script. Run `npm test`, `npm run typecheck`, `npm run lint`. CHANGELOG entry (Sydney date): what you changed in the SAM batch and the before/after cover for Chatswood (built with Muse Code). Finish with a short report: what you tried, Chatswood before/after per class, the 10 stations' 800 m figures, and the number of SAM calls used.

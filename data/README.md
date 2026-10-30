# Data

Raw downloads go in `data/raw/` (gitignored: licences vary and this repo goes public).
Only per-ring aggregates computed from them are published.

| Folder | Source | Used for |
| --- | --- | --- |
| `data/raw/vg/` | NSW Valuer General bulk property sales: annual zips for 2024 and 2025 plus 2026 weekly zips. Creative Commons Attribution (credit Valuation NSW) | Sales |
| `data/raw/gnaf/` | G-NAF Core (Geoscape, data.gov.au), latest quarter, GDA2020. Open G-NAF EULA (CC BY 4.0 based) | Coordinates for sale addresses |
| `data/raw/gtfs/` | Transport for NSW GTFS static timetable (`stops.txt`) | Station coordinates |
| `data/raw/patronage/` | Transport for NSW train station entries and exits | Patronage |

## Steps

```powershell
npm run ingest:sales                       # = ingest:vg, ingest:gnaf, ingest:geocode
npm run ingest:patronage                   # TfNSW entries and exits -> data/derived/patronage.csv
npm run ingest:gtfs                        # station locations + rail network -> committed files
npm run ingest:boundaries                  # ABS suburbs, LGAs, postcodes -> public/data/boundaries.geojson
npm run fetch:landuse                      # NSW Landuse 2017 around every station (NSW map service)
npm run ingest:landuse                     # -> data/derived/landuse.ndjson with ten categories
npm run dev                                # local database loads the real data automatically
npm run db:setup -- --load-real            # or load sales and patronage into Postgres (DATABASE_URL)
```

1. `ingest:vg` parses every zip in `data/raw/vg` into `data/derived/vg_sales.csv`: residential,
   whole-property, arm's-length sales, one row per transfer. The 24-month window ends three months
   before the latest contract date (`--lag-months 3`), because recent sales are still being lodged.
2. `ingest:gnaf` streams the G-NAF zip (no extraction needed) and keeps addresses within 5.6 km of
   a station: `data/derived/gnaf_near_stations.csv`.
3. `ingest:geocode` matches sales to those addresses (lot/plan, then street address, then building)
   and computes Greater Sydney reference medians. `geocode_summary.json` reports match rates.
4. Loading keeps only date, price, type, land area and the point; street addresses are not stored.
5. `ingest:patronage` reads every CSV in `data/raw/patronage` ("Train Station Entries and Exits",
   monthly) and keeps each station's own train row (Chatswood's shared train/metro row). Nearby light
   rail stops and separate metro stations (Victoria Cross, Crows Nest, Barangaroo) are not added in.

6. `ingest:gtfs` reads `stops.txt` from the GTFS zip in `data/raw/gtfs` (no extraction) and takes
   each station's parent stop. Its small output is committed, so deployed apps use it too.

`data/derived/` is gitignored too. Set `LUMINA_REAL_DATA=off` to run locally on demo data.

## Credits

- Property sales: Valuation NSW, NSW Valuer General bulk sales data (Creative Commons Attribution).
- Land use: NSW Landuse 2017 v1.5, NSW Department of Climate Change, Energy, the Environment and Water (CC BY 4.0).
- Suburb, LGA and postcode boundaries: Australian Bureau of Statistics, ASGS Edition 3 (CC BY 4.0).
- Station patronage and locations: Transport for NSW, Train Station Entries and Exits and GTFS
  Timetables Complete (CC BY 4.0).
- Address locations: Incorporates or developed using G-NAF © Geoscape Australia licensed by the
  Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence
  Agreement.

## Aerial land cover (SAM 3.1)

`npm run sam:batch` measures tree canopy, buildings, grass and paved area within 400 m and 800 m
of the featured stations from NSW aerial imagery, using SAM 3.1 on the Meta Model API (key in
`.env.local`). Options: `--stations chatswood,parramatta` (default: the featured 10),
`--res 1` (metres per pixel; 1 m is about 16 SAM calls per station), `--concurrency 4`.
Results are cached per chip under `data/derived/sam/cache`, so re-runs are cheap. Outputs:
`data/derived/sam_cover.csv` (loaded by the app in place of the demo cover), one overlay SVG per
station for review, and `summary.json`. Restart `npm run dev` after a run.

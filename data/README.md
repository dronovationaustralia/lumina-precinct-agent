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

1. `npm run ingest:vg`: parses every zip in `data/raw/vg` into `data/derived/vg_sales.csv`
   (residential, whole-property, arm's-length sales in the last 24 months; one row per transfer).
2. Geocode against G-NAF (next).
3. Load into Postgres, replacing the demo sales.

`data/derived/` is gitignored too.

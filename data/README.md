# Data

Raw downloads go in `data/raw/` (gitignored: licences vary and this repo goes public).
Only per-ring aggregates computed from them are published.

| Folder | Source | Used for |
| --- | --- | --- |
| `data/raw/vg/` | NSW Valuer General bulk property sales (weekly or yearly zip files, last 24 months) | Sales |
| `data/raw/gnaf/` | G-NAF Core address points (Geoscape) | Coordinates for sale addresses |
| `data/raw/gtfs/` | Transport for NSW GTFS static timetable (`stops.txt`) | Station coordinates |
| `data/raw/patronage/` | Transport for NSW train station entries and exits | Patronage |

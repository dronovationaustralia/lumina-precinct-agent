-- Lumina Precinct Agent schema (Postgres 15+ with PostGIS 3).
-- Base tables hold row-level data and are NOT readable by the agent role.
-- The agent reads only the aggregate views at the bottom (governed access).

create extension if not exists postgis;

create table if not exists datasets (
  id text primary key,
  name text not null,
  description text not null,
  source_url text,
  licence text not null,
  as_of date not null,
  coverage text not null,
  is_demo boolean not null default false
);

create table if not exists stations (
  id text primary key,
  name text not null,
  corridor text not null,
  geom geography(Point, 4326) not null,
  coord_source text not null
);

create table if not exists rings (
  id text primary key,
  min_m integer not null,
  max_m integer not null,
  label text not null
);

create table if not exists sales (
  id bigserial primary key,
  dataset_id text not null references datasets(id),
  contract_date date not null,
  price numeric not null check (price > 0),
  property_type text not null check (property_type in ('house', 'unit')),
  land_area_m2 numeric,
  geom geography(Point, 4326) not null
);
create index if not exists sales_geom_idx on sales using gist (geom);
create index if not exists sales_date_idx on sales (contract_date);

-- Region-wide medians used as the "city median" in the affordability metric (e.g. Greater Sydney).
create table if not exists reference_medians (
  dataset_id text not null references datasets(id),
  region text not null,
  property_type text not null,
  period text not null,
  median_price double precision,
  sales_count integer not null,
  primary key (dataset_id, region, property_type, period)
);

-- Precomputed distance from each sale to each station within 5 km.
create table if not exists sale_station (
  sale_id bigint not null references sales(id) on delete cascade,
  station_id text not null references stations(id),
  distance_m double precision not null,
  primary key (sale_id, station_id)
);
create index if not exists sale_station_station_idx on sale_station (station_id, distance_m);

create table if not exists patronage (
  dataset_id text not null references datasets(id),
  station_id text not null references stations(id),
  month date not null,
  entries integer not null,
  exits integer not null,
  primary key (station_id, month)
);


-- Official land use (NSW Landuse 2017, ALUM classes grouped into ten categories). Polygons are
-- stored with a projected copy (GDA2020 / MGA zone 56, metres) for area calculations.
create table if not exists land_use_polygons (
  id bigint primary key,
  dataset_id text not null references datasets(id),
  category text not null,
  tertiary text not null,
  geom geometry(Geometry, 4326) not null,
  geom_m geometry(Geometry, 7856) not null
);
create index if not exists land_use_polygons_geom_m_idx on land_use_polygons using gist (geom_m);
create index if not exists land_use_polygons_geom_idx on land_use_polygons using gist (geom);

-- Share of each ring's area by land-use category (rings to 2 km). Computed once after loading.
create table if not exists land_use_mix (
  dataset_id text not null references datasets(id),
  station_id text not null references stations(id),
  ring_id text not null references rings(id),
  category text not null,
  share_pct numeric not null check (share_pct between 0 and 100),
  primary key (station_id, ring_id, category)
);

create table if not exists land_use_ring (
  dataset_id text not null references datasets(id),
  station_id text not null references stations(id),
  ring_id text not null references rings(id),
  class text not null check (class in ('building', 'tree_canopy', 'car_park', 'construction_site')),
  cover_pct numeric not null check (cover_pct between 0 and 100),
  capture_date date not null,
  method text not null,
  primary key (station_id, ring_id, class)
);

-- ---------------------------------------------------------------------------
-- Governed views. Minimum cell size: medians and shares built from fewer than
-- 10 sales are returned as NULL with suppressed = true.
-- ---------------------------------------------------------------------------

create or replace view v_stations as
select id as station_id, name, corridor,
       st_y(geom::geometry) as lat, st_x(geom::geometry) as lon, coord_source
from stations;

create or replace view v_datasets as
select id as dataset_id, name, description, source_url, licence, to_char(as_of, 'YYYY-MM-DD') as as_of, coverage, is_demo from datasets;

-- Sales aggregates are MATERIALIZED views: with every Sydney station (185) a sale falls in many
-- stations' rings, so they are computed once after each load (refreshAggregates) rather than per query.
do $$
declare r record;
begin
  for r in select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname in ('v_sales_period', 'v_sales_monthly', 'v_affordable_share', 'v_sales_hex') loop
    if r.relkind = 'm' then execute format('drop materialized view %I cascade', r.relname);
    elsif r.relkind = 'v' then execute format('drop view %I cascade', r.relname);
    end if;
  end loop;
end $$;

-- Sales in each station ring, split into the last 12 months and the 12 before,
-- anchored on the latest contract date in the data (not today's date).
create materialized view v_sales_period as
with bounds as (select max(contract_date) as as_of from sales),
tagged as (
  select ss.station_id, r.id as ring_id, s.property_type, s.price, s.land_area_m2, s.dataset_id,
         case when s.contract_date > b.as_of - interval '12 months' then 'last_12m'
              when s.contract_date > b.as_of - interval '24 months' then 'prior_12m' end as period,
         b.as_of
  from sales s
  join sale_station ss on ss.sale_id = s.id
  join rings r on ss.distance_m >= r.min_m and ss.distance_m < r.max_m
  cross join bounds b
),
typed as (
  select station_id, ring_id, property_type, period, price, land_area_m2, dataset_id, as_of from tagged where period is not null
  union all
  select station_id, ring_id, 'all', period, price, null, dataset_id, as_of from tagged where period is not null
)
select station_id, ring_id, property_type, period,
       count(*)::int as sales_count,
       case when count(*) >= 10 then percentile_cont(0.5) within group (order by price) end as median_price,
       case when count(land_area_m2) >= 10 and property_type = 'house'
            then percentile_cont(0.5) within group (order by price / nullif(land_area_m2, 0)) end as median_price_per_m2,
       count(*) < 10 as suppressed,
       min(dataset_id) as dataset_id,
       to_char(max(as_of), 'YYYY-MM-DD') as as_of
from typed
group by station_id, ring_id, property_type, period
with no data;
create index if not exists v_sales_period_idx on v_sales_period (station_id, ring_id, property_type, period);

-- Monthly sale counts per ring (counts only, no prices).
create materialized view v_sales_monthly as
select ss.station_id, r.id as ring_id, s.property_type,
       to_char(date_trunc('month', s.contract_date), 'YYYY-MM') as month,
       count(*)::int as sales_count
from sales s
join sale_station ss on ss.sale_id = s.id
join rings r on ss.distance_m >= r.min_m and ss.distance_m < r.max_m
group by 1, 2, 3, 4
with no data;
create index if not exists v_sales_monthly_idx on v_sales_monthly (station_id, ring_id, property_type);

-- Share of last-12-month sales in a ring at or below the median of all sales of the
-- same type in the dataset over the same 12 months ("city median").
create materialized view v_affordable_share as
with bounds as (select max(contract_date) as as_of from sales),
recent as (
  select s.* from sales s, bounds b where s.contract_date > b.as_of - interval '12 months'
),
-- Greater Sydney median when the ingest supplied one, otherwise the median of all sales loaded.
city as (
  select t.property_type,
         coalesce(
           (select r.median_price from reference_medians r
             where r.property_type = t.property_type and r.period = 'last_12m' order by r.region limit 1),
           percentile_cont(0.5) within group (order by t.price)) as city_median
  from recent t group by t.property_type
)
select ss.station_id, r.id as ring_id, s.property_type,
       count(*)::int as sales_count,
       case when count(*) >= 10 then (avg(case when s.price <= c.city_median then 1.0 else 0.0 end) * 100)::float8 end as affordable_pct,
       count(*) < 10 as suppressed,
       min(c.city_median)::float8 as city_median,
       min(s.dataset_id) as dataset_id,
       to_char((select as_of from bounds), 'YYYY-MM-DD') as as_of
from recent s
join city c on c.property_type = s.property_type
join sale_station ss on ss.sale_id = s.id
join rings r on ss.distance_m >= r.min_m and ss.distance_m < r.max_m
group by 1, 2, 3
with no data;
create index if not exists v_affordable_share_idx on v_affordable_share (station_id, ring_id, property_type);

create or replace view v_patronage_monthly as
select station_id, to_char(month, 'YYYY-MM') as month, entries, exits, entries + exits as total, dataset_id from patronage;

create or replace view v_land_use_mix as
select m.station_id, m.ring_id, m.category, m.share_pct::float8 as share_pct, m.dataset_id, to_char(d.as_of, 'YYYY-MM-DD') as as_of
from land_use_mix m join datasets d on d.id = m.dataset_id;

-- Land-use polygons for the map (public data; no personal information).
create or replace view v_land_use_polygons as
select id, category, tertiary, dataset_id, geom from land_use_polygons;

create or replace view v_land_use as
select station_id, ring_id, class, cover_pct::float8 as cover_pct, to_char(capture_date, 'YYYY-MM-DD') as capture_date, method, dataset_id from land_use_ring;

-- Sales binned into hexagons (300 m circumradius, about 520 m across) for the map, last 12 months.
-- Axial hex coordinates (q, r) on a local metric plane; the API turns them back into polygons.
-- Only hexes with at least one sale within 5 km of a station; medians below 10 sales are suppressed.
create materialized view v_sales_hex as
with bounds as (select max(contract_date) as as_of from sales),
pts as (
  select s.property_type, s.price, s.dataset_id,
         st_x(s.geom::geometry) * 111320 * cos(radians(-33.85)) / 300 as px,
         st_y(s.geom::geometry) * 111320 / 300 as py
  from sales s cross join bounds b
  where s.contract_date > b.as_of - interval '12 months'
    and exists (select 1 from sale_station ss where ss.sale_id = s.id)
),
frac as (
  select property_type, price, dataset_id,
         sqrt(3) / 3 * px - py / 3 as fq, 2.0 / 3 * py as fr
  from pts
),
cube as (
  select property_type, price, dataset_id, fq, fr, -fq - fr as fs,
         round(fq) as rq, round(fr) as rr, round(-fq - fr) as rs
  from frac
),
axial as (
  select property_type, price, dataset_id,
         case when abs(rq - fq) > abs(rr - fr) and abs(rq - fq) > abs(rs - fs) then -rr - rs else rq end::int as q,
         case when abs(rq - fq) > abs(rr - fr) and abs(rq - fq) > abs(rs - fs) then rr
              when abs(rr - fr) > abs(rs - fs) then -rq - rs else rr end::int as r
  from cube
)
select property_type, q, r,
       count(*)::int as sales_count,
       case when count(*) >= 10 then percentile_cont(0.5) within group (order by price) end as median_price,
       count(*) < 10 as suppressed,
       min(dataset_id) as dataset_id,
       (select to_char(as_of, 'YYYY-MM-DD') from bounds) as as_of
from axial
group by property_type, q, r
with no data;

-- ---------------------------------------------------------------------------
-- Read-only role for the agent. It can read the views above and nothing else.
-- On managed Postgres, create a login user that is a member of agent_ro and put
-- its connection string in DATABASE_URL_RO.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'agent_ro') then
    create role agent_ro nologin;
  end if;
end $$;

revoke all on all tables in schema public from agent_ro;
grant usage on schema public to agent_ro;
grant select on v_stations, v_datasets, v_sales_period, v_sales_monthly, v_affordable_share,
  v_patronage_monthly, v_land_use, v_sales_hex, v_land_use_mix, v_land_use_polygons to agent_ro;

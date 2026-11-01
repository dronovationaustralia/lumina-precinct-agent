/**
 * Prepare a managed Postgres + PostGIS database (Azure Database for PostgreSQL Flexible Server).
 *
 *   npm run db:setup                        # apply db/schema.sql (idempotent)
 *   npm run db:setup -- --agent-login       # also create/rotate the read-only agent login
 *   npm run db:setup -- --seed-demo         # also load labelled demo data (skipped if data exists)
 *   npm run db:setup -- --load-sales        # replace demo sales with real sales from data/derived
 *   npm run db:setup -- --load-patronage    # replace demo patronage with TfNSW entries and exits
 *   npm run db:setup -- --load-landuse      # NSW Landuse 2017 polygons and ring shares
 *   npm run db:setup -- --load-real         # sales, patronage, land use, SAM cover, SAM sites and SAM polygons
 *   npm run db:setup -- --load-cover        # only SAM 3.1 aerial cover (after a new sam:batch)
 *   npm run db:setup -- --load-sites        # only SAM 3.1 opportunity sites (after sam:sites)
 *   npm run db:setup -- --load-sam-polygons # only SAM 3.1 segmentation polygons (after sam:polygons)
 *
 * Reads DATABASE_URL (the admin connection string) from .env.local or the environment.
 * For --agent-login, set AGENT_DB_PASSWORD; the login is `lumina_agent`, a member of agent_ro.
 * On Azure, allowlist PostGIS first (infra/main.bicep does this via azure.extensions).
 */
import { existsSync } from 'node:fs';

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);

const { createPostgres, schemaSql } = await import('@/server/db/client');
const { seedDemo } = await import('@/server/db/seed-demo');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Put the admin connection string in .env.local (see docs/deploy-azure.md).');
  process.exit(1);
}
const flags = new Set(process.argv.slice(2));
const db = await createPostgres(url);

try {
  const [who] = await db.admin<{ user: string; db: string; version: string }>('select current_user as user, current_database() as db, version() as version');
  console.log(`Connected as ${who?.user} to ${who?.db} (${who?.version.split(' on ')[0]})`);

  const ext = await db.admin<{ name: string }>("select name from pg_available_extensions where name = 'postgis'");
  if (!ext.length) throw new Error('PostGIS is not available. On Azure, add POSTGIS to the azure.extensions server parameter.');

  await db.exec(await schemaSql());
  const [pg] = await db.admin<{ v: string }>('select postgis_version() as v');
  console.log(`Schema applied. PostGIS ${pg?.v}`);

  if (flags.has('--agent-login')) {
    const pw = process.env.AGENT_DB_PASSWORD;
    if (!pw || pw.length < 16) throw new Error('Set AGENT_DB_PASSWORD (16+ characters) to create the agent login.');
    const exists = await db.admin("select 1 from pg_roles where rolname = 'lumina_agent'");
    const quoted = `'${pw.replace(/'/g, "''")}'`;
    if (exists.length) await db.exec(`alter role lumina_agent with login password ${quoted}`);
    else await db.exec(`create role lumina_agent with login inherit password ${quoted} in role agent_ro`);
    await db.exec('grant agent_ro to lumina_agent');
    const u = new URL(url);
    u.username = 'lumina_agent';
    u.password = '***';
    console.log(`Agent login ready. DATABASE_URL_RO = ${u.toString()} (use AGENT_DB_PASSWORD in place of ***)`);
  }

  if (flags.has('--seed-demo')) {
    const [n] = await db.admin<{ n: number }>('select count(*)::int as n from datasets');
    if ((n?.n ?? 0) > 0) console.log('Datasets already present; demo seed skipped.');
    else {
      await seedDemo(db);
      console.log('Demo data loaded (labelled "Demo data" everywhere).');
    }
  }
  if (flags.has('--load-sales') || flags.has('--load-real')) {
    const { loadRealSales, realSalesAvailable } = await import('@/server/db/real-sales');
    if (!realSalesAvailable()) throw new Error('No data/derived/sales_geocoded.csv. Run ingest:vg, ingest:gnaf and ingest:geocode first.');
    const r = await loadRealSales(db, undefined, (m) => console.log(m));
    console.log(`Loaded ${r.sales.toLocaleString()} real sales (as of ${r.asOf}); demo sales removed.`);
  }
  if (flags.has('--load-patronage') || flags.has('--load-real')) {
    const { loadRealPatronage, realPatronageAvailable } = await import('@/server/db/real-patronage');
    if (!realPatronageAvailable()) throw new Error('No data/derived/patronage.csv. Run ingest:patronage first.');
    const r = await loadRealPatronage(db);
    console.log(`Loaded ${r.rows} station-months of patronage (as of ${r.asOf}); demo patronage removed.`);
  }
  if (flags.has('--load-landuse') || flags.has('--load-real')) {
    const { loadRealLandUse, realLandUseAvailable } = await import('@/server/db/real-landuse');
    if (!realLandUseAvailable()) throw new Error('No data/derived/landuse.ndjson. Run fetch:landuse and ingest:landuse first.');
    const r = await loadRealLandUse(db, undefined, (m) => console.log(m));
    console.log(`Loaded ${r.polygons.toLocaleString()} land-use polygons and ring shares.`);
  }
  if (flags.has('--load-cover') || flags.has('--load-real')) {
    const { loadRealCover, realCoverAvailable } = await import('@/server/db/real-cover');
    if (realCoverAvailable()) console.log(`Loaded SAM 3.1 aerial cover for ${(await loadRealCover(db)).stations} stations.`);
    else console.log('No data/derived/sam_cover.csv: aerial cover stays demo data (run npm run sam:batch).');
  }
  if (flags.has('--load-sites') || flags.has('--load-real')) {
    const { loadRealSites, realSitesAvailable } = await import('@/server/db/real-sites');
    if (realSitesAvailable()) {
      const r = await loadRealSites(db);
      console.log(`Loaded ${r.sites} SAM 3.1 opportunity sites near ${r.stations} stations.`);
    } else console.log('No data/derived/sam_sites.geojson: no opportunity sites (run npm run sam:sites).');
  }
  if (flags.has('--load-sam-polygons') || flags.has('--load-real')) {
    const { loadRealCoverPolygons, realCoverPolygonsAvailable } = await import('@/server/db/real-cover-polygons');
    if (realCoverPolygonsAvailable()) {
      const r = await loadRealCoverPolygons(db);
      console.log(`Loaded ${r.polygons} SAM 3.1 segmentation polygons near ${r.stations} stations.`);
    } else console.log('No data/derived/sam_cover_polygons.geojson: no segmentation polygons (run npm run sam:polygons).');
  }
  if ([...flags].some((f) => f.startsWith('--load-') || f === '--seed-demo')) {
    const { refreshAggregates } = await import('@/server/db/aggregates');
    await refreshAggregates(db);
    console.log('Aggregates refreshed.');
  }
} finally {
  await db.close();
}

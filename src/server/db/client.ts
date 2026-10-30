/**
 * Database access.
 *
 * - With DATABASE_URL set: node-postgres against managed Postgres + PostGIS.
 * - Without it (local dev, tests, CI): an in-process PGlite database with the PostGIS
 *   extension, created from db/schema.sql and seeded with labelled demo data.
 *
 * `readOnly()` is the only path the agent's tools use: a READ ONLY transaction as the
 * agent_ro role (or the DATABASE_URL_RO login), with a statement timeout.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type Row = Record<string, unknown>;

export interface Db {
  readonly kind: 'pglite' | 'postgres';
  /** Privileged access for ingest and migrations. Never exposed to the agent. */
  admin<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  /** Governed access: read-only transaction, agent_ro role, statement timeout. */
  readOnly<T extends Row = Row>(sql: string, params?: unknown[], opts?: { timeoutMs?: number }): Promise<T[]>;
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 3000;

export async function schemaSql(): Promise<string> {
  return readFile(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
}

/**
 * A fingerprint of everything the local database is built from: the schema, the demo seed and
 * the derived data files. When it changes, the persisted database is rebuilt.
 */
function buildSignature(): string {
  const h = createHash('sha256');
  const root = process.cwd();
  for (const f of ['db/schema.sql', 'src/server/db/seed-demo.ts', 'src/server/db/real-sales.ts', 'src/server/db/real-patronage.ts', 'src/lib/station-registry.json']) {
    const p = path.join(root, f);
    if (existsSync(p)) h.update(readFileSync(p));
  }
  const derived = path.join(root, 'data', 'derived');
  if (existsSync(derived)) {
    for (const f of readdirSync(derived).sort()) {
      const st = statSync(path.join(derived, f));
      h.update(`${f}:${st.size}:${st.mtimeMs}`);
    }
  }
  return h.digest('hex').slice(0, 16);
}

function wantsRealData(opts: { realSales?: boolean }) {
  return opts.realSales !== false && process.env.LUMINA_REAL_DATA !== 'off' && process.env.LUMINA_REAL_SALES !== 'off';
}

async function createPglite(opts: { realSales?: boolean } = {}): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { postgis } = await import('@electric-sql/pglite-postgis');
  // With real data the build takes a minute or two (every sale against every station within 5 km),
  // so it is kept on disk in data/pglite (gitignored) and reused until its inputs change.
  const persist = wantsRealData(opts) && existsSync(path.join(process.cwd(), 'data', 'derived', 'sales_geocoded.csv'));
  const dataDir = path.join(process.cwd(), 'data', 'pglite');
  const signature = persist ? buildSignature() : '';
  if (persist && existsSync(dataDir)) {
    const pg = await PGlite.create({ dataDir, extensions: { postgis } });
    const ok = await pg
      .query<{ v: string }>("select value as v from app_meta where key = 'signature'")
      .then((r) => r.rows[0]?.v === signature)
      .catch(() => false);
    if (ok) return wrap(pg);
    await pg.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
  if (persist) console.log('[db] Building the local database from data/derived (one to two minutes, kept in data/pglite)...');
  const pg = await PGlite.create({ ...(persist ? { dataDir } : {}), extensions: { postgis } });
  const db = wrap(pg);
  await db.exec(await schemaSql());
  const { seedDemo } = await import('./seed-demo');
  await seedDemo(db);
  // Local development: use real data when the ingest has produced it
  // (LUMINA_REAL_DATA=off, or the older LUMINA_REAL_SALES=off, to skip).
  if (wantsRealData(opts)) {
    const { loadRealSales, realSalesAvailable } = await import('./real-sales');
    if (realSalesAvailable()) await loadRealSales(db, undefined, (m) => persist && console.log(`[db]${m}`));
    const { loadRealPatronage, realPatronageAvailable } = await import('./real-patronage');
    if (realPatronageAvailable()) await loadRealPatronage(db);
  }
  if (persist) {
    await db.exec(`create table if not exists app_meta (key text primary key, value text not null);`);
    await db.admin(`insert into app_meta (key, value) values ('signature', $1) on conflict (key) do update set value = excluded.value`, [signature]);
    console.log('[db] Local database ready.');
  }
  return db;
}

function wrap(pg: import('@electric-sql/pglite').PGlite): Db {
  const db: Db = {
    kind: 'pglite',
    async admin<T extends Row>(sql: string, params: unknown[] = []) {
      return (await pg.query<T>(sql, params)).rows;
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async readOnly<T extends Row>(sql: string, params: unknown[] = [], opts: { timeoutMs?: number } = {}) {
      return pg.transaction(async (tx) => {
        await tx.exec(`set transaction read only; set local role agent_ro; set local statement_timeout = ${Math.round(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)};`);
        return (await tx.query<T>(sql, params)).rows;
      });
    },
    async close() {
      await pg.close();
    },
  };
  return db;
}

export async function createPostgres(url: string, roUrl?: string): Promise<Db> {
  const { Pool } = (await import('pg')).default;
  const pool = new Pool({ connectionString: url, max: 5 });
  const roPool = roUrl ? new Pool({ connectionString: roUrl, max: 5 }) : pool;
  return {
    kind: 'postgres',
    async admin<T extends Row>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async readOnly<T extends Row>(sql: string, params: unknown[] = [], opts: { timeoutMs?: number } = {}) {
      const client = await roPool.connect();
      try {
        await client.query('begin read only');
        if (!roUrl) await client.query('set local role agent_ro');
        await client.query(`set local statement_timeout = ${Math.round(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)}`);
        const res = await client.query(sql, params);
        await client.query('commit');
        return res.rows as T[];
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
      if (roPool !== pool) await roPool.end();
    },
  };
}

const globalForDb = globalThis as unknown as { __luminaDb?: Promise<Db> };

/** Process-wide database (survives Next.js dev hot reloads). */
export function getDb(): Promise<Db> {
  if (!globalForDb.__luminaDb) {
    // Deployed apps get only DATABASE_URL_RO (the read-only lumina_agent login); admin access
    // (DATABASE_URL) is for db:setup and local development.
    const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_RO;
    globalForDb.__luminaDb = (url ? createPostgres(url, process.env.DATABASE_URL_RO) : createPglite()).catch((e) => {
      globalForDb.__luminaDb = undefined;
      throw e;
    });
  }
  return globalForDb.__luminaDb;
}

/** A fresh in-memory database, for tests. */
/** A fresh in-memory database with demo data only (tests never load local real data). */
export function createTestDb(): Promise<Db> {
  return createPglite({ realSales: false });
}

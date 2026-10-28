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

async function createPglite(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { postgis } = await import('@electric-sql/pglite-postgis');
  const pg = await PGlite.create({ extensions: { postgis } });
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
  await db.exec(await schemaSql());
  const { seedDemo } = await import('./seed-demo');
  await seedDemo(db);
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
export function createTestDb(): Promise<Db> {
  return createPglite();
}

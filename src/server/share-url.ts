/**
 * Helpers for public share pages (server components only): the deployment's public
 * base URL for absolute Open Graph URLs, and an in-memory plus temp-file cache for
 * rendered OG images, like the briefing illustration cache.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { headers } from 'next/headers';

export async function publicBaseUrl(): Promise<string> {
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

const OG_TTL_MS = 7 * 24 * 3600 * 1000;

type CachedOg = { at: number; png: string };

const memoryCache = new Map<string, CachedOg>();

const keyOf = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 32);

const cacheFile = (key: string) => join(tmpdir(), `lumina-og-${keyOf(key)}.json`);

const fresh = (entry: CachedOg | undefined) => !!entry && Date.now() - entry.at < OG_TTL_MS;

/** Rendered OG PNG bytes, cached per key in memory plus a temp file for 7 days. */
export async function cachedOgImage(key: string, render: () => Promise<Buffer>): Promise<Buffer> {
  const mem = memoryCache.get(key);
  if (fresh(mem)) return Buffer.from(mem!.png, 'base64');
  try {
    const file = JSON.parse(await readFile(cacheFile(key), 'utf8')) as CachedOg;
    if (fresh(file)) {
      memoryCache.set(key, file);
      return Buffer.from(file.png, 'base64');
    }
  } catch {
    // Miss, corrupt or unreadable: render below.
  }
  const png = await render();
  const entry: CachedOg = { at: Date.now(), png: png.toString('base64') };
  memoryCache.set(key, entry);
  await writeFile(cacheFile(key), JSON.stringify(entry)).catch(() => undefined);
  return png;
}

/**
 * Stream text lines out of entries in a large zip without extracting it to disk.
 * Used for G-NAF (about 1.9 GB zipped, several GB unzipped).
 */
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

import yauzl from 'yauzl';

export type ZipEntryInfo = { name: string; size: number; compressed: number };

function open(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err || !zip ? reject(err) : resolve(zip))),
  );
}

/** List every entry in the zip. */
export async function listEntries(file: string): Promise<ZipEntryInfo[]> {
  const zip = await open(file);
  const out: ZipEntryInfo[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (e: yauzl.Entry) => {
      out.push({ name: e.fileName, size: e.uncompressedSize, compressed: e.compressedSize });
      zip.readEntry();
    });
    zip.on('end', () => resolve());
    zip.on('error', reject);
    zip.readEntry();
  });
  zip.close();
  return out;
}

/**
 * Call `onLine` for every line of the first entry whose name matches `pattern`.
 * Return false from `onLine` to stop early. Resolves with the entry name read (or null).
 */
export async function readLines(file: string, pattern: RegExp, onLine: (line: string, n: number) => boolean | void): Promise<string | null> {
  const zip = await open(file);
  try {
    const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
      zip.on('entry', (e: yauzl.Entry) => (pattern.test(e.fileName) ? resolve(e) : zip.readEntry()));
      zip.on('end', () => resolve(null));
      zip.on('error', reject);
      zip.readEntry();
    });
    if (!entry) return null;
    const stream = await new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (err, s) => (err || !s ? reject(err) : resolve(s))));
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let n = 0;
    for await (const line of rl) {
      if (onLine(line, n++) === false) {
        rl.close();
        stream.destroy();
        break;
      }
    }
    return entry.fileName;
  } finally {
    zip.close();
  }
}

/** Split a pipe-separated G-NAF line. */
export const splitPsv = (line: string) => line.split('|');

/** Map a header row to column indexes, case-insensitive. */
export function columns(header: string, required: string[]): Record<string, number> {
  const cols = splitPsv(header).map((h) => h.trim().toUpperCase());
  const out: Record<string, number> = {};
  for (const r of required) {
    const i = cols.indexOf(r.toUpperCase());
    if (i < 0) throw new Error(`Column ${r} not found in header: ${cols.join(', ')}`);
    out[r] = i;
  }
  return out;
}

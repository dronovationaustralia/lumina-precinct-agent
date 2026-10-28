/**
 * Peek inside the G-NAF zip without extracting it: list the entries and copy the first lines of
 * the NSW tables the geocoder needs into data/raw/gnaf/sample/.
 *
 *   npm run ingest:gnaf-sample            # uses the only .zip in data/raw/gnaf
 *   npm run ingest:gnaf-sample -- path/to/g-naf.zip
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { listEntries, readLines } from './zip-lines';

const DIR = path.join('data', 'raw', 'gnaf');
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const zipFile = arg ?? path.join(DIR, readdirSync(DIR).find((f) => f.toLowerCase().endsWith('.zip')) ?? '');
if (!zipFile.toLowerCase().endsWith('.zip')) {
  console.error(`No G-NAF zip found in ${DIR}`);
  process.exit(1);
}

const OUT = path.join(DIR, 'sample');
mkdirSync(OUT, { recursive: true });

const entries = await listEntries(zipFile);
writeFileSync(
  path.join(OUT, 'entries.txt'),
  entries.map((e) => `${e.name}\t${e.size}\t${e.compressed}`).join('\n') + '\n',
);
console.log(`${entries.length} entries; list written to ${path.join(OUT, 'entries.txt')}`);

const TABLES: [string, RegExp][] = [
  ['NSW_ADDRESS_DETAIL', /NSW_ADDRESS_DETAIL_psv\.psv$/i],
  ['NSW_ADDRESS_DEFAULT_GEOCODE', /NSW_ADDRESS_DEFAULT_GEOCODE_psv\.psv$/i],
  ['NSW_STREET_LOCALITY', /NSW_STREET_LOCALITY_psv\.psv$/i],
  ['NSW_LOCALITY', /NSW_LOCALITY_psv\.psv$/i],
  ['STREET_TYPE_AUT', /STREET_TYPE_AUT_psv\.psv$/i],
  ['FLAT_TYPE_AUT', /FLAT_TYPE_AUT_psv\.psv$/i],
];

for (const [name, re] of TABLES) {
  const lines: string[] = [];
  const found = await readLines(zipFile, re, (line) => {
    lines.push(line);
    return lines.length < 2000;
  });
  if (!found) {
    console.log(`${name}: not found`);
    continue;
  }
  writeFileSync(path.join(OUT, `${name}.psv`), lines.join('\n') + '\n');
  console.log(`${name}: ${lines.length} lines from ${found}`);
}
console.log(`\nSample written to ${OUT}. Tell Claude it is ready.`);

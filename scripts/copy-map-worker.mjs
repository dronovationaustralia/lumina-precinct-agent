// Copies MapLibre's standalone web worker into public/ so the bundled app can load it.
// Runs on postinstall, predev and prebuild; the copy is gitignored.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const src = path.join('node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-worker.mjs');
if (existsSync(src)) {
  mkdirSync('public', { recursive: true });
  copyFileSync(src, path.join('public', 'maplibre-gl-worker.mjs'));
}

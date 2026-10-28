// Completes the Next.js standalone build for Azure App Service: copies public/ and
// .next/static into .next/standalone so `node server.js` serves them. Cross-platform.
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';

const out = path.join('.next', 'standalone');
if (!existsSync(path.join(out, 'server.js'))) {
  console.error('No .next/standalone/server.js. Run `npm run build` first.');
  process.exit(1);
}
cpSync('public', path.join(out, 'public'), { recursive: true });
cpSync(path.join('.next', 'static'), path.join(out, '.next', 'static'), { recursive: true });
console.log(`Standalone package ready in ${out} (start with: node server.js)`);

// Completes the Next.js standalone build for Azure App Service: copies public/ and
// .next/static into .next/standalone so `node server.js` serves them. Cross-platform.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const out = path.join('.next', 'standalone');
if (!existsSync(path.join(out, 'server.js'))) {
  console.error('No .next/standalone/server.js. Run `npm run build` first.');
  process.exit(1);
}
cpSync('public', path.join(out, 'public'), { recursive: true });
cpSync(path.join('.next', 'static'), path.join(out, '.next', 'static'), { recursive: true });
// Which commit this package is, so /api/v1/health (and the deploy check) can tell a fresh
// deployment from an old process that was never restarted.
let sha = process.env.GITHUB_SHA;
if (!sha) try { sha = execSync('git rev-parse HEAD').toString().trim(); } catch { sha = 'unknown'; }
writeFileSync(path.join(out, 'build.json'), JSON.stringify({ sha, built_at: new Date().toISOString() }));
console.log(`Standalone package ready in ${out} (start with: node server.js)`);

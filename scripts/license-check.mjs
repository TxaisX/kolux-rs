// JS license gate (LOOP.md section 0): every installed npm package must carry one of the allowed
// licenses. Reads `pnpm licenses list --json` and fails on anything else.
// Run: node scripts/license-check.mjs
import { execSync } from 'node:child_process';

const allowed = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib', '0BSD', 'MPL-2.0', 'Unicode-3.0', 'Unicode-DFS-2016', 'BlueOak-1.0.0', 'CC0-1.0', 'Python-2.0', 'CC-BY-4.0', 'Unlicense']);
// Expressions: every alternative of an OR must be allowed-or-not matter; one allowed alternative is enough.
const ok = expr => expr.split(/\s+OR\s+/i).some(alt => allowed.has(alt.replace(/[()]/g, '').trim()))
  || expr.split(/\s+AND\s+/i).every(alt => allowed.has(alt.replace(/[()]/g, '').trim()));

const raw = execSync('pnpm licenses list --json --long', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const byLicense = JSON.parse(raw);
const bad = [];
let count = 0;
for (const [license, pkgs] of Object.entries(byLicense)) {
  count += pkgs.length;
  if (!ok(license)) for (const p of pkgs) bad.push(`${p.name}@${p.versions?.join(',') ?? p.version} · ${license}`);
}
console.log(`license-check: ${count} packages, ${Object.keys(byLicense).length} licenses`);
if (bad.length) { console.error('not allowed:\n' + bad.join('\n')); process.exit(1); }
console.log('license-check: OK');

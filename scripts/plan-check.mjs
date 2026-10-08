// Proves PLAN.md covers the spec: every P0/P1/P2 card, every H card DECISIONS.md marks build,
// and every X card appears exactly once; no D card and no skipped H card is planned.
// Run: node scripts/plan-check.mjs   (exit 1 on any failure)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const cards = new Map();
for (const f of readdirSync(join(root, 'spec')).filter(n => n.endsWith('.md'))) {
  const lines = readFileSync(join(root, 'spec', f), 'utf8').split(/\r?\n/);
  let id = null;
  for (const line of lines) {
    const h = line.match(/^### ([A-Z]+-\d{3}) · /);
    if (h) { id = h[1]; continue; }
    const t = id && line.match(/^Tier: (\w+)/);
    if (t) { cards.set(id, t[1]); id = null; }
  }
}
const dec = readFileSync(join(root, 'DECISIONS.md'), 'utf8').split(/\r?\n/);
const hBuild = new Set();
for (const line of dec) {
  const m = line.match(/^\| ([A-Z]+-\d{3}) \| \d\d \| .*? \| (build|skip) \|/);
  if (m && m[2] === 'build') hBuild.add(m[1]);
}
const plan = readFileSync(join(root, 'PLAN.md'), 'utf8');
const seen = new Map();
const prefixes = new Set([...cards.keys()].map(id => id.split('-')[0]));
for (const m of plan.matchAll(/\b([A-Z]+)-(\d{3})\b/g)) {
  if (!prefixes.has(m[1])) continue; // task ids (T-nnn) and decision ids are not cards
  const id = `${m[1]}-${m[2]}`;
  seen.set(id, (seen.get(id) || 0) + 1);
}

const errors = [];
const expected = new Set();
for (const [id, tier] of cards) {
  if (tier === 'P0' || tier === 'P1' || tier === 'P2' || tier === 'X' || (tier === 'H' && hBuild.has(id))) expected.add(id);
}
for (const id of expected) if (!seen.has(id)) errors.push(`missing: ${id} (${cards.get(id)})`);
for (const [id, n] of seen) {
  const tier = cards.get(id);
  if (!tier) { errors.push(`unknown card id in PLAN.md: ${id}`); continue; }
  if (tier === 'D') errors.push(`dropped card planned: ${id}`);
  if (tier === 'H' && !hBuild.has(id)) errors.push(`skipped H card planned: ${id}`);
  if (n !== 1) errors.push(`${id} appears ${n} times (must be exactly once)`);
}
const tasks = (plan.match(/^- \[[ x]\] T-\d{3}/gm) || []).length;
console.log(`cards in spec: ${cards.size} · expected in plan: ${expected.size} · planned ids: ${seen.size} · tasks: ${tasks}`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('plan-check: OK');

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const R = 'G:/Dev/Kolux/kolux', O = 'G:/Dev/kolux-rs/provenance/dirty-room/dumps/records/';
const sh = c => execSync(c, { cwd: R, maxBuffer: 1 << 28 }).toString('utf8');
const q = s => '"' + String(s ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
const csv = (hdr, rows) => hdr.join(',') + '\n' + rows.map(r => r.map(q).join(',')).join('\n') + '\n';
const first = t => { const m = t.replace(/\s+/g, ' ').trim().match(/^(.+?[.!?])(\s|$)/); return (m ? m[1] : t.replace(/\s+/g, ' ').trim()).slice(0, 300); };
const summary = { notFound: [] };
// 1 tags
const tags = sh('git tag').trim().split('\n').filter(Boolean);
const rows = [], msgs = [];
for (const t of tags) {
  const type = sh(`git cat-file -t ${t}`).trim();
  if (type === 'tag') {
    const [d, n, s] = sh(`git for-each-ref refs/tags/${t} --format="%(taggerdate:short)|%(taggername)|%(contents:subject)"`).trim().split('|');
    rows.push([t, d, n, s, 'annotated']);
    msgs.push(`## ${t}\n\nTagger: ${n}, ${d}\n\n\`\`\`\n${sh(`git for-each-ref refs/tags/${t} --format="%(contents)"`).trimEnd()}\n\`\`\`\n`);
  } else {
    const [d, n, s] = sh(`git log -1 --format="%ad|%an|%s" --date=short ${t}`).trim().split('|');
    rows.push([t, d, n + ' (commit author)', s, 'lightweight (commit date/subject)']);
  }
}
writeFileSync(O + 'tags.csv', csv(['tag', 'date', 'tagger', 'subject', 'tag_type'], rows));
writeFileSync(O + 'tag-messages.md', '# Annotated tag messages (lightweight tags have none)\n\n' + msgs.join('\n'));
summary.tags = tags.length; summary.annotated = msgs.length;
// 2 handoff
const H = readFileSync(R + '/HANDOFF.md', 'utf8').split('\n');
const sect = h => { const i = H.findIndex(l => l.startsWith('## ' + h)); if (i < 0) return ''; let j = i + 1; while (j < H.length && !H[j].startsWith('## ')) j++; return H.slice(i, j).join('\n').trimEnd(); };
writeFileSync(O + 'handoff-recent-work.md', `# Verbatim sections from HANDOFF.md (Last updated: 2026-10-05 per file header)\n\n${sect('Recent work')}\n\n${sect('Known gaps')}\n\n${sect('Verification limits')}\n`);
// 3 history
const HH = readFileSync(R + '/HANDOFF-HISTORY.md', 'utf8').split('\n');
const hrows = [];
HH.forEach((l, i) => {
  const m = l.match(/^(#{2,3}) (.*)/); if (!m) return;
  const dm = l.match(/(\d{4}-\d{2}-\d{2})/);
  let k = i + 1; while (k < HH.length && (!HH[k].trim() || HH[k].startsWith('#'))) { if (HH[k].startsWith('#')) break; k++; }
  let body = ''; for (let x = i + 1; x < HH.length && !HH[x].startsWith('#'); x++) if (HH[x].trim()) { body = HH[x].replace(/^[-*]\s+/, ''); break; }
  hrows.push([dm ? dm[1] : '', l.replace(/^#+ /, ''), i + 1, first(body)]);
});
writeFileSync(O + 'handoff-history-index.csv', csv(['date', 'heading', 'line', 'first_sentence'], hrows));
summary.historyEntries = hrows.length; summary.historyDated = hrows.filter(r => r[0]).length;
// 4 docs
const files = []; (function w(d) { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? w(p) : files.push(p); } })(R + '/docs');
const drows = files.map(p => {
  const rel = p.slice(R.length + 1).split(String.fromCharCode(92)).join('/'); let title = '', date = (rel.match(/\d{4}-\d{2}-\d{2}/) || [''])[0], fs = '';
  if (/\.(md|html|txt)$/.test(rel)) {
    const t = readFileSync(p, 'utf8'); const hm = t.match(/^#{1,6} (.+)$/m) || t.match(/<title>(.*?)<\/title>/i); title = hm ? hm[1] : '';
    if (!date) { const d2 = t.slice(0, 3000).match(/\d{4}-\d{2}-\d{2}/); if (d2) date = d2[0] + ' (in body)'; }
    const para = t.split(/\n\s*\n/).find(b => b.trim() && !/^(#|<|---|```|\|)/.test(b.trim())); fs = para ? first(para) : '';
  }
  return [rel, title, date, fs];
});
writeFileSync(O + 'research-docs.csv', csv(['path', 'title', 'date', 'first_sentence'], drows));
summary.docsFiles = drows.length;
// 5 cards
const repoDoc = readFileSync(R + '/docs/research/bridgemind/kolux-improvements-from-bridgemind.md', 'utf8').split('\n');
const vaultL = readFileSync('G:/Dev/Projects/Txais Brain/03 - Wiki/Syntheses/Kolux Improvements from BridgeMind.md', 'utf8').split('\n');
const cards = {};
for (const l0 of repoDoc) { const l = l0.trim(); const m = l.match(/^\| ([A-Z]+-\d+) \| (P\d) \| (\w) \| (.*?) \| (.*?) \|$/); if (m) cards[m[1]] = { id: m[1], p: m[2], size: m[3], area: m[4], title: m[5], marks: [] }; }
for (const l0 of vaultL) { const l = l0.trim(); const m = l.match(/^\| ([A-Z]+-\d+) \|.*?\| (.*?) — \*\*(.*?)\*\* \|$/); if (m && cards[m[1]]) cards[m[1]].marks.push(`${m[3]} (vault table, no date; v0.12.0 tagged 2026-09-28)`); }
let cur = null;
for (const l of vaultL) { const h = l.match(/^#### ([A-Z]+-\d+):/); if (h) cur = h[1]; const s = l.match(/\*\*Shipped in ([\d.]+)\*\* \(tag `(v[\d.]+)`, (\d{4}-\d{2}-\d{2}): "(.*?)"\)/); if (s && cur && cards[cur]) cards[cur].marks.push(`Shipped in ${s[1]} on ${s[3]}: "${s[4]}" (vault card section)`); }
const inferred = { 'ACCT-5': 'sign-in expiry notices', 'AGENT-4': 'quiet-agent alerts', 'PROD-2': 'hidden dead-server features', 'PROD-3': 'release notes in update card', 'TERM-5': 'Copy terminal diagnostics', 'VOICE-2': 'push-to-talk with test box', 'WORK-2': 'Review changes', 'AGENT-2': 'shapes and roles (inferred, not verified)' };
const idsAll = Object.values(cards);
let md = `# BridgeMind improvement cards (${idsAll.length} parsed)\n\nSources: repo \`docs/research/bridgemind/kolux-improvements-from-bridgemind.md\` (id, priority, size, title; no shipped markers in the repo doc) and the vault page (markers). Dates: card-section markers carry date; vault table markers do not. Cards in the "named in tag message" column are from the vault's Correction note 2026-09-28 (v0.12.0, commit 070c3e368), not marked on the card itself. Later HANDOFF.md work citing card ids: PROD-7 protected actions (2026-09-29), WORK-1 restore (2026-09-29), ACCT-7 sign-in opt-out (2026-09-28) are cited in HANDOFF.md Recent work as shipped.\n\n| id | priority | size | title | shipped / unshipped marker |\n|---|---|---|---|---|\n`;
const handoffCited = { 'PROD-7': 'Shipped 2026-09-29 (HANDOFF.md Recent work: Protected actions)', 'WORK-1': 'Shipped 2026-09-29 (HANDOFF.md Recent work: terminal/workspace restore)', 'ACCT-7': 'Shipped 2026-09-28 (HANDOFF.md Recent work: Claude sign-in opt-out)' };
let shipped = 0;
for (const c of idsAll) {
  let mk = [...new Set(c.marks)].join('; ');
  if (!mk && inferred[c.id]) mk = `Named in v0.12.0 tag message (${inferred[c.id]}), 2026-09-28 per vault correction note`;
  if (handoffCited[c.id]) mk = (mk ? mk + '; ' : '') + handoffCited[c.id];
  if (mk) shipped++;
  md += `| ${c.id} | ${c.p} | ${c.size} | ${c.title.replace(/\|/g, '/')} | ${mk || 'no marker (unshipped or unrecorded)'} |\n`;
}
writeFileSync(O + 'improvement-cards.md', md);
summary.cards = idsAll.length; summary.cardsWithMarker = shipped;
const bfDir = R + '/specs/business-frame';
const bf = readdirSync(bfDir);
let b = '# specs/business-frame\n\n';
for (const f of bf) { const t = readFileSync(bfDir + '/' + f, 'utf8').split('\n'); b += `## ${f} (${t.length} lines)\n` + t.filter(l => /^#{1,4} /.test(l)).map(l => '- ' + l).join('\n') + '\n\n'; }
const map = readFileSync(bfDir + '/MAP.md', 'utf8').split('\n').filter(l => l.startsWith('|'));
b += '## MAP.md table rows (verbatim)\n\n' + (map.length ? map.join('\n') : '(MAP.md has no table)') + '\n';
writeFileSync(O + 'business-frame.md', b); summary.businessFrameFiles = bf.length; summary.mapTableRows = map.length;
// 8 package
const P = JSON.parse(readFileSync(R + '/package.json', 'utf8'));
const nv = ['.nvmrc', '.node-version', '.tool-versions'].filter(f => { try { statSync(R + '/' + f); return true; } catch { return false; } });
const ks = o => Object.keys(o || {});
writeFileSync(O + 'package-facts.txt', `name: ${P.name}\nversion: ${P.version}\nproductName: ${P.productName ?? '(none at top level)'}\nbuild.productName: ${P.build?.productName ?? '(none)'}\nengines: ${JSON.stringify(P.engines)}\npackageManager: ${(P.packageManager || '').split('+')[0]}\nversion-pin files: ${nv.join(', ') || 'none'}\n\ndependencies (${ks(P.dependencies).length}):\n${ks(P.dependencies).join('\n')}\n\ndevDependencies (${ks(P.devDependencies).length}):\n${ks(P.devDependencies).join('\n')}\n\nscripts (${ks(P.scripts).length}):\n${ks(P.scripts).join('\n')}\n`);
summary.deps = ks(P.dependencies).length; summary.devDeps = ks(P.devDependencies).length; summary.scripts = ks(P.scripts).length;
summary.productNameTopLevel = P.productName ?? null;
writeFileSync(O + 'summary-tmp.json', JSON.stringify(summary));

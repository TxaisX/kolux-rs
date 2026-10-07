// Wave 0: mechanical dump of Kolux test titles per functional area.
// Dirty-room material. Output goes to kolux-rs/provenance/dirty-room/dumps (forbidden to the clean room).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const REPO = 'G:/Dev/Kolux/kolux';
const OUT = 'G:/Dev/kolux-rs/provenance/dirty-room/dumps';
const ROOTS = ['src', 'tests'];
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git', '__fixtures__', '.cross-version-checkouts']);

const AREAS = {
  '00': '00-unmapped', '01': '01-projects-worktrees', '02': '02-sessions-launching', '03': '03-terminals-panes',
  '04': '04-agent-status-hooks', '05': '05-views-navigation', '06': '06-usage-limits', '07': '07-accounts-keys',
  '08': '08-orchestration', '09': '09-automations', '10': '10-plan-review-protected', '11': '11-git-review',
  '12': '12-editor-files', '13': '13-browser-computer', '14': '14-native-chat', '15': '15-skills-plugins-kits',
  '16': '16-onboarding', '17': '17-settings-appearance', '18': '18-remote-hosts-DROPPED', '19': '19-app-lifecycle',
  '20': '20-cli', '21': '21-retired-hidden', '99': '99-tooling',
};

// --- 1. directory prefix rules (first match wins). Paths use forward slashes, relative to repo root.
const C = 'src/renderer/src/components/';
const M = 'src/main/';
const S = 'src/shared/';
const R = 'src/renderer/src/';
const PREFIX = [
  // tooling / fixtures
  ['tests/tools/', '99'], ['src/main/__fixtures__/', '99'], ['src/shared/__fixtures__/', '99'], ['src/renderer/src/runtime/__fixtures__/', '99'],
  // CLI
  ['src/cli/', '20'], [M + 'cli/', '20'],
  // dropped remote area
  ['src/relay/', '18'], [R + 'web/', '18'], [R + 'ssh/', '18'],
  ...['ssh', 'server', 'host', 'emulator', 'speech', 'wsl'].map(d => [M + d + '/', '18']),
  ...['mobile', 'emulator-pane', 'dictation'].map(d => [C + d + '/', '18']),
  // components
  ...['sidebar', 'workspace-cleanup', 'workspace-space', 'workspace-emoji', 'worktree-creation', 'repo', 'sparse'].map(d => [C + d + '/', '01']),
  ...['launch-agents', 'new-workspace', 'agent-picker', 'custom-agents', 'agent', 'agent-session-continuation'].map(d => [C + d + '/', '02']),
  ...['terminal', 'terminal-pane', 'terminal-window', 'tab-bar', 'tab-group', 'pane-layout', 'floating-terminal', 'terminal-quick-commands'].map(d => [C + d + '/', '03']),
  ...['inbox', 'activity', 'notifications'].map(d => [C + d + '/', '04']),
  ...['agents-view', 'board', 'dashboard', 'floor', 'cmd-j', 'right-sidebar', 'status-bar', 'session-rail', 'agent-grid', 'pet', 'ports', 'link-actions'].map(d => [C + d + '/', '05']),
  ...['stats', 'usage'].map(d => [C + d + '/', '06']),
  ...['accounts', 'ai-connections', 'kolux-profiles'].map(d => [C + d + '/', '07']),
  [C + 'automations/', '09'],
  [C + 'plan-review/', '10'],
  ...['github', 'github-item-dialog', 'github-project', 'gitlab', 'gitlab-item-dialog', 'pull-request-page', 'task-page', 'diff-comments', 'source-control'].map(d => [C + d + '/', '11']),
  [C + 'editor/', '12'],
  ...['browser-pane', 'network'].map(d => [C + d + '/', '13']),
  [C + 'native-chat/', '14'],
  ...['skills', 'plugin-catalog', 'starter-kits', 'artifacts', 'artifacts-library'].map(d => [C + d + '/', '15']),
  ...['onboarding', 'setup-guide', 'feature-wall', 'feature-tips', 'contextual-tours', 'plain-language', 'star-nag'].map(d => [C + d + '/', '16']),
  [C + 'settings/Accounts', '07'], [C + 'settings/accounts', '07'], [C + 'settings/ProtectedActions', '10'], [C + 'settings/protected-actions', '10'],
  ...['settings', 'ui', 'shared', 'icons'].map(d => [C + d + '/', '17']),
  ...['crash-report', 'updates', 'maintenance', 'error-boundaries'].map(d => [C + d + '/', '19']),
  [C + 'dashboard-popout/', '21'],
  // main
  [M + 'project-groups/', '01'],
  ...['pty', 'daemon', 'warp-themes', 'ghostty'].map(d => [M + d + '/', '03']),
  ...['agent-hooks', 'amp', 'antigravity', 'claude', 'codex', 'codex-cli', 'command-code', 'copilot', 'cursor', 'devin', 'droid', 'gemini', 'grok', 'hermes', 'kimi', 'mimo', 'minimax', 'openclaude', 'pi', 'tray', 'dock'].map(d => [M + d + '/', '04']),
  ...['ai-vault', 'menu', 'ports'].map(d => [M + d + '/', '05']),
  ...['rate-limits', 'claude-usage', 'codex-usage', 'usage', 'limit-auto-resume', 'stats'].map(d => [M + d + '/', '06']),
  ...['claude-accounts', 'codex-accounts', 'grok-accounts', 'ai-connections', 'providers', 'kolux-profiles'].map(d => [M + d + '/', '07']),
  ...['runtime', 'koluxd'].map(d => [M + d + '/', '08']),
  [M + 'automations/', '09'],
  [M + 'protected-actions/', '10'],
  ...['git', 'github', 'gitlab', 'bitbucket', 'azure-devops', 'gitea', 'jira', 'linear', 'text-generation', 'source-control'].map(d => [M + d + '/', '11']),
  [M + 'workspace-handoff/', '12'],
  ...['browser', 'computer'].map(d => [M + d + '/', '13']),
  [M + 'native-chat/', '14'],
  ...['skills', 'plugins', 'starter-kits', 'artifacts', 'artifacts-library'].map(d => [M + d + '/', '15']),
  [M + 'star-nag/', '16'],
  ...['keybindings', 'i18n'].map(d => [M + d + '/', '17']),
  ...['startup', 'window', 'updater', 'crash-reporting', 'persistence', 'hang-watchdog', 'local-builds', 'observability', 'telemetry', 'diagnostics', 'preflight', 'sqlite', 'lib', 'memory', 'windows', 'network'].map(d => [M + d + '/', '19']),
  ...['opencode', 'opencode-usage'].map(d => [M + d + '/', '21']),
  // shared
  [S + 'agent-hook-listener/', '04'], [S + 'agent-icons/', '02'], [S + 'ai-connections/', '07'], [S + 'child-process/', '19'],
  [S + 'github/', '11'], [S + 'keybindings/', '17'], [S + 'linear/', '11'], [S + 'network/', '19'], [S + 'new-workspace/', '02'],
  [S + 'plugins/', '15'], [S + 'source-scan/', '01'], [S + 'starter-kits/', '15'], [S + 'worktree/', '01'],
  // renderer misc
  [R + 'app-shell/', '05'], [R + 'i18n/', '17'], [R + 'startup/', '19'],
  [R + 'store/projects/', '01'], [R + 'store/repos/', '01'], [R + 'store/project-groups/', '01'], [R + 'store/folder-workspaces/', '01'],
  [R + 'store/terminals/', '03'], [R + 'store/github/', '11'],
];

// --- 2. filename keyword rules (first match wins), applied to the lowercased full relative path.
const KW = [
  ['18', ['ssh', 'relay', 'wsl', 'mobile', 'emulator', 'ephemeral-vm', 'speech', 'dictation', 'pairing', 'tailscale', 'web-client', 'kolux-serve', 'serve-', 'remote-host', 'remote-']],
  ['21', ['opencode', 'popout', 'agent-map', 'kolux-account']],
  ['09', ['automation']],
  ['08', ['orchestrat', 'mailbox', 'koluxd', 'worker']],
  ['14', ['native-chat', 'structured-session', 'structured-runtime']],
  ['13', ['browser', 'computer', 'guest-view', 'fedcm', 'cookie']],
  ['10', ['plan-review', 'protected', 'trust']],
  ['11', ['github', 'gitlab', 'bitbucket', 'azure', 'gitea', 'jira', 'linear', 'pull-request', 'review', 'diff', 'commit', 'source-control', 'text-generation', 'task-page', '/git/', 'git-']],
  ['06', ['usage', 'rate-limit', 'limit-auto-resume', 'context-cap', 'stats', 'forecast']],
  ['05', ['ai-vault', 'board', 'agents-view', 'dashboard', 'floor', 'cmd-j', 'right-sidebar', 'status-bar', 'session-rail', 'active-view', 'app-shell', '/pet', 'ports', 'sidebar', 'swarm', '/menu/', 'agent-grid', '-view', 'view-', 'views']],
  ['07', ['account', 'sign-in', 'signin', 'login', 'auth', 'ai-connection', 'provider', 'api-key', 'key-vault', 'profile', 'credential', 'oauth']],
  ['04', ['agent-hook', 'hook', 'agent-status', 'notification', 'tray', 'dock', 'badge', 'quiet', 'stop-failure', 'inbox', 'activity', 'descendant', 'attention', 'needs-you', 'subagent', 'teammate',
          '/amp/', '/antigravity/', '/claude/', '/codex/', '/codex-cli/', '/command-code/', '/copilot/', '/cursor/', '/devin/', '/droid/', '/gemini/', '/grok/', '/hermes/', '/kimi/', '/mimo/', '/minimax/', '/openclaude/', '/pi/']],
  ['03', ['terminal', 'pane', 'tab-bar', 'tab-group', '-tab', 'tab-', 'split', 'pty', 'xterm', 'scrollback', 'daemon', 'floating', 'awake', 'caffeinate', 'hibernate', 'warp', 'ghostty', '-ime', 'alternate-screen', 'tui', 'paste', 'webgl', 'garble', 'equalize', 'quick-command', 'send']],
  ['02', ['launch', 'new-workspace', 'agent-picker', 'agent-combobox', 'custom-agent', 'agent-catalog', 'agent-detection', 'agent-session', 'composer', 'shape', 'seat', 'lineup', 'featured', 'background-session', 'agent-draft', 'model', '/agent/']],
  ['16', ['onboarding', 'setup-guide', 'feature-wall', 'feature-tip', 'tour', 'plain-language', 'jargon', 'star-nag', 'first-run', 'welcome', 'newcomer', 'checklist']],
  ['15', ['skill', 'plugin', 'starter-kit', 'artifact']],
  ['12', ['editor', 'monaco', 'explorer', 'filesystem', 'handoff', 'doc-preview', 'search', 'file-']],
  ['17', ['settings', 'keybinding', 'shortcut', 'theme', 'appearance', 'font', 'i18n', 'locale', 'hue']],
  ['01', ['worktree', 'workspace', 'repo', 'project', 'sparse', 'symlink', 'fork', 'onedrive', 'checkout', 'lineage', 'nested', 'emoji', 'cleanup', 'treemap', 'space']],
  ['19', ['startup', 'window', 'updat', 'crash', 'persist', 'watchdog', 'local-build', 'observab', 'telemetry', 'diagnostic', 'preflight', 'sqlite', 'appimage', 'asar', 'relaunch', 'memory', 'resource', 'durable', 'error-boundar', 'maintenance', 'release', 'smoke', 'network', 'proxy', 'http', 'feedback', 'single-instance', 'deep-link', 'protocol', '/windows/', 'macos', 'linux', 'app-']],
];

function assignArea(rel) {
  for (const [p, a] of PREFIX) if (rel.startsWith(p)) return [a, 'prefix:' + p];
  const low = rel.toLowerCase();
  for (const [a, kws] of KW) for (const k of kws) if (low.includes(k)) return [a, 'kw:' + k];
  return ['00', 'fallback'];
}

// --- 3. walk
function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(test|spec)\.(ts|tsx|js|mjs|cjs|mts)$/.test(name)) acc.push(p);
  }
  return acc;
}
const files = [];
for (const r of ROOTS) walk(join(REPO, r), files);

// --- 4. extract titles
const TITLE_RE = /^\s*(?:test\.)?(describe|it|test)(?:\.(?:each|skip|only|todo|concurrent|sequential|serial|fails|runIf|skipIf|for)(?:\([^)]*\))?)*\s*\(\s*(['"`])((?:\\.|(?!\2)[^\n])*?)\2/;
const perArea = {}; // area -> { lines:[], describes:Map, files:Map, its:[] }
const fileMap = [];
let totalIt = 0, totalDescribe = 0, unparsed = 0;
for (const f of files) {
  const rel = relative(REPO, f).split(sep).join('/');
  const [area, rule] = assignArea(rel);
  fileMap.push([rel, area, rule]);
  const A = perArea[area] ??= { lines: [], describes: new Map(), files: new Map(), its: [] };
  const src = readFileSync(f, 'utf8');
  let lastDescribe = '';
  let count = 0;
  for (const line of src.split('\n')) {
    if (!/^\s*(?:test\.)?(?:describe|it|test)\b/.test(line)) continue;
    const m = TITLE_RE.exec(line);
    if (!m) { unparsed++; continue; }
    const kind = m[1], title = m[3].trim();
    if (kind === 'describe') { lastDescribe = title; A.describes.set(title, (A.describes.get(title) ?? 0) + 1); totalDescribe++; continue; }
    totalIt++; count++;
    A.lines.push(`${rel}\t${lastDescribe}\t${title}`);
    A.its.push(`${rel}\t${title}`);
  }
  A.files.set(rel, count);
}

// --- 5. write
mkdirSync(join(OUT, 'tests'), { recursive: true });
mkdirSync(join(OUT, 'samples'), { recursive: true });
mkdirSync(join(OUT, 'e2e'), { recursive: true });
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function sample(arr, n, seed) { const rnd = mulberry32(seed); const idx = arr.map((_, i) => i); for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return idx.slice(0, n).map(i => arr[i]); }

const summary = [['area', 'files', 'describes', 'titles']];
for (const [code, name] of Object.entries(AREAS)) {
  const A = perArea[code]; if (!A) continue;
  writeFileSync(join(OUT, 'tests', `${name}.txt`), `# ${name}: file\tdescribe\ttitle  (${A.lines.length} titles, ${A.files.size} files)\n` + A.lines.join('\n') + '\n');
  const desc = [...A.describes.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${c}\t${t}`);
  writeFileSync(join(OUT, 'tests', `${name}.describes.txt`), `# ${name}: count\tdescribe title  (${desc.length} unique)\n` + desc.join('\n') + '\n');
  const fl = [...A.files.entries()].sort((a, b) => b[1] - a[1]).map(([f, c]) => `${c}\t${f}`);
  writeFileSync(join(OUT, 'tests', `${name}.files.txt`), `# ${name}: titles\tfile  (${fl.length} files)\n` + fl.join('\n') + '\n');
  for (let r = 1; r <= 3; r++) {
    const s = sample(A.its, 100, 1000 * Number(code) + r);
    writeFileSync(join(OUT, 'samples', `${name}-r${r}.txt`), `# ${name} random sample round ${r} (${s.length} of ${A.its.length}): file\ttitle\n` + s.join('\n') + '\n');
  }
  summary.push([name, A.files.size, A.describes.size, A.lines.length]);
}
writeFileSync(join(OUT, 'tests', '_areas.csv'), summary.map(r => r.join(',')).join('\n') + '\n');
writeFileSync(join(OUT, 'tests', '_file-map.csv'), 'file,area,rule\n' + fileMap.map(r => r.map(x => `"${x}"`).join(',')).join('\n') + '\n');
const e2e = fileMap.filter(([f]) => f.startsWith('tests/e2e/') && /\.spec\./.test(f)).map(([f, a]) => `${AREAS[a]}\t${f.slice('tests/e2e/'.length)}`).sort();
writeFileSync(join(OUT, 'e2e', 'spec-names.txt'), `# area\tspec file  (${e2e.length} specs)\n` + e2e.join('\n') + '\n');
console.log(JSON.stringify({ files: files.length, titles: totalIt, describes: totalDescribe, unparsed, e2eSpecs: e2e.length, perArea: Object.fromEntries(summary.slice(1).map(r => [r[0], r[3]])) }, null, 1));

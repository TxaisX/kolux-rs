// Churn analysis over old Kolux repo (read-only). Dirty-room material.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const REPO = 'G:/Dev/Kolux/kolux';
const OUT = 'G:/Dev/kolux-rs/provenance/dirty-room';
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

const raw = execSync('git log main --numstat --date=short --format="@@%H|%ad|%s"', { cwd: REPO, maxBuffer: 1 << 30 }).toString('utf8');
const commits = [];
let cur = null;
for (const line of raw.split('\n')) {
  if (line.startsWith('@@')) {
    const [h, d, ...s] = line.slice(2).split('|');
    cur = { h: h.slice(0, 9), date: d, subject: s.join('|'), files: [] };
    commits.push(cur);
  } else if (line.trim() && cur) {
    const [a, b, ...p] = line.split('\t');
    let path = p.join('\t');
    const m = path.match(/^(.*)\{.* => (.*)\}(.*)$/);
    if (m) path = (m[1] + m[2] + m[3]).replace(/\/\//g, '/');
    else if (path.includes(' => ')) path = path.split(' => ')[1];
    cur.files.push({ path, ins: a === '-' ? 0 : +a, del: b === '-' ? 0 : +b });
  }
}
function excludeReason(c) {
  if (c.date === '2026-09-10' && c.subject === 'Nightshift') return 'base-import';
  if ((c.date === '2026-09-21' || c.date === '2026-09-22') && /rename|app is Kolux/i.test(c.subject)) return 'rename';
  if (c.date === '2026-10-05' && /scrub/i.test(c.subject)) return 'originality-scrub';
  if (c.files.length > 500) return 'over-500-files';
  return null;
}
const q = s => '"' + String(s).replace(/"/g, '""') + '"';
const excl = [], kept = [];
for (const c of commits) { const r = excludeReason(c); if (r) excl.push([c, r]); else kept.push(c); }
writeFileSync(OUT + '/churn-excluded.csv', 'hash,date,subject,files,reason\n' + excl.map(([c, r]) => [c.h, c.date, q(c.subject), c.files.length, r].join(',')).join('\n') + '\n');

const areas = {}, weeks = {};
function isoWeek(ds) {
  const d = new Date(ds + 'T00:00:00Z'); const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = d.getUTCFullYear(); const j = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((d - j) / 864e5 - 3 + ((j.getUTCDay() + 6) % 7)) / 7);
  return y + '-W' + String(w).padStart(2, '0');
}
for (const c of kept) {
  const per = {};
  for (const f of c.files) {
    const [a] = assignArea(f.path);
    const k = AREAS[a];
    (per[k] ??= { files: new Set(), ins: 0, del: 0 });
    per[k].files.add(f.path); per[k].ins += f.ins; per[k].del += f.del;
  }
  for (const [k, v] of Object.entries(per)) {
    const A = (areas[k] ??= { commits: 0, files: new Set(), ins: 0, del: 0, first: c.date, last: c.date });
    A.commits++; v.files.forEach(x => A.files.add(x)); A.ins += v.ins; A.del += v.del;
    if (c.date < A.first) A.first = c.date; if (c.date > A.last) A.last = c.date;
    const wk = isoWeek(c.date) + '|' + k;
    const W = (weeks[wk] ??= { commits: 0, churn: 0 }); W.commits++; W.churn += v.ins + v.del;
  }
}
writeFileSync(OUT + '/churn.csv', 'area,commits,files_changed,insertions,deletions,first_commit_date,last_commit_date\n' +
  Object.entries(areas).sort().map(([k, A]) => [k, A.commits, A.files.size, A.ins, A.del, A.first, A.last].join(',')).join('\n') + '\n');
writeFileSync(OUT + '/churn-by-week.csv', 'iso_week,area,commits,insertions_plus_deletions\n' +
  Object.entries(weeks).sort().map(([k, W]) => k.split('|').concat([W.commits, W.churn]).join(',')).join('\n') + '\n');

const THEMES = {
  'terminal|pane|grid|tab': /terminal|pane|grid|tab/i, 'worktree|isolation': /worktree|isolation/i,
  'status|hook|notification|inbox|stopped|quiet|plan review|plan-review': /status|hook|notification|inbox|stopped|quiet|plan review|plan-review/i,
  'account|sign-in|signin|usage|limit|forecast|key vault|keys': /account|sign-in|signin|usage|limit|forecast|key vault|keys/i,
  'protected|security|redact|audit|trust': /protected|security|redact|audit|trust/i,
  'starter kit|onboarding|business|first run|jargon|connect card': /starter kit|onboarding|business|first run|jargon|connect card/i,
  'redesign|design|view|board|agents view|look': /redesign|design|view|board|agents view|look/i,
  'release|update|updater|ci|ship|install': /release|update|updater|ci|ship|install/i,
  'restore|daemon|reliab|lost|persist': /restore|daemon|reliab|lost|persist/i,
  'rename|kolux|nightshift|original|scrub|license': /rename|kolux|nightshift|original|scrub|license/i,
  'orchestrat|automation|run|worker|routing': /orchestrat|automation|run|worker|routing/i,
};
writeFileSync(OUT + '/commits-by-theme.csv', 'theme,commits_all,commits_excluding_mechanical\n' +
  Object.entries(THEMES).map(([t, re]) => [q(t), commits.filter(c => re.test(c.subject)).length, kept.filter(c => re.test(c.subject)).length].join(',')).join('\n') + '\n');
console.log('total', commits.length, 'excluded', excl.length, 'kept', kept.length);

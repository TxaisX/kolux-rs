# COMPAT evidence (dirty room)

Dirty-room companion to `G:\Dev\kolux-rs\COMPAT.md`. Paths are relative to the old repo `G:\Dev\Kolux\kolux` unless absolute. Registries are under `G:\Dev\kolux-rs\provenance\dirty-room\dumps\registries`. Never copy this file into the clean room.

## 1. Versions and the rule

- Installed CLI version: `dumps\cli\_tree.txt` line 1 ("CLI version 0.15.2"), captured from the installed `kolux.exe`.
- Source tree version: `package.json` in the old repo reads 0.15.0.
- Skills that drive the CLI: kolux-cli, kolux-run, orchestration (Txais's skills, per the dirty-room brief `provenance\dirty-room\briefs\00-shared.md`).
- `dumps\cli\_dump-log.txt`: "orchestration send/reply help re-captured via kolux.exe because kolux.cmd refuses to forward message bodies" (204 files written incl. root).

## 2. CLI

- Manifest: `dumps\registries\cli-manifest.tsv` (229 rows; columns manifest_handler_group, command_path, spec_aliases, hidden, destructive, argument_mode, allowed_flags, positional_args, usage_as_declared, summary, output_fields_declared, evidence). output_fields_declared is "not declared in spec" on every row.
- Root help: `dumps\cli\_root-help.txt`; per-command help `dumps\cli\<group>-<cmd>-help.txt`; source-only top-level help `dumps\cli\_top-<cmd>-help.txt`; flag tree `dumps\cli\_tree.txt`.
- Spec cards: `G:\Dev\kolux-rs\spec\20-cli.md` lines 171 and 179 (exit 75 hand-back from orchestration ask on the packaged Windows build), 323-324 (repo and worktree selector prefixes), 584 and 694 (kolux.cmd refuses orchestration send and reply, exit 2), 685 and 697 (exit statuses 0, 1, 2, 75), 978-1019 (browser `--page`). CLI-048 retires coordinator-start and coordinator-stop (tier H, default skip). D cards CLI-049 to CLI-056 carry the dropped groups.
- Fate rules used by the generator: drop when handler group is computer, emulator, environment, linear or vm, or the command is serve, open-url or a project host-setup command (everything in group project except project list); held for orchestration coordinator-start and coordinator-stop; keep otherwise. Result: 156 keep, 2 held, 71 drop.
- Dropped flags stripped from kept rows: linear-issue on worktree create and worktree set; project, host and project-host-setup on worktree create, automations create and automations edit. Globals pairing-code and environment are listed once as not carried.
- Source-only (not reachable from root help): 49 rows. Kept 21: claude-teams (`src/cli/specs/core.ts`), terminal stop (hidden), select-all, pdf, full-screenshot, cookie get/set/delete, viewport, geolocation, intercept enable/disable/list, capture start/stop, console, network, agent hooks prepare-codex/status/off/on. Dropped 28: open-url and the 27 linear commands.
- Windows launcher: packaged `kolux.cmd` forwards to `kolux.exe`; refusal of orchestration send/reply observed in the dump log and spec lines above.

## 3. Hooks

- Registry: `dumps\registries\hook-events.tsv` (123 rows; columns agent, event_name, config_target_file, status_mapped, mapping_notes, windows_wrapper_or_script, evidence).
- Verified against source (50 rows):
  - Claude and OpenClaude: `src/main/claude/hook-settings.ts:27-100` (CLAUDE_HOOK_SETTINGS line 27, OPENCLAUDE_HOOK_SETTINGS line 33, shared event list from line 40; StopFailure registered at line 57 with the OpenClaude rationale at 54-55; PreCompact deliberately not registered (comment at 96-98); PostCompact registered at line 100); `src/main/openclaude/hook-service.ts:1-8` (OpenClaude reuses the Claude hook service with its own settings); status mapping `src/shared/agent-hook-listener/providers/claude-events.ts`, `claude-stop-failure.ts:29-65`, `claude-lifecycle-events.ts:20-143`, `src/main/agent-hooks/server/server-claude-status-rules.ts:44-191`.
  - Codex, Gemini, Cursor: rows' evidence column below, read in the earlier pass of this task.
- Status model: `src/shared/agent-status-types.ts` (states working, blocked, waiting, done; working mode monitoring; stop reasons limit, auth, provider-error with reset time; sub-agent states working, blocked, waiting, idle; history capped at 20).
- Hook transport: `src/main/agent-hooks/hook-post-command.ts` (loopback POST to /hook/<source>, connect 0.5 s, total 1.5 s, no proxy, token header, base64 metadata header; Windows guard exits 0 without reading stdin when port, token or pane key is missing; stdin read through the system pager by full path; endpoint file re-sourced; POSIX spool per pane, dir 700, file 600, 5 MB cap, 7-day expiry, tool events skipped) and `src/main/agent-hooks/hook-stdin-contract.ts`.
- Claude status line: `src/main/claude/hook-service.ts:160-185` (installed only when the statusLine slot is empty and no marker exists; marker claude-statusline.installed), `src/main/claude/statusline-script.ts` (forwards rate_limits and context_window, throttled).
- Not in the registry: pi, omp, prime-agent status extensions (catalog rows below, env vars KOLUX_PI_*, KOLUX_OMP_*, KOLUX_PRIME_AGENT_*).

## 4. Keybindings

- Registry: `dumps\registries\keybindings.tsv` (129 rows). 51 ship unbound (16 non-agent plus 35 tab.newAgent.*); the brief expected 37. Six have a darwin default only: workspace.rename, sidebar.ports.toggle, floatingWorkspace.maximize, tab.newAgent, tab.newSimulator, tab.rename.
- File: `src/main/keybindings/keybinding-file.ts`, `src/main/keybindings/keybinding-file-parser.ts` (path home/.kolux/keybindings.json; root keys $schema, version 1, keybindings, platforms darwin/linux/win32; values string, string[], null or false; legacy top-level form; diagnostics: unknown action warning, unknown platform warning, bad value error, non-object or unreadable error).
- Merge and conflicts: `src/shared/keybindings/formatting.ts:172-212` (removeConflictingOverrides, up to 20 passes, error names titles; only conflicts that involve a customised id; bucket = conflictGroup or scope).
- Menu hints: `dumps\registries\menu-items.tsv` (57 rows). Hint-only items: Open Worktree Palette (`src/main/menu/register-app-menu.ts:311`), Cycle Workspace View (`src/main/menu/workspace-view-menu.ts:59`).
- Txais's file: `C:\Users\XiongT\.kolux\keybindings.json` (942 B; 13 win32 overrides, one unknown id voice.dictation).

## 5. Data

- Data file: `%APPDATA%\kolux\profiles\local-default\kolux-data.json` (50,491 B). Only top-level key names and counts were read: schemaVersion, repos 3, projects 2, projectHostSetups 3, worktreeMeta 14, settings 203, ui 100, workspaceSession 30, automations 0, sshTargets 0. Secret-bearing settings keys were identified by name only; no value was read.
- Sealed secret slots: `src/main/protected-secret-persistence.ts:3-8`. Sealing service: `src/main/host/electron-secret-store.ts`. Migration sweeps: `src/main/startup/credential-encryption-migration.ts`.
- Setup-script env: `src/main/setup-hook-env-vars.ts:7-23`. Worktree root override: `src/shared/kolux-workspaces-dir.ts:1-9`.
- kolux.yaml: `src/shared/kolux-yaml-hook-types.ts`, `src/shared/kolux-yaml.ts:30,38-75,233-274`, `src/shared/kolux-yaml-file-resolution.ts`.
- Importer skip list: `G:\Dev\kolux-rs\provenance\dirty-room\dropped-18-inventory.md:116-141` (17 rows). Three more default-cut rows (Kolux Account cloud session, Linear, Bitbucket/Gitea/Azure credentials) from the spec D cards.
- Disk listings taken with directory listings only (names and sizes) on 2026-10-06.

## 2. CLI rows (manifest, with fate and evidence)

| Group | Command | Fate | Hidden | Destructive | Evidence |
|---|---|---|---|---|---|
| core | open | keep |  |  | src/cli/specs/core.ts:11 |
| core | serve | drop |  |  | src/cli/specs/serve.ts:6 |
| core | status | keep |  |  | src/cli/specs/core.ts:19 |
| core | claude-teams | keep (source only) |  |  | src/cli/specs/core.ts:26 |
| repo | repo list | keep |  |  | src/cli/specs/core.ts:38 |
| repo | repo add | keep |  |  | src/cli/specs/core.ts:44 |
| repo | repo show | keep |  |  | src/cli/specs/core.ts:50 |
| repo | repo set-base-ref | keep |  |  | src/cli/specs/core.ts:56 |
| repo | repo search-refs | keep |  |  | src/cli/specs/core.ts:62 |
| worktree | worktree list | keep |  |  | src/cli/specs/core.ts:68 |
| worktree | worktree show | keep |  |  | src/cli/specs/core.ts:75 |
| worktree | worktree current | keep |  |  | src/cli/specs/core.ts:81 |
| worktree | worktree create | keep |  |  | src/cli/specs/core.ts:91 |
| worktree | worktree set | keep |  |  | src/cli/specs/core.ts:142 |
| worktree | worktree rm | keep |  | yes | src/cli/specs/core.ts:167 |
| worktree | worktree changes | keep |  |  | src/cli/specs/worktree-changes.ts:6 |
| worktree | worktree overlap | keep |  |  | src/cli/specs/worktree-changes.ts:20 |
| worktree | worktree ps | keep |  |  | src/cli/specs/core.ts:185 |
| terminal | terminal list | keep |  |  | src/cli/specs/core.ts:192 |
| terminal | terminal show | keep |  |  | src/cli/specs/core.ts:202 |
| terminal | terminal read | keep |  |  | src/cli/specs/core.ts:208 |
| terminal | terminal send | keep |  |  | src/cli/specs/terminal-send.ts:5 |
| terminal | terminal wait | keep |  |  | src/cli/specs/core.ts:232 |
| terminal | terminal stop | keep (source only) | yes |  | src/cli/specs/core.ts:239 |
| terminal | terminal create | keep |  |  | src/cli/specs/core.ts:249 |
| terminal | terminal switch | keep |  |  | src/cli/specs/core.ts:266 |
| terminal | terminal close | keep |  | yes | src/cli/specs/terminal-close.ts:5 |
| terminal | terminal rename | keep |  |  | src/cli/specs/core.ts:277 |
| terminal | terminal split | keep |  |  | src/cli/specs/core.ts:288 |
| account | account add | keep |  |  | src/cli/specs/account.ts:10 |
| account | account list | keep |  |  | src/cli/specs/account.ts:23 |
| project | project list | keep |  |  | src/cli/specs/project.ts:6 |
| project | project setups | drop |  |  | src/cli/specs/project.ts:13 |
| project | project setup-existing-folder | drop |  |  | src/cli/specs/project.ts:31 |
| project | project setup-clone | drop |  |  | src/cli/specs/project.ts:47 |
| project | project setup-create | drop |  |  | src/cli/specs/project.ts:63 |
| project | project setup-update | drop |  |  | src/cli/specs/project.ts:90 |
| project | project setup-delete | drop |  | yes | src/cli/specs/project.ts:115 |
| file | file open | keep |  |  | src/cli/specs/file.ts:6 |
| file | file diff | keep |  |  | src/cli/specs/file.ts:20 |
| file | file open-changed | keep |  |  | src/cli/specs/file.ts:35 |
| automations | automations list | keep |  |  | src/cli/specs/automations.ts:26 |
| automations | automations show | keep |  |  | src/cli/specs/automations.ts:33 |
| automations | automations create | keep |  |  | src/cli/specs/automations.ts:41 |
| automations | automations edit | keep |  |  | src/cli/specs/automations.ts:72 |
| automations | automations remove | keep |  | yes | src/cli/specs/automations.ts:93 |
| automations | automations run | keep |  |  | src/cli/specs/automations.ts:102 |
| automations | automations runs | keep |  |  | src/cli/specs/automations.ts:110 |
| browser-tab | open-url | drop (source only) |  |  | src/cli/specs/browser-basic.ts:6 |
| browser-nav | snapshot | keep |  |  | src/cli/specs/browser-basic.ts:12 |
| browser-nav | screenshot | keep |  |  | src/cli/specs/browser-basic.ts:18 |
| browser-interact | click | keep |  |  | src/cli/specs/browser-basic.ts:24 |
| browser-interact | fill | keep |  |  | src/cli/specs/browser-basic.ts:30 |
| browser-interact | type | keep |  |  | src/cli/specs/browser-basic.ts:36 |
| browser-interact | select | keep |  |  | src/cli/specs/browser-basic.ts:42 |
| browser-nav | scroll | keep |  |  | src/cli/specs/browser-basic.ts:48 |
| browser-nav | goto | keep |  |  | src/cli/specs/browser-basic.ts:55 |
| browser-nav | back | keep |  |  | src/cli/specs/browser-basic.ts:61 |
| browser-nav | reload | keep |  |  | src/cli/specs/browser-basic.ts:67 |
| browser-nav | eval | keep |  |  | src/cli/specs/browser-basic.ts:73 |
| browser-nav | wait | keep |  |  | src/cli/specs/browser-basic.ts:79 |
| browser-interact | check | keep |  |  | src/cli/specs/browser-basic.ts:96 |
| browser-interact | uncheck | keep |  |  | src/cli/specs/browser-basic.ts:102 |
| browser-interact | focus | keep |  |  | src/cli/specs/browser-basic.ts:108 |
| browser-interact | clear | keep |  |  | src/cli/specs/browser-basic.ts:114 |
| browser-interact | select-all | keep (source only) |  |  | src/cli/specs/browser-basic.ts:120 |
| browser-interact | keypress | keep |  |  | src/cli/specs/browser-basic.ts:126 |
| browser-nav | pdf | keep (source only) |  |  | src/cli/specs/browser-basic.ts:132 |
| browser-nav | full-screenshot | keep (source only) |  |  | src/cli/specs/browser-basic.ts:138 |
| browser-interact | hover | keep |  |  | src/cli/specs/browser-basic.ts:144 |
| browser-interact | drag | keep |  |  | src/cli/specs/browser-basic.ts:150 |
| browser-interact | upload | keep |  |  | src/cli/specs/browser-basic.ts:156 |
| browser-tab | tab list | keep |  |  | src/cli/specs/browser-basic.ts:162 |
| browser-tab | tab show | keep |  |  | src/cli/specs/browser-basic.ts:168 |
| browser-tab | tab current | keep |  |  | src/cli/specs/browser-basic.ts:174 |
| browser-tab | tab switch | keep |  |  | src/cli/specs/browser-basic.ts:180 |
| browser-tab | tab create | keep |  |  | src/cli/specs/browser-basic.ts:187 |
| browser-profile | tab profile list | keep |  |  | src/cli/specs/browser-basic.ts:193 |
| browser-profile | tab profile create | keep |  |  | src/cli/specs/browser-basic.ts:199 |
| browser-profile | tab profile delete | keep |  | yes | src/cli/specs/browser-basic.ts:206 |
| browser-profile | tab profile set | keep |  |  | src/cli/specs/browser-basic.ts:213 |
| browser-profile | tab profile show | keep |  |  | src/cli/specs/browser-basic.ts:219 |
| browser-profile | tab profile use-default | keep |  |  | src/cli/specs/browser-basic.ts:225 |
| browser-profile | tab profile clone | keep |  |  | src/cli/specs/browser-basic.ts:231 |
| browser-tab | tab close | keep |  |  | src/cli/specs/browser-basic.ts:237 |
| browser-tab | exec | keep |  |  | src/cli/specs/browser-basic.ts:243 |
| browser-cookie | cookie get | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:7 |
| browser-cookie | cookie set | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:13 |
| browser-cookie | cookie delete | keep (source only) |  | yes | src/cli/specs/browser-advanced.ts:31 |
| browser-env | viewport | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:40 |
| browser-env | geolocation | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:48 |
| browser-capture | intercept enable | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:56 |
| browser-capture | intercept disable | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:62 |
| browser-capture | intercept list | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:68 |
| browser-capture | capture start | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:77 |
| browser-capture | capture stop | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:83 |
| browser-capture | console | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:89 |
| browser-capture | network | keep (source only) |  |  | src/cli/specs/browser-advanced.ts:95 |
| browser-interact | dblclick | keep |  |  | src/cli/specs/browser-advanced.ts:102 |
| browser-nav | forward | keep |  |  | src/cli/specs/browser-advanced.ts:108 |
| browser-interact | scrollintoview | keep |  |  | src/cli/specs/browser-advanced.ts:114 |
| browser-interact | get | keep |  |  | src/cli/specs/browser-advanced.ts:120 |
| browser-interact | is | keep |  |  | src/cli/specs/browser-advanced.ts:126 |
| browser-interact | inserttext | keep |  |  | src/cli/specs/browser-advanced.ts:133 |
| browser-interact | mouse move | keep |  |  | src/cli/specs/browser-advanced.ts:140 |
| browser-interact | mouse down | keep |  |  | src/cli/specs/browser-advanced.ts:146 |
| browser-interact | mouse up | keep |  |  | src/cli/specs/browser-advanced.ts:152 |
| browser-interact | mouse wheel | keep |  |  | src/cli/specs/browser-advanced.ts:158 |
| browser-interact | find | keep |  |  | src/cli/specs/browser-advanced.ts:165 |
| browser-env | set device | keep |  |  | src/cli/specs/browser-advanced.ts:173 |
| browser-env | set offline | keep |  |  | src/cli/specs/browser-advanced.ts:179 |
| browser-env | set headers | keep |  |  | src/cli/specs/browser-advanced.ts:185 |
| browser-env | set credentials | keep |  |  | src/cli/specs/browser-advanced.ts:191 |
| browser-env | set media | keep |  |  | src/cli/specs/browser-advanced.ts:197 |
| browser-env | clipboard read | keep |  |  | src/cli/specs/browser-advanced.ts:205 |
| browser-env | clipboard write | keep |  |  | src/cli/specs/browser-advanced.ts:211 |
| browser-env | dialog accept | keep |  |  | src/cli/specs/browser-advanced.ts:218 |
| browser-env | dialog dismiss | keep |  |  | src/cli/specs/browser-advanced.ts:224 |
| browser-storage | storage local get | keep |  |  | src/cli/specs/browser-advanced.ts:231 |
| browser-storage | storage local set | keep |  |  | src/cli/specs/browser-advanced.ts:237 |
| browser-storage | storage local clear | keep |  | yes | src/cli/specs/browser-advanced.ts:243 |
| browser-storage | storage session get | keep |  |  | src/cli/specs/browser-advanced.ts:250 |
| browser-storage | storage session set | keep |  |  | src/cli/specs/browser-advanced.ts:256 |
| browser-storage | storage session clear | keep |  | yes | src/cli/specs/browser-advanced.ts:262 |
| browser-interact | download | keep |  |  | src/cli/specs/browser-advanced.ts:270 |
| browser-interact | highlight | keep |  |  | src/cli/specs/browser-advanced.ts:277 |
| orchestration | orchestration run-create | keep |  |  | src/cli/specs/orchestration.ts:7 |
| orchestration | orchestration run-use | keep |  |  | src/cli/specs/orchestration.ts:18 |
| orchestration | orchestration run-current | keep |  |  | src/cli/specs/orchestration.ts:28 |
| orchestration | orchestration run-list | keep |  |  | src/cli/specs/orchestration.ts:34 |
| orchestration | orchestration run-show | keep |  |  | src/cli/specs/orchestration.ts:40 |
| orchestration | orchestration send | keep |  |  | src/cli/specs/orchestration.ts:46 |
| orchestration | orchestration check | keep |  |  | src/cli/specs/orchestration.ts:83 |
| orchestration | orchestration reply | keep |  |  | src/cli/specs/orchestration.ts:118 |
| orchestration | orchestration inbox | keep |  |  | src/cli/specs/orchestration.ts:125 |
| orchestration | orchestration task-create | keep |  |  | src/cli/specs/orchestration.ts:131 |
| orchestration | orchestration task-list | keep |  |  | src/cli/specs/orchestration.ts:148 |
| orchestration | orchestration task-update | keep |  |  | src/cli/specs/orchestration.ts:156 |
| orchestration | orchestration worker-start | keep |  |  | src/cli/specs/orchestration-worker-specs.ts:5 |
| orchestration | orchestration worker-show | keep |  |  | src/cli/specs/orchestration-worker-specs.ts:53 |
| orchestration | orchestration worker-read | keep |  |  | src/cli/specs/orchestration-worker-specs.ts:63 |
| orchestration | orchestration worker-stop | keep |  |  | src/cli/specs/orchestration-worker-specs.ts:75 |
| orchestration | orchestration worker-abandon | keep |  |  | src/cli/specs/orchestration-worker-specs.ts:86 |
| orchestration | orchestration worker-release | keep |  |  | src/cli/specs/orchestration-worker-specs.ts:94 |
| orchestration | orchestration worker-retain | keep |  |  | src/cli/specs/orchestration-worker-specs.ts:108 |
| orchestration | orchestration worker-list | keep |  |  | src/cli/specs/orchestration-worker-specs.ts:120 |
| orchestration | orchestration dispatch | keep |  |  | src/cli/specs/orchestration.ts:165 |
| orchestration | orchestration request-show | keep |  |  | src/cli/specs/orchestration.ts:182 |
| orchestration | orchestration dispatch-show | keep |  |  | src/cli/specs/orchestration.ts:193 |
| orchestration | orchestration ask | keep |  |  | src/cli/specs/orchestration.ts:200 |
| orchestration | orchestration coordinator-start | held |  |  | src/cli/specs/orchestration.ts:222 |
| orchestration | orchestration coordinator-stop | held |  |  | src/cli/specs/orchestration.ts:241 |
| orchestration | orchestration gate-create | keep |  |  | src/cli/specs/orchestration.ts:251 |
| orchestration | orchestration gate-resolve | keep |  |  | src/cli/specs/orchestration.ts:258 |
| orchestration | orchestration gate-list | keep |  |  | src/cli/specs/orchestration.ts:265 |
| orchestration | orchestration reset | keep |  |  | src/cli/specs/orchestration.ts:273 |
| computer | computer capabilities | drop |  |  | src/cli/specs/computer.ts:15 |
| computer | computer list-apps | drop |  |  | src/cli/specs/computer.ts:21 |
| computer | computer permissions | drop |  |  | src/cli/specs/computer.ts:27 |
| computer | computer list-windows | drop |  |  | src/cli/specs/computer.ts:33 |
| computer | computer get-app-state | drop |  |  | src/cli/specs/computer.ts:39 |
| computer | computer click | drop |  |  | src/cli/specs/computer.ts:46 |
| computer | computer perform-secondary-action | drop |  |  | src/cli/specs/computer.ts:61 |
| computer | computer scroll | drop |  |  | src/cli/specs/computer.ts:68 |
| computer | computer drag | drop |  |  | src/cli/specs/computer.ts:75 |
| computer | computer type-text | drop |  |  | src/cli/specs/computer.ts:90 |
| computer | computer press-key | drop |  |  | src/cli/specs/computer.ts:97 |
| computer | computer hotkey | drop |  |  | src/cli/specs/computer.ts:104 |
| computer | computer paste-text | drop |  |  | src/cli/specs/computer.ts:111 |
| computer | computer set-value | drop |  |  | src/cli/specs/computer.ts:118 |
| agent-hooks | agent hooks prepare-codex | keep (source only) |  |  | src/cli/specs/agent-hooks.ts:6 |
| agent-hooks | agent hooks status | keep (source only) |  |  | src/cli/specs/agent-hooks.ts:12 |
| agent-hooks | agent hooks off | keep (source only) |  |  | src/cli/specs/agent-hooks.ts:19 |
| agent-hooks | agent hooks on | keep (source only) |  |  | src/cli/specs/agent-hooks.ts:26 |
| diagnostics | diagnostics memory | keep |  |  | src/cli/specs/diagnostics.ts:6 |
| introspection | agent-context | keep |  |  | src/cli/specs/introspection.ts:6 |
| environment | host list | drop |  |  | src/cli/specs/environment.ts:6 |
| environment | environment add | drop |  |  | src/cli/specs/environment.ts:21 |
| environment | environment list | drop |  |  | src/cli/specs/environment.ts:28 |
| environment | environment show | drop |  |  | src/cli/specs/environment.ts:37 |
| environment | environment rm | drop |  | yes | src/cli/specs/environment.ts:43 |
| linear | linear save-issue | drop (source only) |  |  | src/cli/specs/linear-mcp.ts:6 |
| linear | linear list-issues | drop (source only) |  |  | src/cli/specs/linear-mcp.ts:43 |
| linear | linear relation add | drop (source only) |  |  | src/cli/specs/linear-mcp.ts:82 |
| linear | linear relation remove | drop (source only) |  |  | src/cli/specs/linear-mcp.ts:94 |
| linear | linear issue | drop (source only) |  |  | src/cli/specs/linear.ts:8 |
| linear | linear search | drop (source only) |  |  | src/cli/specs/linear.ts:33 |
| linear | linear team list | drop (source only) |  |  | src/cli/specs/linear.ts:41 |
| linear | linear team members | drop (source only) |  |  | src/cli/specs/linear.ts:48 |
| linear | linear team states | drop (source only) |  |  | src/cli/specs/linear.ts:55 |
| linear | linear team labels | drop (source only) |  |  | src/cli/specs/linear.ts:62 |
| linear | linear project list | drop (source only) |  |  | src/cli/specs/linear.ts:69 |
| linear | linear list | drop (source only) |  |  | src/cli/specs/linear.ts:80 |
| linear | linear status set | drop (source only) |  |  | src/cli/specs/linear.ts:88 |
| linear | linear assignee set | drop (source only) |  |  | src/cli/specs/linear.ts:99 |
| linear | linear assignee clear | drop (source only) |  |  | src/cli/specs/linear.ts:108 |
| linear | linear priority set | drop (source only) |  |  | src/cli/specs/linear.ts:116 |
| linear | linear priority clear | drop (source only) |  |  | src/cli/specs/linear.ts:125 |
| linear | linear estimate set | drop (source only) |  |  | src/cli/specs/linear.ts:133 |
| linear | linear estimate clear | drop (source only) |  |  | src/cli/specs/linear.ts:141 |
| linear | linear due-date set | drop (source only) |  |  | src/cli/specs/linear.ts:149 |
| linear | linear due-date clear | drop (source only) |  |  | src/cli/specs/linear.ts:158 |
| linear | linear label add | drop (source only) |  |  | src/cli/specs/linear.ts:166 |
| linear | linear label remove | drop (source only) |  |  | src/cli/specs/linear.ts:175 |
| linear | linear label set | drop (source only) |  |  | src/cli/specs/linear.ts:184 |
| linear | linear comment add | drop (source only) |  |  | src/cli/specs/linear.ts:193 |
| linear | linear attach | drop (source only) |  |  | src/cli/specs/linear.ts:215 |
| linear | linear create | drop (source only) |  |  | src/cli/specs/linear.ts:227 |
| vm | vm recipe doctor | drop |  |  | src/cli/specs/vm.ts:6 |
| emulator | emulator list | drop |  |  | src/cli/specs/emulator.ts:6 |
| emulator | emulator devices | drop |  |  | src/cli/specs/emulator.ts:12 |
| emulator | emulator attach | drop |  |  | src/cli/specs/emulator.ts:18 |
| emulator | emulator tap | drop |  |  | src/cli/specs/emulator.ts:25 |
| emulator | emulator type | drop |  |  | src/cli/specs/emulator.ts:32 |
| emulator | emulator gesture | drop |  |  | src/cli/specs/emulator.ts:39 |
| emulator | emulator button | drop |  |  | src/cli/specs/emulator.ts:46 |
| emulator | emulator rotate | drop |  |  | src/cli/specs/emulator.ts:53 |
| emulator | emulator exec | drop |  |  | src/cli/specs/emulator.ts:60 |
| emulator | emulator kill | drop |  |  | src/cli/specs/emulator.ts:67 |
| emulator | emulator shutdown | drop |  |  | src/cli/specs/emulator.ts:73 |
| emulator | emulator install | drop |  |  | src/cli/specs/emulator.ts:80 |
| emulator | emulator launch | drop |  |  | src/cli/specs/emulator.ts:87 |
| emulator | emulator permissions | drop |  |  | src/cli/specs/emulator.ts:94 |
| emulator | emulator ax | drop |  |  | src/cli/specs/emulator.ts:110 |
| emulator | emulator logcat | drop |  |  | src/cli/specs/emulator.ts:116 |
| skills | skills list | keep |  |  | src/cli/specs/skills.ts:6 |
| skills | skills get | keep |  |  | src/cli/specs/skills.ts:17 |
| skills | skills install | keep |  |  | src/cli/specs/skills.ts:38 |
| skills | skills update | keep |  |  | src/cli/specs/skills.ts:72 |

## 3. Hook rows (registry, with verification mark)

| Agent | Event | Status mapped | Config target | Wrapper | Verified | Evidence |
|---|---|---|---|---|---|---|
| claude | SessionStart | done | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:43; src/shared/agent-hook-listener/providers/claude-events.ts:44-72 |
| claude | UserPromptSubmit | working | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:47; src/shared/agent-hook-listener/providers/claude-events.ts:95-97,113-118 |
| claude | Stop | done | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:51; src/shared/agent-hook-listener/providers/claude-events.ts:75-89,123-125;src/shared/agent-hook-listener/providers/claude-roster-state.ts:126-146 |
| claude | StopFailure | blocked (stopReason limit\|auth\|provider-error) | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:57; src/shared/agent-hook-listener/providers/claude-events.ts:82-83,121-122;src/shared/agent-hook-listener/providers/claude-stop-failure.ts:29-65 |
| claude | SubagentStart | other (re-emits cached lead state) | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:66; src/shared/agent-hook-listener/providers/claude-events.ts:37-42;src/shared/agent-hook-listener/providers/claude-lifecycle-events.ts:20-143 |
| claude | SubagentStop | other (re-emits cached lead state) | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:70; src/shared/agent-hook-listener/providers/claude-events.ts:37-42;src/shared/agent-hook-listener/providers/claude-lifecycle-events.ts:60-108 |
| claude | TeammateIdle | other (re-emits cached lead state) | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:74; src/shared/agent-hook-listener/providers/claude-events.ts:37-42;src/shared/agent-hook-listener/providers/claude-lifecycle-events.ts:43-59 |
| claude | PreToolUse | working (waiting if AskUserQuestion/ExitPlanMode) | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:80; src/shared/agent-hook-listener/providers/claude-events.ts:102-106,113-120,163-208 |
| claude | PostToolUse | working | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:84; src/shared/agent-hook-listener/providers/claude-events.ts:113-118,149-161;src/main/agent-hooks/server/server-claude-status-rules.ts:94-138,175-191 |
| claude | PostToolUseFailure | working | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:88; src/shared/agent-hook-listener/providers/claude-events.ts:113-118;src/main/agent-hooks/server/server-constants.ts:15-19 |
| claude | PermissionRequest | waiting | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:92; src/shared/agent-hook-listener/providers/claude-events.ts:119-120;src/main/agent-hooks/server/server-claude-status-rules.ts:44-138 |
| claude | PostCompact | done (sessionBoundary) if trigger==manual else none | ~/.claude/settings.json hooks.<event> (dir via defaultClaudeConfigDir / CLAUDE_CONFIG_DIR) | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:100; src/shared/agent-hook-listener/providers/claude-events.ts:112-125,252-266,308-315;src/shared/agent-hook-listener.ts:46-75 |
| claude | PreCompact | none | NOT-INSTALLED-BY-KOLUX | claude-hook.cmd (curl.exe batch; claude-managed-hook-script.ts:63-70); settings command = direct-cmd wrapper if Git Bash else encoded PowerShell launcher (hook-settings.ts:162-201); skips when DEVIN_PROJECT_DIR set | yes | src/main/claude/hook-settings.ts:94-99; src/main/agent-hooks/server/server-ingest-remote.ts:169-173;src/shared/agent-hook-listener/providers/claude-events.ts:107-112 |
| openclaude | SessionStart | done | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:43; src/shared/agent-hook-listener/providers/claude-events.ts:44-72 |
| openclaude | UserPromptSubmit | working | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:47; src/shared/agent-hook-listener/providers/claude-events.ts:95-97,113-118 |
| openclaude | Stop | done | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:51; src/shared/agent-hook-listener/providers/claude-events.ts:75-89,123-125;src/shared/agent-hook-listener/providers/claude-roster-state.ts:126-146 |
| openclaude | StopFailure | blocked (stopReason limit\|auth\|provider-error) | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:57; src/shared/agent-hook-listener/providers/claude-events.ts:82-83,121-122;src/shared/agent-hook-listener/providers/claude-stop-failure.ts:29-65 |
| openclaude | SubagentStart | other (re-emits cached lead state) | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:66; src/shared/agent-hook-listener/providers/claude-events.ts:37-42;src/shared/agent-hook-listener/providers/claude-lifecycle-events.ts:20-143 |
| openclaude | SubagentStop | other (re-emits cached lead state) | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:70; src/shared/agent-hook-listener/providers/claude-events.ts:37-42;src/shared/agent-hook-listener/providers/claude-lifecycle-events.ts:60-108 |
| openclaude | TeammateIdle | other (re-emits cached lead state) | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:74; src/shared/agent-hook-listener/providers/claude-events.ts:37-42;src/shared/agent-hook-listener/providers/claude-lifecycle-events.ts:43-59 |
| openclaude | PreToolUse | working (waiting if AskUserQuestion/ExitPlanMode) | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:80; src/shared/agent-hook-listener/providers/claude-events.ts:102-106,113-120,163-208 |
| openclaude | PostToolUse | working | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:84; src/shared/agent-hook-listener/providers/claude-events.ts:113-118,149-161;src/main/agent-hooks/server/server-claude-status-rules.ts:94-138,175-191 |
| openclaude | PostToolUseFailure | working | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:88; src/shared/agent-hook-listener/providers/claude-events.ts:113-118;src/main/agent-hooks/server/server-constants.ts:15-19 |
| openclaude | PermissionRequest | waiting | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:92; src/shared/agent-hook-listener/providers/claude-events.ts:119-120;src/main/agent-hooks/server/server-claude-status-rules.ts:44-138 |
| openclaude | PostCompact | done (sessionBoundary) if trigger==manual else none | ~/.openclaude/settings.json hooks.<event> | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/openclaude/hook-service.ts:1-8;src/main/claude/hook-settings.ts:100; src/shared/agent-hook-listener/providers/claude-events.ts:112-125,252-266,308-315;src/shared/agent-hook-listener.ts:46-75 |
| openclaude | PreCompact | none | NOT-INSTALLED-BY-KOLUX | openclaude-hook.cmd (same getManagedScript as claude, no Devin skip); usesWindowsCompatLauncher=false so command = getManagedCommand/buildManagedCommandHook, no PowerShell launcher (hook-settings.ts:31-35,162-168) | yes | src/main/claude/hook-settings.ts:54-56,94-99; src/main/agent-hooks/server/server-ingest-remote.ts:169-173;src/shared/agent-hook-listener/providers/claude-events.ts:107-112 |
| codex | SessionStart | working | <kolux-managed codex home>/hooks.json hooks.<event> (codex-hook-definition.ts:27-29); also real ~/.codex/hooks.json (:105-107) + config.toml trust entries | codex-hook.cmd via wrapWindowsCmdHookCommand (bare path if cmd-safe else encoded wrapWindowsHookCommand) (codex-hook-definition.ts:72-76; codex-hook-identity.ts:34-36) | yes | src/main/codex/codex-hook-definition.ts:17; src/shared/agent-hook-listener/providers/codex-events.ts:117-119,147-151 |
| codex | UserPromptSubmit | working | <kolux-managed codex home>/hooks.json hooks.<event> (codex-hook-definition.ts:27-29); also real ~/.codex/hooks.json (:105-107) + config.toml trust entries | codex-hook.cmd via wrapWindowsCmdHookCommand (bare path if cmd-safe else encoded wrapWindowsHookCommand) (codex-hook-definition.ts:72-76; codex-hook-identity.ts:34-36) | yes | src/main/codex/codex-hook-definition.ts:18; src/shared/agent-hook-listener/providers/codex-events.ts:117-119 |
| codex | PreToolUse | working (waiting if request_user_input) | <kolux-managed codex home>/hooks.json hooks.<event> (codex-hook-definition.ts:27-29); also real ~/.codex/hooks.json (:105-107) + config.toml trust entries | codex-hook.cmd via wrapWindowsCmdHookCommand (bare path if cmd-safe else encoded wrapWindowsHookCommand) (codex-hook-definition.ts:72-76; codex-hook-identity.ts:34-36) | yes | src/main/codex/codex-hook-definition.ts:19; src/shared/agent-hook-listener/providers/codex-events.ts:113-127,132-145 |
| codex | PermissionRequest | waiting | <kolux-managed codex home>/hooks.json hooks.<event> (codex-hook-definition.ts:27-29); also real ~/.codex/hooks.json (:105-107) + config.toml trust entries | codex-hook.cmd via wrapWindowsCmdHookCommand (bare path if cmd-safe else encoded wrapWindowsHookCommand) (codex-hook-definition.ts:72-76; codex-hook-identity.ts:34-36) | yes | src/main/codex/codex-hook-definition.ts:20; src/shared/agent-hook-listener/providers/codex-events.ts:123-124,132-145;src/main/codex/codex-hook-definition.ts:15 |
| codex | PostToolUse | working | <kolux-managed codex home>/hooks.json hooks.<event> (codex-hook-definition.ts:27-29); also real ~/.codex/hooks.json (:105-107) + config.toml trust entries | codex-hook.cmd via wrapWindowsCmdHookCommand (bare path if cmd-safe else encoded wrapWindowsHookCommand) (codex-hook-definition.ts:72-76; codex-hook-identity.ts:34-36) | yes | src/main/codex/codex-hook-definition.ts:21; src/shared/agent-hook-listener/providers/codex-events.ts:117-122,132-145 |
| codex | SubagentStart | other (roster upsert, effective state) | <kolux-managed codex home>/hooks.json hooks.<event> (codex-hook-definition.ts:27-29); also real ~/.codex/hooks.json (:105-107) + config.toml trust entries | codex-hook.cmd via wrapWindowsCmdHookCommand (bare path if cmd-safe else encoded wrapWindowsHookCommand) (codex-hook-definition.ts:72-76; codex-hook-identity.ts:34-36) | yes | src/main/codex/codex-hook-definition.ts:22; src/shared/agent-hook-listener/providers/codex-events.ts:74-100,109-111 |
| codex | SubagentStop | other (roster finish, effective state) | <kolux-managed codex home>/hooks.json hooks.<event> (codex-hook-definition.ts:27-29); also real ~/.codex/hooks.json (:105-107) + config.toml trust entries | codex-hook.cmd via wrapWindowsCmdHookCommand (bare path if cmd-safe else encoded wrapWindowsHookCommand) (codex-hook-definition.ts:72-76; codex-hook-identity.ts:34-36) | yes | src/main/codex/codex-hook-definition.ts:23; src/shared/agent-hook-listener/providers/codex-events.ts:74-100,109-111 |
| codex | Stop | done | <kolux-managed codex home>/hooks.json hooks.<event> (codex-hook-definition.ts:27-29); also real ~/.codex/hooks.json (:105-107) + config.toml trust entries | codex-hook.cmd via wrapWindowsCmdHookCommand (bare path if cmd-safe else encoded wrapWindowsHookCommand) (codex-hook-definition.ts:72-76; codex-hook-identity.ts:34-36) | yes | src/main/codex/codex-hook-definition.ts:24; src/shared/agent-hook-listener/providers/codex-events.ts:125-126,152-178 |
| gemini | BeforeAgent | working | ~/.gemini/settings.json hooks.<event> (hook-service.ts:36-38) | gemini-hook.cmd via wrapWindowsHookCommand; script echoes {} first (hook-service.ts:40-68); timeout in ms | yes | src/main/gemini/hook-service.ts:34; src/shared/agent-hook-listener/providers/gemini-events.ts:17-23;src/shared/agent-hook-listener/provider-event-routing.ts:66-67 |
| gemini | AfterAgent | done | ~/.gemini/settings.json hooks.<event> (hook-service.ts:36-38) | gemini-hook.cmd via wrapWindowsHookCommand; script echoes {} first (hook-service.ts:40-68); timeout in ms | yes | src/main/gemini/hook-service.ts:34; src/shared/agent-hook-listener/providers/gemini-events.ts:24-25 |
| gemini | AfterTool | working | ~/.gemini/settings.json hooks.<event> (hook-service.ts:36-38) | gemini-hook.cmd via wrapWindowsHookCommand; script echoes {} first (hook-service.ts:40-68); timeout in ms | yes | src/main/gemini/hook-service.ts:34; src/shared/agent-hook-listener/providers/gemini-events.ts:17-23 |
| gemini | BeforeTool | working | ~/.gemini/settings.json hooks.<event> (hook-service.ts:36-38) | gemini-hook.cmd via wrapWindowsHookCommand; script echoes {} first (hook-service.ts:40-68); timeout in ms | yes | src/main/gemini/hook-service.ts:34; src/shared/agent-hook-listener/providers/gemini-events.ts:16-23 |
| gemini | PreToolUse | working | NOT-INSTALLED-BY-KOLUX | gemini-hook.cmd via wrapWindowsHookCommand; script echoes {} first (hook-service.ts:40-68); timeout in ms | yes | src/main/gemini/hook-service.ts:33,172-176; src/shared/agent-hook-listener/providers/gemini-events.ts:16,21 |
| gemini | PostToolUse | working | NOT-INSTALLED-BY-KOLUX | gemini-hook.cmd via wrapWindowsHookCommand; script echoes {} first (hook-service.ts:40-68); timeout in ms | yes | src/main/gemini/hook-service.ts:34; src/shared/agent-hook-listener/providers/gemini-events.ts:16,22 |
| antigravity | PreInvocation | working | ~/.gemini/config/hooks.json under top-level bundle key \"kolux-status\" (hook-service.ts:36-38; hook-events.ts:1) | antigravity-pre-invocation.cmd + antigravity-hook.cmd; wrapWindowsCmdHookCommand per-event wrapper (hook-service.ts:62-65,157-166) | registry | src/main/antigravity/hook-events.ts:5; src/shared/agent-hook-listener/providers/antigravity-events.ts:25-26,45-49 |
| antigravity | PostInvocation | working | ~/.gemini/config/hooks.json under top-level bundle key \"kolux-status\" (hook-service.ts:36-38; hook-events.ts:1) | antigravity-post-invocation.cmd + antigravity-hook.cmd; wrapWindowsCmdHookCommand per-event wrapper (hook-service.ts:62-65,157-166) | registry | src/main/antigravity/hook-events.ts:10; src/shared/agent-hook-listener/providers/antigravity-events.ts:27-34,45-49 |
| antigravity | Stop | done (working if fullyIdle===false) | ~/.gemini/config/hooks.json under top-level bundle key \"kolux-status\" (hook-service.ts:36-38; hook-events.ts:1) | antigravity-stop.cmd + antigravity-hook.cmd; wrapWindowsCmdHookCommand per-event wrapper (hook-service.ts:62-65,157-166) | registry | src/main/antigravity/hook-events.ts:14; src/shared/agent-hook-listener/providers/antigravity-events.ts:37-44,80-83;src/shared/agent-hook-listener/providers/antigravity-event-rules.ts:3-5 |
| antigravity | PreToolUse | working (waiting if ask_question/ask_permission) | ~/.gemini/config/hooks.json under top-level bundle key \"kolux-status\" (hook-service.ts:36-38; hook-events.ts:1) | antigravity-pre-tool-use.cmd + antigravity-hook.cmd; wrapWindowsCmdHookCommand per-event wrapper (hook-service.ts:62-65,157-166) | registry | src/main/antigravity/hook-events.ts:17; src/shared/agent-hook-listener/providers/antigravity-events.ts:13-15,38-40 |
| antigravity | PostToolUse | working | ~/.gemini/config/hooks.json under top-level bundle key \"kolux-status\" (hook-service.ts:36-38; hook-events.ts:1) | antigravity-post-tool-use.cmd + antigravity-hook.cmd; wrapWindowsCmdHookCommand per-event wrapper (hook-service.ts:62-65,157-166) | registry | src/main/antigravity/hook-events.ts:22; src/shared/agent-hook-listener/providers/antigravity-events.ts:27-34,45-49 |
| amp | session.start | none | ~/.config/amp/plugins/kolux-agent-status.ts plugin (managed-plugin-install-status.ts:14-16; plugin-source.ts:1) | none (TypeScript plugin; POSTs via fetch to http://127.0.0.1:<port>/hook/amp, agent-status-plugin-source.ts:99) | registry | src/main/amp/agent-status-plugin-source.ts:156; src/shared/agent-hook-listener/providers/amp-events.ts:20-26 |
| amp | agent.start | working | ~/.config/amp/plugins/kolux-agent-status.ts plugin (managed-plugin-install-status.ts:14-16; plugin-source.ts:1) | none (TypeScript plugin; POSTs via fetch to http://127.0.0.1:<port>/hook/amp, agent-status-plugin-source.ts:99) | registry | src/main/amp/agent-status-plugin-source.ts:160; src/shared/agent-hook-listener/providers/amp-events.ts:28-39,65-68 |
| amp | tool.call | working | ~/.config/amp/plugins/kolux-agent-status.ts plugin (managed-plugin-install-status.ts:14-16; plugin-source.ts:1) | none (TypeScript plugin; POSTs via fetch to http://127.0.0.1:<port>/hook/amp, agent-status-plugin-source.ts:99) | registry | src/main/amp/agent-status-plugin-source.ts:168-176; src/shared/agent-hook-listener/providers/amp-events.ts:28-47 |
| amp | tool.result | working | ~/.config/amp/plugins/kolux-agent-status.ts plugin (managed-plugin-install-status.ts:14-16; plugin-source.ts:1) | none (TypeScript plugin; POSTs via fetch to http://127.0.0.1:<port>/hook/amp, agent-status-plugin-source.ts:99) | registry | src/main/amp/agent-status-plugin-source.ts:178-188; src/shared/agent-hook-listener/providers/amp-events.ts:28-47 |
| amp | agent.end | done (interrupted if status==cancelled) | ~/.config/amp/plugins/kolux-agent-status.ts plugin (managed-plugin-install-status.ts:14-16; plugin-source.ts:1) | none (TypeScript plugin; POSTs via fetch to http://127.0.0.1:<port>/hook/amp, agent-status-plugin-source.ts:99) | registry | src/main/amp/agent-status-plugin-source.ts:190-196; src/shared/agent-hook-listener/providers/amp-events.ts:31-32,55-56,84-86 |
| cursor | beforeSubmitPrompt | working | ~/.cursor/hooks.json hooks.<event> (cursor/hook-service.ts:24-26) | cursor-hook.cmd via wrapWindowsHookCommand with env KOLUX_CURSOR_HOOK_RESPONSE + fallbackStdout (cursor/hook-script.ts:14,25-33; hook-service.ts:28-30) | yes | src/main/cursor/hook-events.ts:4; src/shared/agent-hook-listener/providers/cursor-events.ts:19,40-45;src/main/cursor/hook-events.ts:17 |
| cursor | stop | done (interrupted if status!=completed) | ~/.cursor/hooks.json hooks.<event> (cursor/hook-service.ts:24-26) | cursor-hook.cmd via wrapWindowsHookCommand with env KOLUX_CURSOR_HOOK_RESPONSE + fallbackStdout (cursor/hook-script.ts:14,25-33; hook-service.ts:28-30) | yes | src/main/cursor/hook-events.ts:5; src/shared/agent-hook-listener/providers/cursor-events.ts:32-33,47-52 |
| cursor | preToolUse | working | ~/.cursor/hooks.json hooks.<event> (cursor/hook-service.ts:24-26) | cursor-hook.cmd via wrapWindowsHookCommand with env KOLUX_CURSOR_HOOK_RESPONSE + fallbackStdout (cursor/hook-script.ts:14,25-33; hook-service.ts:28-30) | yes | src/main/cursor/hook-events.ts:6; src/shared/agent-hook-listener/providers/cursor-events.ts:19-27;src/main/cursor/hook-events.ts:19 |
| cursor | postToolUse | working | ~/.cursor/hooks.json hooks.<event> (cursor/hook-service.ts:24-26) | cursor-hook.cmd via wrapWindowsHookCommand with env KOLUX_CURSOR_HOOK_RESPONSE + fallbackStdout (cursor/hook-script.ts:14,25-33; hook-service.ts:28-30) | yes | src/main/cursor/hook-events.ts:7; src/shared/agent-hook-listener/providers/cursor-events.ts:19-27 |
| cursor | postToolUseFailure | working | ~/.cursor/hooks.json hooks.<event> (cursor/hook-service.ts:24-26) | cursor-hook.cmd via wrapWindowsHookCommand with env KOLUX_CURSOR_HOOK_RESPONSE + fallbackStdout (cursor/hook-script.ts:14,25-33; hook-service.ts:28-30) | yes | src/main/cursor/hook-events.ts:8; src/shared/agent-hook-listener/providers/cursor-events.ts:19-27 |
| cursor | beforeShellExecution | working | ~/.cursor/hooks.json hooks.<event> (cursor/hook-service.ts:24-26) | cursor-hook.cmd via wrapWindowsHookCommand with env KOLUX_CURSOR_HOOK_RESPONSE + fallbackStdout (cursor/hook-script.ts:14,25-33; hook-service.ts:28-30) | yes | src/main/cursor/hook-events.ts:9; src/shared/agent-hook-listener/providers/cursor-events.ts:24-27 |
| cursor | beforeMCPExecution | working | ~/.cursor/hooks.json hooks.<event> (cursor/hook-service.ts:24-26) | cursor-hook.cmd via wrapWindowsHookCommand with env KOLUX_CURSOR_HOOK_RESPONSE + fallbackStdout (cursor/hook-script.ts:14,25-33; hook-service.ts:28-30) | yes | src/main/cursor/hook-events.ts:10; src/shared/agent-hook-listener/providers/cursor-events.ts:24-27 |
| cursor | afterAgentResponse | done if previous cursor status done else working | ~/.cursor/hooks.json hooks.<event> (cursor/hook-service.ts:24-26) | cursor-hook.cmd via wrapWindowsHookCommand with env KOLUX_CURSOR_HOOK_RESPONSE + fallbackStdout (cursor/hook-script.ts:14,25-33; hook-service.ts:28-30) | yes | src/main/cursor/hook-events.ts:11; src/shared/agent-hook-listener/providers/cursor-events.ts:16-17,28-31 |
| cursor | sessionStart | working | NOT-INSTALLED-BY-KOLUX | cursor-hook.cmd via wrapWindowsHookCommand with env KOLUX_CURSOR_HOOK_RESPONSE + fallbackStdout (cursor/hook-script.ts:14,25-33; hook-service.ts:28-30) | yes | src/main/cursor/hook-events.ts:1-2; src/shared/agent-hook-listener/providers/cursor-events.ts:20 |
| cursor | sessionEnd | done | NOT-INSTALLED-BY-KOLUX | cursor-hook.cmd via wrapWindowsHookCommand with env KOLUX_CURSOR_HOOK_RESPONSE + fallbackStdout (cursor/hook-script.ts:14,25-33; hook-service.ts:28-30) | yes | src/main/cursor/hook-events.ts:1-2; src/shared/agent-hook-listener/providers/cursor-events.ts:32-33 |
| droid | SessionStart | none | ~/.factory/settings.json hooks.<event> (hook-service.ts:60-62) | droid-hook.cmd via wrapWindowsHookCommand (hook-service.ts:65,72-78) | registry | src/main/droid/hook-service.ts:37; src/shared/agent-hook-listener/providers/droid-events.ts:23-27 |
| droid | UserPromptSubmit | working | ~/.factory/settings.json hooks.<event> (hook-service.ts:60-62) | droid-hook.cmd via wrapWindowsHookCommand (hook-service.ts:65,72-78) | registry | src/main/droid/hook-service.ts:38; src/shared/agent-hook-listener/providers/droid-events.ts:38-43 |
| droid | Stop | done | ~/.factory/settings.json hooks.<event> (hook-service.ts:60-62) | droid-hook.cmd via wrapWindowsHookCommand (hook-service.ts:65,72-78) | registry | src/main/droid/hook-service.ts:39; src/shared/agent-hook-listener/providers/droid-events.ts:44-45 |
| droid | SubagentStop | none | ~/.factory/settings.json hooks.<event> (hook-service.ts:60-62) | droid-hook.cmd via wrapWindowsHookCommand (hook-service.ts:65,72-78) | registry | src/main/droid/hook-service.ts:42; src/shared/agent-hook-listener/providers/droid-events.ts:32-56;src/main/droid/hook-service.ts:40-41 |
| droid | PreToolUse | working (waiting if AskUser/high risk) | ~/.factory/settings.json hooks.<event> (hook-service.ts:60-62) | droid-hook.cmd via wrapWindowsHookCommand (hook-service.ts:65,72-78) | registry | src/main/droid/hook-service.ts:44; src/shared/agent-hook-listener/providers/droid-events.ts:30-43 |
| droid | PostToolUse | working | ~/.factory/settings.json hooks.<event> (hook-service.ts:60-62) | droid-hook.cmd via wrapWindowsHookCommand (hook-service.ts:65,72-78) | registry | src/main/droid/hook-service.ts:48; src/shared/agent-hook-listener/providers/droid-events.ts:38-43 |
| droid | PermissionRequest | waiting | ~/.factory/settings.json hooks.<event> (hook-service.ts:60-62) | droid-hook.cmd via wrapWindowsHookCommand (hook-service.ts:65,72-78) | registry | src/main/droid/hook-service.ts:54; src/shared/agent-hook-listener/providers/droid-events.ts:46-47 |
| droid | Notification | waiting\|done\|none by message | ~/.factory/settings.json hooks.<event> (hook-service.ts:60-62) | droid-hook.cmd via wrapWindowsHookCommand (hook-service.ts:65,72-78) | registry | src/main/droid/hook-service.ts:57; src/shared/agent-hook-listener/providers/droid-events.ts:29,48-52;src/shared/agent-hook-listener/providers/droid-tool-fields.ts:11-26 |
| command-code | PreToolUse | working | ~/.commandcode/settings.json hooks.<event> (hook-service.ts:37-39) | command-code-hook.cmd via wrapWindowsHookCommand (hook-service.ts:42,49-52); managed script command-code-managed-script.ts | registry | src/main/command-code/hook-service.ts:27; src/shared/agent-hook-listener/providers/command-code-events.ts:16-18 |
| command-code | PostToolUse | working | ~/.commandcode/settings.json hooks.<event> (hook-service.ts:37-39) | command-code-hook.cmd via wrapWindowsHookCommand (hook-service.ts:42,49-52); managed script command-code-managed-script.ts | registry | src/main/command-code/hook-service.ts:31; src/shared/agent-hook-listener/providers/command-code-events.ts:16-18 |
| command-code | Stop | done | ~/.commandcode/settings.json hooks.<event> (hook-service.ts:37-39) | command-code-hook.cmd via wrapWindowsHookCommand (hook-service.ts:42,49-52); managed script command-code-managed-script.ts | registry | src/main/command-code/hook-service.ts:34; src/shared/agent-hook-listener/providers/command-code-events.ts:19-20 |
| grok | SessionStart | none | $GROK_HOME/hooks/kolux-status.json hooks.<event> (grok-hook-config-file.ts:46-50) | grok-hook.cmd (windows-grok-hook-script.ts) via wrapWindowsCmdHookCommand (grok-hook-script.ts:16,26-27) | registry | src/main/grok/grok-hook-config.ts:12; src/shared/agent-hook-listener/providers/grok-events.ts:29-33 |
| grok | UserPromptSubmit | working | $GROK_HOME/hooks/kolux-status.json hooks.<event> (grok-hook-config-file.ts:46-50) | grok-hook.cmd (windows-grok-hook-script.ts) via wrapWindowsCmdHookCommand (grok-hook-script.ts:16,26-27) | registry | src/main/grok/grok-hook-config.ts:13; src/shared/agent-hook-listener/providers/grok-events.ts:47-51,88-91 |
| grok | Stop | done | $GROK_HOME/hooks/kolux-status.json hooks.<event> (grok-hook-config-file.ts:46-50) | grok-hook.cmd (windows-grok-hook-script.ts) via wrapWindowsCmdHookCommand (grok-hook-script.ts:16,26-27) | registry | src/main/grok/grok-hook-config.ts:14; src/shared/agent-hook-listener/providers/grok-events.ts:54-55 |
| grok | StopFailure | done | $GROK_HOME/hooks/kolux-status.json hooks.<event> (grok-hook-config-file.ts:46-50) | grok-hook.cmd (windows-grok-hook-script.ts) via wrapWindowsCmdHookCommand (grok-hook-script.ts:16,26-27) | registry | src/main/grok/grok-hook-config.ts:15; src/shared/agent-hook-listener/providers/grok-events.ts:54-55 |
| grok | SessionEnd | done | $GROK_HOME/hooks/kolux-status.json hooks.<event> (grok-hook-config-file.ts:46-50) | grok-hook.cmd (windows-grok-hook-script.ts) via wrapWindowsCmdHookCommand (grok-hook-script.ts:16,26-27) | registry | src/main/grok/grok-hook-config.ts:16; src/shared/agent-hook-listener/providers/grok-events.ts:54-55 |
| grok | PreToolUse | working (waiting if ask_user_question) | $GROK_HOME/hooks/kolux-status.json hooks.<event> (grok-hook-config-file.ts:46-50) | grok-hook.cmd (windows-grok-hook-script.ts) via wrapWindowsCmdHookCommand (grok-hook-script.ts:16,26-27) | registry | src/main/grok/grok-hook-config.ts:20; src/shared/agent-hook-listener/providers/grok-events.ts:38-44,47-53 |
| grok | PostToolUse | working | $GROK_HOME/hooks/kolux-status.json hooks.<event> (grok-hook-config-file.ts:46-50) | grok-hook.cmd (windows-grok-hook-script.ts) via wrapWindowsCmdHookCommand (grok-hook-script.ts:16,26-27) | registry | src/main/grok/grok-hook-config.ts:24; src/shared/agent-hook-listener/providers/grok-events.ts:47-51 |
| grok | PostToolUseFailure | working | $GROK_HOME/hooks/kolux-status.json hooks.<event> (grok-hook-config-file.ts:46-50) | grok-hook.cmd (windows-grok-hook-script.ts) via wrapWindowsCmdHookCommand (grok-hook-script.ts:16,26-27) | registry | src/main/grok/grok-hook-config.ts:28; src/shared/agent-hook-listener/providers/grok-events.ts:47-51 |
| grok | Notification | waiting\|done\|none by message | $GROK_HOME/hooks/kolux-status.json hooks.<event> (grok-hook-config-file.ts:46-50) | grok-hook.cmd (windows-grok-hook-script.ts) via wrapWindowsCmdHookCommand (grok-hook-script.ts:16,26-27) | registry | src/main/grok/grok-hook-config.ts:31; src/shared/agent-hook-listener/providers/grok-events.ts:56-75;src/shared/agent-hook-listener/providers/grok-tool-fields.ts:91-129;src/shared/agent-hook-listener/provider-event-routing.ts:39-50 |
| copilot | SessionStart | working | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:11; src/shared/agent-hook-listener/providers/copilot-events.ts:34-39 |
| copilot | SessionEnd | done | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:12; src/shared/agent-hook-listener/providers/copilot-events.ts:44-45 |
| copilot | UserPromptSubmit | working | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:13; src/shared/agent-hook-listener/providers/copilot-events.ts:34-39 |
| copilot | PreToolUse | working (blocked if ask_user tool) | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:14; src/shared/agent-hook-listener/providers/copilot-events.ts:31-33,40-43 |
| copilot | PostToolUse | working | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:15; src/shared/agent-hook-listener/providers/copilot-events.ts:34-39 |
| copilot | PostToolUseFailure | working | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:16; src/shared/agent-hook-listener/providers/copilot-events.ts:34-39 |
| copilot | subagentStart | none | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:20; src/shared/agent-hook-listener/providers/copilot-events.ts:23-24,34-50;src/shared/agent-hook-listener/providers/copilot-tool-fields.ts:28 |
| copilot | SubagentStop | none | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:21; src/shared/agent-hook-listener/providers/copilot-events.ts:34-50 |
| copilot | PreCompact | none | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:22; src/shared/agent-hook-listener/providers/copilot-events.ts:34-50 |
| copilot | Stop | done | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:23; src/shared/agent-hook-listener/providers/copilot-events.ts:44-45;src/shared/agent-hook-listener/providers/copilot-tool-fields.ts:31-32 |
| copilot | ErrorOccurred | working\|done by recoverable | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:24; src/shared/agent-hook-listener/providers/copilot-events.ts:46-49 |
| copilot | PermissionRequest | working (blocked if ask_user tool) | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:25; src/shared/agent-hook-listener/providers/copilot-events.ts:15,40-43 |
| copilot | Notification | blocked or none | $COPILOT_HOME\|~/.copilot/hooks/kolux.json hooks.<event>, command in powershell (win) / bash slot, timeoutSec 5 (hook-service.ts:30-35; definitions.ts:36-40) | copilot-hook.ps1 (copilot-managed-script.ts:9); powershell slot via wrapWindowsHookCommand with env KOLUX_COPILOT_HOOK_EVENT (definitions.ts:29-34) | registry | src/main/copilot/copilot-managed-hook-definitions.ts:26; src/shared/agent-hook-listener/providers/copilot-events.ts:26-29,34-40 |
| hermes | on_session_start | working | $HERMES_HOME/plugins/kolux-status plugin + config.yaml plugins.enabled (hermes-home-filesystem.ts:24,33; hermes-config-yaml.ts:59) | none (Python plugin; no Windows script wrapper found) | registry | src/main/hermes/hermes-managed-plugin-source.ts:5; src/shared/agent-hook-listener/providers/hermes-events.ts:24-29 |
| hermes | pre_llm_call | working | $HERMES_HOME/plugins/kolux-status plugin + config.yaml plugins.enabled (hermes-home-filesystem.ts:24,33; hermes-config-yaml.ts:59) | none (Python plugin; no Windows script wrapper found) | registry | src/main/hermes/hermes-managed-plugin-source.ts:6; src/shared/agent-hook-listener/providers/hermes-events.ts:24-29 |
| hermes | post_llm_call | done | $HERMES_HOME/plugins/kolux-status plugin + config.yaml plugins.enabled (hermes-home-filesystem.ts:24,33; hermes-config-yaml.ts:59) | none (Python plugin; no Windows script wrapper found) | registry | src/main/hermes/hermes-managed-plugin-source.ts:7; src/shared/agent-hook-listener/providers/hermes-events.ts:19-23 |
| hermes | pre_tool_call | working | $HERMES_HOME/plugins/kolux-status plugin + config.yaml plugins.enabled (hermes-home-filesystem.ts:24,33; hermes-config-yaml.ts:59) | none (Python plugin; no Windows script wrapper found) | registry | src/main/hermes/hermes-managed-plugin-source.ts:8; src/shared/agent-hook-listener/providers/hermes-events.ts:24-29 |
| hermes | post_tool_call | working | $HERMES_HOME/plugins/kolux-status plugin + config.yaml plugins.enabled (hermes-home-filesystem.ts:24,33; hermes-config-yaml.ts:59) | none (Python plugin; no Windows script wrapper found) | registry | src/main/hermes/hermes-managed-plugin-source.ts:9; src/shared/agent-hook-listener/providers/hermes-events.ts:24-29 |
| hermes | pre_approval_request | waiting | $HERMES_HOME/plugins/kolux-status plugin + config.yaml plugins.enabled (hermes-home-filesystem.ts:24,33; hermes-config-yaml.ts:59) | none (Python plugin; no Windows script wrapper found) | registry | src/main/hermes/hermes-managed-plugin-source.ts:10; src/shared/agent-hook-listener/providers/hermes-events.ts:17-18 |
| hermes | post_approval_response | working | $HERMES_HOME/plugins/kolux-status plugin + config.yaml plugins.enabled (hermes-home-filesystem.ts:24,33; hermes-config-yaml.ts:59) | none (Python plugin; no Windows script wrapper found) | registry | src/main/hermes/hermes-managed-plugin-source.ts:11; src/shared/agent-hook-listener/providers/hermes-events.ts:24-29 |
| hermes | on_session_end | done | $HERMES_HOME/plugins/kolux-status plugin + config.yaml plugins.enabled (hermes-home-filesystem.ts:24,33; hermes-config-yaml.ts:59) | none (Python plugin; no Windows script wrapper found) | registry | src/main/hermes/hermes-managed-plugin-source.ts:12; src/shared/agent-hook-listener/providers/hermes-events.ts:19-23 |
| hermes | on_session_finalize | done | $HERMES_HOME/plugins/kolux-status plugin + config.yaml plugins.enabled (hermes-home-filesystem.ts:24,33; hermes-config-yaml.ts:59) | none (Python plugin; no Windows script wrapper found) | registry | src/main/hermes/hermes-managed-plugin-source.ts:13; src/shared/agent-hook-listener/providers/hermes-events.ts:19-23 |
| hermes | on_session_reset | done | $HERMES_HOME/plugins/kolux-status plugin + config.yaml plugins.enabled (hermes-home-filesystem.ts:24,33; hermes-config-yaml.ts:59) | none (Python plugin; no Windows script wrapper found) | registry | src/main/hermes/hermes-managed-plugin-source.ts:14; src/shared/agent-hook-listener/providers/hermes-events.ts:19-23 |
| devin | SessionStart | none | %APPDATA%\\devin\\config.json (win) / ~/.config/devin/config.json hooks.<event> (hook-settings.ts:29-35) | devin-hook.cmd via wrapWindowsCmdHookCommand (hook-settings.ts:37-39,53-61) | registry | src/main/devin/hook-settings.ts:17; src/shared/agent-hook-listener/providers/devin-events.ts:17-21 |
| devin | UserPromptSubmit | working | %APPDATA%\\devin\\config.json (win) / ~/.config/devin/config.json hooks.<event> (hook-settings.ts:29-35) | devin-hook.cmd via wrapWindowsCmdHookCommand (hook-settings.ts:37-39,53-61) | registry | src/main/devin/hook-settings.ts:18; src/shared/agent-hook-listener/providers/devin-events.ts:23-28 |
| devin | Stop | done (interrupted if is_interrupt) | %APPDATA%\\devin\\config.json (win) / ~/.config/devin/config.json hooks.<event> (hook-settings.ts:29-35) | devin-hook.cmd via wrapWindowsCmdHookCommand (hook-settings.ts:37-39,53-61) | registry | src/main/devin/hook-settings.ts:19; src/shared/agent-hook-listener/providers/devin-events.ts:31-32,46-47 |
| devin | PostCompaction | working | %APPDATA%\\devin\\config.json (win) / ~/.config/devin/config.json hooks.<event> (hook-settings.ts:29-35) | devin-hook.cmd via wrapWindowsCmdHookCommand (hook-settings.ts:37-39,53-61) | registry | src/main/devin/hook-settings.ts:20; src/shared/agent-hook-listener/providers/devin-events.ts:27-28 |
| devin | SessionEnd | done | %APPDATA%\\devin\\config.json (win) / ~/.config/devin/config.json hooks.<event> (hook-settings.ts:29-35) | devin-hook.cmd via wrapWindowsCmdHookCommand (hook-settings.ts:37-39,53-61) | registry | src/main/devin/hook-settings.ts:21; src/shared/agent-hook-listener/providers/devin-events.ts:31-32 |
| devin | PreToolUse | working | %APPDATA%\\devin\\config.json (win) / ~/.config/devin/config.json hooks.<event> (hook-settings.ts:29-35) | devin-hook.cmd via wrapWindowsCmdHookCommand (hook-settings.ts:37-39,53-61) | registry | src/main/devin/hook-settings.ts:24; src/shared/agent-hook-listener/providers/devin-events.ts:23-28 |
| devin | PostToolUse | working | %APPDATA%\\devin\\config.json (win) / ~/.config/devin/config.json hooks.<event> (hook-settings.ts:29-35) | devin-hook.cmd via wrapWindowsCmdHookCommand (hook-settings.ts:37-39,53-61) | registry | src/main/devin/hook-settings.ts:25; src/shared/agent-hook-listener/providers/devin-events.ts:23-28 |
| devin | PermissionRequest | waiting | %APPDATA%\\devin\\config.json (win) / ~/.config/devin/config.json hooks.<event> (hook-settings.ts:29-35) | devin-hook.cmd via wrapWindowsCmdHookCommand (hook-settings.ts:37-39,53-61) | registry | src/main/devin/hook-settings.ts:26; src/shared/agent-hook-listener/providers/devin-events.ts:29-30 |
| kimi | UserPromptSubmit | working | $KIMI_CODE_HOME\|~/.kimi-code/config.toml marker-delimited [[hooks]] block (kimi/hook-service.ts:41-46; kimi-hook-config-toml.ts:1-7,25-26) | none .cmd: kimi-hook.sh run by Git Bash with forward-slash path via wrapPosixHookCommand (kimi/hook-service.ts:48-60) | registry | src/main/kimi/kimi-hook-config-toml.ts:16; src/shared/agent-hook-listener/providers/kimi-events.ts:28-30,42-48 |
| kimi | PreToolUse | working (waiting if AskUserQuestion) | $KIMI_CODE_HOME\|~/.kimi-code/config.toml marker-delimited [[hooks]] block (kimi/hook-service.ts:41-46; kimi-hook-config-toml.ts:1-7,25-26) | none .cmd: kimi-hook.sh run by Git Bash with forward-slash path via wrapPosixHookCommand (kimi/hook-service.ts:48-60) | registry | src/main/kimi/kimi-hook-config-toml.ts:17; src/shared/agent-hook-listener/providers/kimi-events.ts:15-18,32-33,42-50 |
| kimi | PostToolUse | working | $KIMI_CODE_HOME\|~/.kimi-code/config.toml marker-delimited [[hooks]] block (kimi/hook-service.ts:41-46; kimi-hook-config-toml.ts:1-7,25-26) | none .cmd: kimi-hook.sh run by Git Bash with forward-slash path via wrapPosixHookCommand (kimi/hook-service.ts:48-60) | registry | src/main/kimi/kimi-hook-config-toml.ts:18; src/shared/agent-hook-listener/providers/kimi-events.ts:42-48 |
| kimi | PostToolUseFailure | working | $KIMI_CODE_HOME\|~/.kimi-code/config.toml marker-delimited [[hooks]] block (kimi/hook-service.ts:41-46; kimi-hook-config-toml.ts:1-7,25-26) | none .cmd: kimi-hook.sh run by Git Bash with forward-slash path via wrapPosixHookCommand (kimi/hook-service.ts:48-60) | registry | src/main/kimi/kimi-hook-config-toml.ts:19; src/shared/agent-hook-listener/providers/kimi-events.ts:42-48 |
| kimi | PermissionRequest | waiting | $KIMI_CODE_HOME\|~/.kimi-code/config.toml marker-delimited [[hooks]] block (kimi/hook-service.ts:41-46; kimi-hook-config-toml.ts:1-7,25-26) | none .cmd: kimi-hook.sh run by Git Bash with forward-slash path via wrapPosixHookCommand (kimi/hook-service.ts:48-60) | registry | src/main/kimi/kimi-hook-config-toml.ts:20; src/shared/agent-hook-listener/providers/kimi-events.ts:49-50 |
| kimi | Stop | done (interrupted if is_interrupt) | $KIMI_CODE_HOME\|~/.kimi-code/config.toml marker-delimited [[hooks]] block (kimi/hook-service.ts:41-46; kimi-hook-config-toml.ts:1-7,25-26) | none .cmd: kimi-hook.sh run by Git Bash with forward-slash path via wrapPosixHookCommand (kimi/hook-service.ts:48-60) | registry | src/main/kimi/kimi-hook-config-toml.ts:21; src/shared/agent-hook-listener/providers/kimi-events.ts:53-54,68-69 |
| kimi | StopFailure | blocked (stopReason) or done | $KIMI_CODE_HOME\|~/.kimi-code/config.toml marker-delimited [[hooks]] block (kimi/hook-service.ts:41-46; kimi-hook-config-toml.ts:1-7,25-26) | none .cmd: kimi-hook.sh run by Git Bash with forward-slash path via wrapPosixHookCommand (kimi/hook-service.ts:48-60) | registry | src/main/kimi/kimi-hook-config-toml.ts:22; src/shared/agent-hook-listener/providers/kimi-events.ts:35-39,51-54,82-83;src/shared/agent-hook-listener/providers/claude-stop-failure.ts:49-65 |
| mimo-code | SessionBusy | working | <userData>/mimocode-hooks/shared/config/plugins/kolux-mimocode-status.js via MIMOCODE_HOME PTY env overlay (mimo/hook-service.ts:8,12,58-82); NOT in AGENT_HOOK_TARGETS | none (JS plugin POSTs to /hook/mimo-code; emitSessionStart:false) (mimo/hook-service.ts:80-82) | registry | src/main/mimo/status-plugin/status-plugin-delivery-source.ts:113; src/shared/agent-hook-listener/providers/mimo-code-events.ts:20-22 |
| mimo-code | SessionIdle | done | <userData>/mimocode-hooks/shared/config/plugins/kolux-mimocode-status.js via MIMOCODE_HOME PTY env overlay (mimo/hook-service.ts:8,12,58-82); NOT in AGENT_HOOK_TARGETS | none (JS plugin POSTs to /hook/mimo-code; emitSessionStart:false) (mimo/hook-service.ts:80-82) | registry | src/main/mimo/status-plugin/status-plugin-delivery-source.ts:113;src/main/mimo/status-plugin/status-plugin-lifecycle-source.ts:111-124; src/shared/agent-hook-listener/providers/mimo-code-events.ts:23-24 |
| mimo-code | MessagePart | working | <userData>/mimocode-hooks/shared/config/plugins/kolux-mimocode-status.js via MIMOCODE_HOME PTY env overlay (mimo/hook-service.ts:8,12,58-82); NOT in AGENT_HOOK_TARGETS | none (JS plugin POSTs to /hook/mimo-code; emitSessionStart:false) (mimo/hook-service.ts:80-82) | registry | src/main/mimo/status-plugin/status-plugin-message-preview-source.ts:10; src/shared/agent-hook-listener/providers/mimo-code-events.ts:17-21;src/shared/agent-hook-listener/provider-event-routing.ts:121-123 |
| mimo-code | PermissionRequest | waiting | <userData>/mimocode-hooks/shared/config/plugins/kolux-mimocode-status.js via MIMOCODE_HOME PTY env overlay (mimo/hook-service.ts:8,12,58-82); NOT in AGENT_HOOK_TARGETS | none (JS plugin POSTs to /hook/mimo-code; emitSessionStart:false) (mimo/hook-service.ts:80-82) | registry | src/main/mimo/status-plugin/status-plugin-lifecycle-source.ts:81-86; src/shared/agent-hook-listener/providers/mimo-code-events.ts:25-26 |
| mimo-code | AskUserQuestion | waiting | <userData>/mimocode-hooks/shared/config/plugins/kolux-mimocode-status.js via MIMOCODE_HOME PTY env overlay (mimo/hook-service.ts:8,12,58-82); NOT in AGENT_HOOK_TARGETS | none (JS plugin POSTs to /hook/mimo-code; emitSessionStart:false) (mimo/hook-service.ts:80-82) | registry | src/main/mimo/status-plugin/status-plugin-lifecycle-source.ts:81-86; src/shared/agent-hook-listener/providers/mimo-code-events.ts:25-26 |

## 4. Keybinding rows

| Id | Scope | Conflict group | Win32 | Darwin | Unbound | Evidence |
|---|---|---|---|---|---|---|
| worktree.quickOpen | global |  | Mod+P | Mod+P | no | src/shared/keybindings/definitions-core-1.ts:8 |
| app.settings | global | menu | Mod+Comma | Mod+Comma | no | src/shared/keybindings/definitions-core-1.ts:16 |
| app.forceReload | global | menu | Mod+Shift+R | Mod+Shift+R | no | src/shared/keybindings/definitions-core-1.ts:25 |
| worktree.palette | global |  | Mod+Shift+J | Mod+J | no | src/shared/keybindings/definitions-core-1.ts:34 |
| worktree.navigateUp | global |  | Mod+Shift+ArrowUp | Mod+Shift+ArrowUp | no | src/shared/keybindings/definitions-core-1.ts:46 |
| worktree.navigateDown | global |  | Mod+Shift+ArrowDown | Mod+Shift+ArrowDown | no | src/shared/keybindings/definitions-core-1.ts:54 |
| workspace.create | global |  | Mod+N \| Mod+Shift+N | Mod+N \| Mod+Shift+N | no | src/shared/keybindings/definitions-core-1.ts:62 |
| workspace.rename | global | workspace-shell |  | Mod+Alt+R | no | src/shared/keybindings/definitions-core-1.ts:70 |
| workspace.delete | global |  | Mod+Shift+Backspace | Mod+Shift+Backspace | no | src/shared/keybindings/definitions-core-1.ts:84 |
| workspace.openBoard | global |  |  |  | yes | src/shared/keybindings/definitions-core-1.ts:103 |
| dashboard.toggle | global |  |  |  | yes | src/shared/keybindings/definitions-core-1.ts:123 |
| workspace.selectByIndex | global |  | Mod+1 | Mod+1 | no | src/shared/keybindings/definitions-core-1.ts:145 |
| view.tasks | global |  |  |  | yes | src/shared/keybindings/definitions-core-1.ts:165 |
| sidebar.left.toggle | global |  | Mod+B | Mod+B | no | src/shared/keybindings/definitions-core-1.ts:173 |
| sidebar.right.toggle | global |  | Mod+L | Mod+L | no | src/shared/keybindings/definitions-core-1.ts:181 |
| sidebar.explorer.toggle | global |  | Mod+Shift+E | Mod+Shift+E | no | src/shared/keybindings/definitions-core-1.ts:189 |
| sidebar.search.toggle | global |  | Mod+Shift+F | Mod+Shift+F | no | src/shared/keybindings/definitions-core-1.ts:197 |
| sidebar.sourceControl.toggle | global |  | Mod+Shift+G | Mod+Shift+G | no | src/shared/keybindings/definitions-core-1.ts:205 |
| sidebar.checks.toggle | global |  |  |  | yes | src/shared/keybindings/definitions-core-1.ts:213 |
| sidebar.ports.toggle | global |  |  | Mod+Shift+I | no | src/shared/keybindings/definitions-core-1.ts:221 |
| sidebar.sleepingWorkspaces.toggle | global |  |  |  | yes | src/shared/keybindings/definitions-core-1.ts:233 |
| sidebar.focusWorktreeList | global |  | Mod+Shift+0 | Mod+Shift+0 | no | src/shared/keybindings/definitions-core-1.ts:252 |
| floatingTerminal.toggle | global |  | Mod+Alt+A | Mod+Alt+A | no | src/shared/keybindings/definitions-core-1.ts:261 |
| floatingWorkspace.maximize | global |  |  | Mod+Alt+Shift+A | no | src/shared/keybindings/definitions-core-1.ts:270 |
| view.inbox | global |  |  |  | yes | src/shared/keybindings/definitions-core-2.ts:6 |
| view.floor | global |  |  |  | yes | src/shared/keybindings/definitions-core-2.ts:14 |
| view.code | global |  | Mod+Shift+3 | Mod+Shift+3 | no | src/shared/keybindings/definitions-core-2.ts:22 |
| floatingWorkspace.minimize | global |  |  |  | yes | src/shared/keybindings/definitions-core-2.ts:30 |
| zoom.in | global |  | Mod+Equal \| Mod+Shift+Plus \| Mod+NumpadAdd | Mod+Equal \| Mod+Shift+Plus \| Mod+NumpadAdd | no | src/shared/keybindings/definitions-core-2.ts:53 |
| zoom.out | global |  | Mod+Minus \| Mod+NumpadSubtract | Mod+Minus \| Mod+NumpadSubtract | no | src/shared/keybindings/definitions-core-2.ts:61 |
| zoom.reset | global |  | Mod+0 | Mod+0 | no | src/shared/keybindings/definitions-core-2.ts:69 |
| worktree.history.back | global |  | Mod+Alt+ArrowLeft | Mod+Alt+ArrowLeft | no | src/shared/keybindings/definitions-core-2.ts:77 |
| worktree.history.forward | global |  | Mod+Alt+ArrowRight | Mod+Alt+ArrowRight | no | src/shared/keybindings/definitions-core-2.ts:86 |
| tab.newTerminal | tabs |  | Mod+T | Mod+T | no | src/shared/keybindings/definitions-core-2.ts:95 |
| tab.newAgent | tabs |  |  | Mod+Alt+T | no | src/shared/keybindings/definitions-core-2.ts:103 |
| tab.newBrowser | tabs |  | Mod+Shift+B | Mod+Shift+B | no | src/shared/keybindings/definitions-core-2.ts:116 |
| tab.newSimulator | tabs |  |  | Mod+Alt+Shift+E | no | src/shared/keybindings/definitions-core-2.ts:124 |
| tab.newMarkdown | tabs |  | Mod+Shift+M | Mod+Shift+M | no | src/shared/keybindings/definitions-core-2.ts:137 |
| tab.openMarkdown | tabs |  | Mod+Shift+O | Mod+Shift+O | no | src/shared/keybindings/definitions-core-2.ts:145 |
| tab.close | tabs |  | Mod+W | Mod+W | no | src/shared/keybindings/definitions-core-2.ts:153 |
| tab.closeAll | tabs |  | Mod+Alt+W | Mod+Alt+W | no | src/shared/keybindings/definitions-core-2.ts:161 |
| tab.rename | tabs | workspace-shell |  | Mod+R | no | src/shared/keybindings/definitions-core-2.ts:169 |
| tab.reopenClosed | tabs |  | Mod+Shift+T | Mod+Shift+T | no | src/shared/keybindings/definitions-core-2.ts:183 |
| tab.nextSameType | tabs |  | Mod+Alt+BracketRight | Mod+Alt+BracketRight | no | src/shared/keybindings/definitions-core-2.ts:191 |
| tab.previousSameType | tabs |  | Mod+Alt+BracketLeft | Mod+Alt+BracketLeft | no | src/shared/keybindings/definitions-core-2.ts:200 |
| tab.nextAllTypes | tabs |  | Mod+Shift+BracketRight | Mod+Shift+BracketRight | no | src/shared/keybindings/definitions-core-2.ts:208 |
| tab.previousAllTypes | tabs |  | Mod+Shift+BracketLeft | Mod+Shift+BracketLeft | no | src/shared/keybindings/definitions-core-2.ts:216 |
| tab.previousRecent | tabs |  | Ctrl+Tab | Ctrl+Tab | no | src/shared/keybindings/definitions-core-2.ts:224 |
| tab.nextTerminal | tabs |  | Ctrl+PageDown | Ctrl+PageDown | no | src/shared/keybindings/definitions-core-2.ts:233 |
| tab.previousTerminal | tabs |  | Ctrl+PageUp | Ctrl+PageUp | no | src/shared/keybindings/definitions-core-2.ts:242 |
| tab.selectByIndex | tabs |  | Alt+1 | Ctrl+1 | no | src/shared/keybindings/definitions-core-2.ts:251 |
| tab.openQuickCommandsMenu | tabs | global |  |  | yes | src/shared/keybindings/definitions-core-2.ts:265 |
| browser.find | browser |  | Mod+F | Mod+F | no | src/shared/keybindings/definitions-core-2.ts:275 |
| browser.back | browser |  | Alt+ArrowLeft | Mod+BracketLeft | no | src/shared/keybindings/definitions-core-2.ts:283 |
| browser.forward | browser |  | Alt+ArrowRight | Mod+BracketRight | no | src/shared/keybindings/definitions-core-2.ts:295 |
| browser.reload | browser |  | Mod+R | Mod+R | no | src/shared/keybindings/definitions-core-3.ts:6 |
| browser.hardReload | browser |  | Mod+Shift+R | Mod+Shift+R | no | src/shared/keybindings/definitions-core-3.ts:14 |
| browser.focusAddressBar | browser |  | Mod+L | Mod+L | no | src/shared/keybindings/definitions-core-3.ts:22 |
| browser.grabElement | browser |  | Mod+C | Mod+C | no | src/shared/keybindings/definitions-core-3.ts:30 |
| editor.find | editor |  | Mod+F | Mod+F | no | src/shared/keybindings/definitions-core-3.ts:38 |
| editor.replace | editor |  | Mod+H | Mod+Alt+F | no | src/shared/keybindings/definitions-core-3.ts:46 |
| editor.save | editor |  | Mod+S | Mod+S | no | src/shared/keybindings/definitions-core-3.ts:59 |
| editor.markdownPreview | editor |  | Mod+Shift+V | Mod+Shift+V | no | src/shared/keybindings/definitions-core-3.ts:67 |
| editor.toggleWordWrap | editor |  | Alt+Z | Alt+Z | no | src/shared/keybindings/definitions-core-3.ts:75 |
| editor.copyContext | editor |  | Mod+Alt+C | Mod+Alt+C | no | src/shared/keybindings/definitions-core-3.ts:84 |
| editor.previousChange | editor |  | Shift+F7 | Shift+F7 | no | src/shared/keybindings/definitions-core-3.ts:93 |
| editor.nextChange | editor |  | F7 | F7 | no | src/shared/keybindings/definitions-core-3.ts:102 |
| editor.addReviewNote | editor |  | Mod+Shift+A | Mod+Shift+A | no | src/shared/keybindings/definitions-core-3.ts:111 |
| sourceControl.sendReviewNotes | global | editor |  |  | yes | src/shared/keybindings/definitions-core-3.ts:120 |
| fileExplorer.undo | fileExplorer |  | Mod+Z | Mod+Z | no | src/shared/keybindings/definitions-core-3.ts:140 |
| fileExplorer.redo | fileExplorer |  | Mod+Shift+Z \| Ctrl+Y | Mod+Shift+Z | no | src/shared/keybindings/definitions-core-3.ts:148 |
| fileExplorer.copyPath | fileExplorer |  | Alt+Shift+C | Mod+Alt+C | no | src/shared/keybindings/definitions-core-3.ts:160 |
| fileExplorer.copyRelativePath | fileExplorer |  | Mod+Alt+Shift+C | Mod+Alt+Shift+C | no | src/shared/keybindings/definitions-core-3.ts:172 |
| fileExplorer.delete | fileExplorer |  | Delete | Mod+Backspace \| Delete | no | src/shared/keybindings/definitions-core-3.ts:180 |
| settings.search | settings |  | Mod+F | Mod+F | no | src/shared/keybindings/definitions-core-3.ts:193 |
| terminal.copySelection | terminal |  | Ctrl+Shift+C \| Ctrl+C | Mod+C | no | src/shared/keybindings/definitions-core-3.ts:201 |
| terminal.selectAll | terminal |  | Ctrl+Shift+A | Mod+A | no | src/shared/keybindings/definitions-core-3.ts:213 |
| terminal.paste | terminal |  | Ctrl+V \| Ctrl+Shift+V \| Shift+Insert | Mod+V | no | src/shared/keybindings/definitions-core-3.ts:225 |
| terminal.search | terminal |  | Mod+F | Mod+F | no | src/shared/keybindings/definitions-core-3.ts:237 |
| terminal.clear | terminal |  | Mod+K | Mod+K | no | src/shared/keybindings/definitions-core-3.ts:245 |
| terminal.focusNextPane | terminal |  | Mod+BracketRight | Mod+BracketRight | no | src/shared/keybindings/definitions-core-3.ts:253 |
| terminal.focusPreviousPane | terminal |  | Mod+BracketLeft | Mod+BracketLeft | no | src/shared/keybindings/definitions-core-3.ts:261 |
| terminal.equalizePaneSizes | terminal |  |  |  | yes | src/shared/keybindings/definitions-core-3.ts:269 |
| terminal.expandPane | terminal |  | Mod+Shift+Enter | Mod+Shift+Enter | no | src/shared/keybindings/definitions-core-3.ts:292 |
| terminal.setTitle | terminal |  |  |  | yes | src/shared/keybindings/definitions-core-3.ts:300 |
| terminal.clearPaneTitle | terminal |  |  |  | yes | src/shared/keybindings/definitions-core-4.ts:6 |
| terminal.closePane | terminal |  | Mod+W | Mod+W | no | src/shared/keybindings/definitions-core-4.ts:14 |
| terminal.splitRight | terminal |  | Mod+Shift+D | Mod+D | no | src/shared/keybindings/definitions-core-4.ts:22 |
| terminal.splitDown | terminal |  | Alt+Shift+D | Mod+Shift+D | no | src/shared/keybindings/definitions-core-4.ts:34 |
| terminal.switchInputSource | terminal |  |  |  | yes | src/shared/keybindings/definitions-core-4.ts:46 |
| view.cycleWorkspaceView | global |  | Mod+Alt+V | Mod+Alt+V | no | src/shared/keybindings/definitions-workspace-view.ts:13 |
| sessions.add | tabs |  |  |  | yes | src/shared/keybindings/definitions-workspace-view.ts:30 |
| sessions.remove | tabs |  |  |  | yes | src/shared/keybindings/definitions-workspace-view.ts:38 |
| terminals.focusNextNeedsYou | global |  | Mod+J | Mod+Shift+J | no | src/shared/keybindings/definitions-next-needs-you.ts:15 |
| tab.newAgent.claude | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.claude-agent-teams | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.openclaude | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.codex | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.devin | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.ante | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.trae | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.autohand | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.mimo-code | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.pi | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.omp | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.prime-agent | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.gemini | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.antigravity | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.aider | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.goose | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.amp | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.kilo | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.kiro | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.crush | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.aug | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.cline | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.codebuff | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.command-code | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.continue | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.cursor | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.droid | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.kimi | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.mistral-vibe | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.qwen-code | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.rovo | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.hermes | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.openclaw | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.copilot | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |
| tab.newAgent.grok | tabs |  |  |  | yes | src/shared/keybindings/definitions.ts:20 (generated per agent) |

## 5. KOLUX_ variables read by the old source (first location)

| Variable | First location |
|---|---|
| KOLUX_AGENT_HOOK_ENDPOINT | src/main/agent-hooks/server/server-runtime-env.ts:26 |
| KOLUX_AGENT_HOOK_ENV | src/main/amp/agent-status-plugin-source.ts:57 |
| KOLUX_AGENT_HOOK_PORT | src/main/agent-hooks/server.test-fixtures.ts:55 |
| KOLUX_AGENT_HOOK_TOKEN | src/main/agent-hooks/server.test-fixtures.ts:59 |
| KOLUX_AGENT_HOOK_VERSION | src/main/amp/agent-status-plugin-source.ts:58 |
| KOLUX_AGENT_LAUNCH_TOKEN | src/main/amp/agent-status-plugin-source.ts:108 |
| KOLUX_AGENT_TEAMS_SHIM_BIN | src/main/runtime/claude-agent-teams-service.ts:54 |
| KOLUX_AGENT_TEAMS_TEAM_ID | src/cli/index.ts:213 |
| KOLUX_AGENT_TEAMS_TOKEN | src/cli/index.ts:214 |
| KOLUX_AI_VAULT_SERVICE_PROCESS | src/main/ai-vault/session-scanner-background.ts:30 |
| KOLUX_ALWAYS_REPORT_SECRET_PROTECTION | src/main/startup/main-process-ready-foundation.ts:169 |
| KOLUX_APP_EXECUTABLE | src/cli/runtime/launch.ts:33 |
| KOLUX_APP_EXECUTABLE_NEEDS_APP_ROOT | src/cli/runtime/launch.ts:259 |
| KOLUX_APP_VERSION | src/main/daemon/pty-subprocess/spawn-environment.ts:143 |
| KOLUX_BACKGROUND_LAUNCH | src/main/window/foreground-activation-policy.ts:22 |
| KOLUX_BROWSER_EXECUTABLE | src/main/koluxd/koluxd-browser-provider.ts:168 |
| KOLUX_CLAUDE_AGENT_STATUS_SETTINGS | src/main/ipc/pty-ipc-process-env-scope.ts:14 |
| KOLUX_CLI_COMMAND | src/cli/handlers/orchestration/runtime-compatibility.ts:4 |
| KOLUX_CLI_CWD | src/cli/handlers/skills.ts:228 |
| KOLUX_CLI_INSTALL_PATH | src/main/cli/cli-install-location.ts:85 |
| KOLUX_CLOUD_ALLOW_PLAINTEXT_SESSION | src/main/kolux-profiles/profile-cloud-auth-config.ts:112 |
| KOLUX_CLOUD_API_URL | src/main/kolux-profiles/profile-cloud-auth-config.ts:63 |
| KOLUX_CLOUD_AUTHORIZE_URL | src/main/kolux-profiles/profile-cloud-auth-config.ts:82 |
| KOLUX_CLOUD_AUTH_SCOPE | src/main/kolux-profiles/profile-cloud-auth-config.ts:102 |
| KOLUX_CLOUD_AUTH_URL | src/main/kolux-profiles/profile-cloud-auth-config.ts:76 |
| KOLUX_CLOUD_CAPABILITIES_URL | src/main/kolux-profiles/profile-cloud-auth-config.ts:91 |
| KOLUX_CLOUD_CLIENT_ID | src/main/kolux-profiles/profile-cloud-auth-config.ts:68 |
| KOLUX_CLOUD_DEV_AUTH | src/main/kolux-profiles/profile-cloud-auth-config.ts:120 |
| KOLUX_CLOUD_DEV_DISPLAY_NAME | src/main/kolux-profiles/profile-cloud-dev-auth.ts:59 |
| KOLUX_CLOUD_DEV_EMAIL | src/main/kolux-profiles/profile-cloud-dev-auth.ts:58 |
| KOLUX_CLOUD_DEV_USER_ID | src/main/kolux-profiles/profile-cloud-dev-auth.ts:57 |
| KOLUX_CLOUD_LOGOUT_URL | src/main/kolux-profiles/profile-cloud-auth-config.ts:99 |
| KOLUX_CLOUD_ORG_URL | src/main/kolux-profiles/profile-cloud-auth-config.ts:97 |
| KOLUX_CLOUD_PROFILE_URL | src/main/kolux-profiles/profile-cloud-auth-config.ts:94 |
| KOLUX_CLOUD_REFRESH_URL | src/main/kolux-profiles/profile-cloud-auth-config.ts:88 |
| KOLUX_CLOUD_SESSION_URL | src/main/kolux-profiles/profile-cloud-auth-config.ts:85 |
| KOLUX_CODEX_HOME | src/cli/handlers/agent-hooks.ts:217 |
| KOLUX_CODEX_LAUNCH_PREFLIGHT | src/main/daemon/pty-subprocess/shell-launch-plan.ts:102 |
| KOLUX_COMPUTER_DESKTOP_SCRIPT_PROVIDER_PATH | src/main/computer/desktop-script-provider-paths.ts:19 |
| KOLUX_COMPUTER_MACOS_HELPER_APP_PATH | src/main/computer/macos-native-provider-paths.ts:5 |
| KOLUX_COMPUTER_SCREENSHOT_TMPDIR | src/cli/computer-format.ts:106 |
| KOLUX_DAEMON_BACKGROUND_STREAM_DROP | src/main/daemon/daemon-background-transient-facts.ts:32 |
| KOLUX_DAEMON_ENTRY_LOAD_CHECK | src/main/daemon/daemon-entry.ts:325 |
| KOLUX_DAEMON_SHALLOW_SOCKET_GATE | src/main/daemon/daemon-stream-data-batcher.ts:27 |
| KOLUX_DAEMON_STREAM_BACKLOG_FILE | src/main/daemon/daemon-stream-backlog-probe.ts:30 |
| KOLUX_DEV_BRANCH | src/main/startup/dev-instance-identity.ts:83 |
| KOLUX_DEV_CLI_INVOCATION | src/cli/handlers/orchestration/runtime-compatibility.ts:39 |
| KOLUX_DEV_DOCK_BADGE_LABEL | src/main/startup/__fixtures__/fake-electron-vite-dev-cli.mjs:71 |
| KOLUX_DEV_DOCK_TITLE | src/main/startup/dev-instance-identity.ts:89 |
| KOLUX_DEV_INSTANCE_LABEL | src/main/startup/dev-instance-identity.ts:87 |
| KOLUX_DEV_MACOS_BUNDLE_ID | src/main/ipc/notification-system-settings-link.ts:8 |
| KOLUX_DEV_REPO_ROOT | src/cli/runtime/orchestration-recovery-command.ts:9 |
| KOLUX_DEV_STABLE_NAME | src/main/startup/__fixtures__/fake-electron-vite-dev-cli.mjs:73 |
| KOLUX_DEV_USER_DATA_PATH | src/main/startup/configure-process.ts:213 |
| KOLUX_DEV_WORKTREE_NAME | src/main/startup/dev-instance-identity.ts:85 |
| KOLUX_DEV_WRAPPER_TEST_ENV_FILE | src/main/startup/__fixtures__/fake-electron-vite-dev-cli.mjs:8 |
| KOLUX_DEV_WRAPPER_TEST_PID_FILE | src/main/startup/__fixtures__/fake-electron-vite-dev-cli.mjs:7 |
| KOLUX_DEV_WRAPPER_TEST_VITE_FILE | src/main/startup/__fixtures__/fake-vite-cli.mjs:4 |
| KOLUX_DIAGNOSTICS_DISABLED | src/main/daemon/daemon-launch-paths.ts:45 |
| KOLUX_DIAGNOSTICS_TOKEN_URL | src/main/observability/diagnostic-upload-endpoint.ts:29 |
| KOLUX_DISABLE_AGENT_BROWSER_SWEEP | src/main/browser/agent-browser-orphan-sweep.ts:55 |
| KOLUX_DISABLE_MACOS_LOGIN_SHELL | src/main/ipc/pty-ipc-process-env-scope.ts:16 |
| KOLUX_DISABLE_REPO_REF_MAINTENANCE | src/main/git/local-repo-ref-maintenance.ts:63 |
| KOLUX_E2E_DAEMON_INIT_DELAY_MS | src/main/daemon/daemon-provider-init.ts:53 |
| KOLUX_E2E_DISABLE_AUTHORITATIVE_SESSION_TABS_INVENTORY | src/main/runtime/kolux-runtime-collect-mobile-visible-graph-changed-worktrees.ts:179 |
| KOLUX_E2E_DISABLE_PAIRED_TERMINAL_PARKING | src/main/runtime/kolux-runtime-get-status.ts:70 |
| KOLUX_E2E_DISABLE_RUNTIME_SHARED_CONTROL | src/main/runtime/kolux-runtime-get-status.ts:68 |
| KOLUX_E2E_FORBID_LOCAL_SSH_CONNECT_PROBE | src/main/ipc/ssh-connect-flow.ts:46 |
| KOLUX_E2E_FORCE_REMOTE_TERMINAL_INITIAL_SNAPSHOT_TRUNCATED | src/main/runtime/rpc/methods/terminal/terminal-multiplex-initial-snapshot.ts:27 |
| KOLUX_E2E_FOREGROUND | src/main/window/foreground-activation-policy.ts:25 |
| KOLUX_E2E_HEADFUL | src/main/window/foreground-activation-policy.ts:28 |
| KOLUX_E2E_HEADLESS | src/main/e2e-config.ts:5 |
| KOLUX_E2E_HOME_DIR | src/main/startup/configure-process.ts:196 |
| KOLUX_E2E_LOGIN_SESSION_PROBE_FILE | src/main/daemon/daemon-entry.ts:204 |
| KOLUX_E2E_ORCHESTRATION_POINTER_ENTER_DELAY_MS | src/main/runtime/orchestration/mailbox-pointer-delivery.ts:20 |
| KOLUX_E2E_RUNTIME_WS_PORT | src/main/startup/runtime-rpc-ws-port-pin.ts:8 |
| KOLUX_E2E_TERMINAL_PARKING_DELAY_MS | src/preload/e2e-config.ts:26 |
| KOLUX_E2E_TERMINAL_RETENTION_LIMIT | src/preload/e2e-config.ts:27 |
| KOLUX_E2E_USER_DATA_DIR | src/main/claude-accounts/runtime-paths.ts:55 |
| KOLUX_EMULATOR_PROBE | src/main/emulator/emulator-probe.ts:8 |
| KOLUX_ENVIRONMENT | src/cli/index.ts:138 |
| KOLUX_FAKE_SIDECAR_CONTROL | src/main/koluxd/__fixtures__/fake-koluxd-electron-sidecar.cjs:24 |
| KOLUX_FAKE_SIDECAR_LOG | src/main/koluxd/__fixtures__/fake-koluxd-electron-sidecar.cjs:23 |
| KOLUX_FAKE_SIDECAR_MODE | src/main/koluxd/__fixtures__/fake-koluxd-electron-sidecar.cjs:30 |
| KOLUX_GH_EXEC_TIMEOUT_MS | src/main/git/command-runner/gh-retry-policy.ts:59 |
| KOLUX_GIT_ADMISSION_DISABLED | src/main/git/command-runner/git-subprocess-admission.ts:313 |
| KOLUX_HANG_WATCHDOG_CHECK_INTERVAL_MS | src/main/hang-watchdog/main-thread-hang-watchdog.ts:39 |
| KOLUX_HANG_WATCHDOG_FORCE | src/main/hang-watchdog/main-thread-hang-watchdog.ts:30 |
| KOLUX_HANG_WATCHDOG_TIMEOUT_MS | src/main/hang-watchdog/main-thread-hang-watchdog.ts:37 |
| KOLUX_HEARTBEAT_INTERVAL_MS | src/cli/handlers/orchestration/check-keepalive.ts:5 |
| KOLUX_HISTFILE | src/main/daemon/pty-subprocess/spawn-environment.ts:159 |
| KOLUX_KEEPALIVE_INTERVAL_MS | src/cli/handlers/orchestration/check-keepalive.ts:5 |
| KOLUX_KOLUXD_PREBUILDS_DIR | src/main/koluxd/node-pty-prebuilt-slot.ts:43 |
| KOLUX_MIMOCODE_HOME | src/main/ipc/pty/host-env/pi-agent.ts:179 |
| KOLUX_MIMOCODE_SOURCE_HOME | src/main/ipc/pty/host-env/pi-agent.ts:174 |
| KOLUX_MULTI_PROFILE_UI | src/main/kolux-profiles/profile-ui-scope.ts:5 |
| KOLUX_NODE_OPTIONS | src/main/ssh/ssh-remote-cli-host-passthrough.ts:118 |
| KOLUX_NODE_REPL_EXTERNAL_MODULE | src/main/ssh/ssh-remote-cli-host-passthrough.ts:119 |
| KOLUX_NOTEBOOK_PYTHON | src/main/ipc/notebook.ts:26 |
| KOLUX_OMP_CODING_AGENT_DIR | src/main/ipc/pty-ipc-process-env-scope.ts:8 |
| KOLUX_OMP_SOURCE_AGENT_DIR | src/main/ipc/pty-ipc-process-env-scope.ts:9 |
| KOLUX_OMP_STATUS_EXTENSION | src/main/ipc/pty-ipc-process-env-scope.ts:10 |
| KOLUX_OPEN_COMMAND | src/cli/runtime/launch.ts:27 |
| KOLUX_ORIG_ZDOTDIR | src/main/zsh-wrapper-dir-ownership.ts:57 |
| KOLUX_PAIRING_CODE | src/cli/runtime/client.ts:66 |
| KOLUX_PANE_KEY | src/cli/handlers/core.ts:69 |
| KOLUX_PI_CODING_AGENT_DIR | src/main/ipc/pty-ipc-process-env-scope.ts:5 |
| KOLUX_PI_SOURCE_AGENT_DIR | src/main/ipc/pty-ipc-process-env-scope.ts:6 |
| KOLUX_PI_TITLE_MARKER_OWNED | src/main/pi/titlebar-extension-source.ts:122 |
| KOLUX_PRIME_AGENT_SOURCE_AGENT_DIR | src/main/ipc/pty-ipc-process-env-scope.ts:12 |
| KOLUX_PRIME_AGENT_STATUS_EXTENSION | src/main/ipc/pty-ipc-process-env-scope.ts:13 |
| KOLUX_PROVIDER_SUPERVISOR_SPEC | src/main/codex/codex-app-server-posix-supervisor.ts:6 |
| KOLUX_PTY_SPAWN_TIMING | src/main/daemon/daemon-pty-spawn-request.ts:201 |
| KOLUX_RELAY_PATH | src/main/agent-hooks/wsl-hook-relay-launch.ts:39 |
| KOLUX_REMOTE_PAIRING | src/cli/runtime/client.ts:66 |
| KOLUX_SDK_CONTRACT_DESCENDANT | src/main/claude/__fixtures__/claude-agent-sdk-scripted-cli.mjs:46 |
| KOLUX_SDK_CONTRACT_IGNORE_CONTROL_REQUESTS | src/main/claude/__fixtures__/claude-agent-sdk-scripted-cli.mjs:93 |
| KOLUX_SDK_CONTRACT_IGNORE_SIGTERM | src/main/claude/__fixtures__/claude-agent-sdk-scripted-cli.mjs:41 |
| KOLUX_SDK_CONTRACT_REPORT_PATH | src/main/claude/__fixtures__/claude-agent-sdk-scripted-cli.mjs:20 |
| KOLUX_SDK_CONTRACT_SCENARIO_PATH | src/main/claude/__fixtures__/claude-agent-sdk-scripted-cli.mjs:19 |
| KOLUX_SHELL_FEATURES | src/main/daemon/pty-subprocess/shell-launch-plan.ts:204 |
| KOLUX_SHELL_READY_ROOT | src/main/pty/wsl-kolux-env.ts:60 |
| KOLUX_SSH_FORCE_SYSTEM_TRANSPORT | src/main/ssh/ssh-transport-selection.ts:77 |
| KOLUX_SSH_MUX_DEBUG | src/main/ssh/ssh-channel-multiplexer.ts:367 |
| KOLUX_STARTUP_DIAGNOSTICS | src/preload/preload-runtime-support.ts:29 |
| KOLUX_SYSTEM_SFTP_PATH | src/main/ssh/system-ssh-sftp-transfer.ts:77 |
| KOLUX_SYSTEM_SSH_PATH | src/main/ssh/system-ssh-binary.ts:44 |
| KOLUX_TAB_ID | src/main/amp/agent-status-plugin-source.ts:109 |
| KOLUX_TERMINAL_HANDLE | src/cli/handlers/orchestration/message-send-handler.ts:78 |
| KOLUX_TERMINAL_WINDOWS_SHELL | src/cli/orchestration-mutation-recovery.ts:191 |
| KOLUX_TEST_SSH_REPOSITORIES | src/main/plugins/plugin-private-marketplace-ssh-shim.cjs:5 |
| KOLUX_USER_DATA | src/main/koluxd/koluxd-entry.ts:118 |
| KOLUX_USER_DATA_PATH | src/cli/handlers/orchestration/runtime-compatibility.ts:40 |
| KOLUX_VERSION | src/main/koluxd/koluxd-entry.ts:55 |
| KOLUX_WATCHER_CANARY_DIR | src/main/ipc/parcel-watcher-process-entry.ts:44 |
| KOLUX_WATCHER_CHILD_PID_FILE | src/main/ipc/parcel-watcher-child-launch.ts:47 |
| KOLUX_WINDOWS_PACKAGED_CLI_LAUNCHER | src/cli/handlers/orchestration/runtime-compatibility.ts:12 |
| KOLUX_WINDOWS_SHELL | src/cli/orchestration-mutation-recovery.ts:191 |
| KOLUX_WORKSPACES_DIR | src/shared/kolux-workspaces-dir.ts:7 |
| KOLUX_WORKSPACE_ID | src/cli/handlers/worktree-create-flags.ts:8 |
| KOLUX_WORKSPACE_ROOT | src/relay/pty-spawn-cwd.ts:70 |
| KOLUX_WORKTREE_ADD_TIMEOUT_MS | src/main/git/worktree-operation-options.ts:62 |
| KOLUX_WORKTREE_ID | src/cli/handlers/worktree-create-flags.ts:12 |
| KOLUX_WSL_HOOK_RELAY_DEBUG | src/main/agent-hooks/wsl-hook-relay-link.ts:35 |
| KOLUX_ROOT_PATH, KOLUX_WORKTREE_PATH, KOLUX_WORKSPACE_NAME (set, not read) | src/main/setup-hook-env-vars.ts:7-23 |

## 6. Agent catalog rows

| Id | Detect | Model picker | Hooks | Evidence |
|---|---|---|---|---|
| claude | claude | yes: src/shared/agent-session-option-catalog-claude-codex.ts (session option catalog with model list) | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:47; src/shared/tui-agent-config.ts:70 |
| claude-agent-teams | kolux | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:53; src/shared/tui-agent-config.ts:78 |
| openclaude | openclaude | none found in agent-session-option-catalog* | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:59; src/shared/tui-agent-config.ts:94 |
| codex | codex | yes: src/shared/agent-session-option-catalog-claude-codex.ts (session option catalog with model list) | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:68; src/shared/tui-agent-config.ts:99 |
| autohand | autohand | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:196; src/shared/tui-agent-config.ts:108 |
| ante | ante | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:94; src/shared/tui-agent-config.ts:112 |
| trae | traecli | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:101; src/shared/tui-agent-config.ts:117 |
| mimo-code | mimo | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:87; src/shared/tui-agent-config.ts:127 |
| pi | pi | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:110; src/shared/tui-agent-config.ts:133 |
| omp | omp | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:116; src/shared/tui-agent-config.ts:141 |
| prime-agent | prime-agent | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:124; src/shared/tui-agent-config.ts:148 |
| gemini | gemini | yes: src/shared/agent-session-option-catalog-gemini-cursor.ts (session option catalog with model list) | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:131; src/shared/tui-agent-config.ts:158 |
| antigravity | agy | none found in agent-session-option-catalog* | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:138; src/shared/tui-agent-config.ts:162 |
| aider | aider | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:145; src/shared/tui-agent-config.ts:166 |
| goose | goose | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:151; src/shared/tui-agent-config.ts:170 |
| amp | amp | none found in agent-session-option-catalog* | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:158; src/shared/tui-agent-config.ts:174 |
| kilo | kilo | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:165; src/shared/tui-agent-config.ts:178 |
| kiro | kiro-cli | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:171; src/shared/tui-agent-config.ts:182 |
| crush | crush | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:182; src/shared/tui-agent-config.ts:189 |
| aug | auggie | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:189; src/shared/tui-agent-config.ts:193 |
| cline | cline | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:203; src/shared/tui-agent-config.ts:198 |
| codebuff | codebuff | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:210; src/shared/tui-agent-config.ts:202 |
| command-code | command-code | none found in agent-session-option-catalog* | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:217; src/shared/tui-agent-config.ts:206 |
| continue | cn | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:228; src/shared/tui-agent-config.ts:213 |
| cursor | cursor-agent | yes: src/shared/agent-session-option-catalog-gemini-cursor.ts (session option catalog with model list) | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:237; src/shared/tui-agent-config.ts:218 |
| droid | droid | none found in agent-session-option-catalog* | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:244; src/shared/tui-agent-config.ts:224 |
| kimi | kimi | none found in agent-session-option-catalog* | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:250; src/shared/tui-agent-config.ts:231 |
| mistral-vibe | vibe | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:257; src/shared/tui-agent-config.ts:238 |
| qwen-code | qwen | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:266; src/shared/tui-agent-config.ts:244 |
| rovo | rovo | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:275; src/shared/tui-agent-config.ts:249 |
| hermes | hermes | none found in agent-session-option-catalog* | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:283; src/shared/tui-agent-config.ts:253 |
| openclaw | openclaw | none found in agent-session-option-catalog* | no | src/renderer/src/lib/agent-catalog.tsx:297; src/shared/tui-agent-config.ts:260 |
| copilot | copilot | none found in agent-session-option-catalog* | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:81; src/shared/tui-agent-config.ts:264 |
| grok | grok | yes: src/shared/agent-session-option-catalog-grok.ts (session option catalog with model list) | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:74; src/shared/tui-agent-config.ts:271 |
| devin | devin | none found in agent-session-option-catalog* | yes (AGENT_HOOK_TARGETS) | src/renderer/src/lib/agent-catalog.tsx:290; src/shared/tui-agent-config.ts:283 |

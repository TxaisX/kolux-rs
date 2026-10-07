# Firewall scrub report: 05 · Views & navigation

- Stage: 3 (Firewall), 2026-10-06
- Input: `provenance/dirty-room/cards-raw/05-views-navigation.json` (118 cards, D-05-001 … D-05-118; D-05-118 from critic round 2, rules from critic round 3 already merged by the critic)
- Output: `spec/05-views-navigation.md` (ids VIEW-nnn, number kept from D-05-nnn), 1,772 lines, max line 100 characters
- Method: the spec was generated from the JSON by a scratch script (outside the repo) that applies a per-card rewrite table, then checked with `scripts/firewall-check.ps1` and a literal six-word similarity hunt against the old repo. Evidence arrays were never rendered.

## Cards written per tier

| Tier | Cards in JSON | Cards in spec |
|---|---|---|
| P0 | 24 | 24 |
| P1 | 58 | 58 |
| P2 | 15 | 15 |
| H | 10 | 10 |
| X | 1 | 1 |
| D | 10 | 10 |
| **Total** | **118** | **118** |

Sorted by tier, then pushed (null last), then id. Every card has at least two acceptance items (251 in all).
The raw cards had 160 usable items; 73 cards had a single item or only "n/a — decision item" (all 21 H/X/D
cards among them). The added items were derived from that card's own rules or, for H/X/D cards, state
what must be absent at the default decision; none come from test titles. Two cards had no rules
(D-05-087, D-05-113) and one D card had none (D-05-103); each got one rule written from its own user_sees.
All 20 H and D cards carry `Decision:`; the X card carries its replace instruction in Rules. The spec ends
with the `Dropped by default (tier D)` list (10 lines) and the `Hidden or retired (tier H)` list (10 lines).

## Leaks found and how each was fixed (38)

Raw cards rendered without rewrites gave **35 script hits**; three more leaks were found by reading.

| Category | Count | Where (raw card) | Fix |
|---|---|---|---|
| Identifier (camelCase setting keys) | 15 | `showTasksButton` (010), `showAutomationsButton`, `showSkillsButton` (011), `experimentalAgentDashboardPopout` (029), `experimentalPet` (032), `experimentalActivity` (033), `showMobileButton` (035), `leftSidebarAppearanceMode`, `leftSidebarTintColor`, `leftSidebarTintOpacity` (052), `rightSidebarOpenByDefault` (056), `sourceControlViewMode` (062), `keepComputerAwakeWhileAgentsRun` (097), `showTitlebarAppName` (106), `terminalHiddenViewParking` (108) | Named as the user meets them: "a View > Appearance toggle, on/off by default", "an experimental setting, off by default", "sidebar appearance mode, tint colour and tint opacity", "an open-by-default setting", "a list-or-tree setting", "a keep-awake setting", "a setting that parks hidden terminals" |
| Identifier (camelCase keybinding ids) | 17 script hits / 14 ids | `view.cycleWorkspaceView` (002), `worktree.navigateUp`, `worktree.navigateDown`, `workspace.selectByIndex` (046), `terminals.focusNextNeedsYou` (047), `sidebar.focusWorktreeList` (050), `sidebar.sleepingWorkspaces.toggle` (053), `sidebar.sourceControl.toggle` (057), `fileExplorer.undo/.redo/.copyPath/.copyRelativePath/.delete` (060), `sourceControl.sendReviewNotes` (072) | Commands described in words ("the cycle command", "neighbour-up, neighbour-down and jump-by-number commands", "five Explorer commands: undo, redo, copy path, copy relative path, delete") with the line "exact id held back pending the allowlist"; ids listed below as allowlist candidates |
| File name | 3 script hits / 1 sentence | D-05-023 acceptance: two Markdown file names used as example output files | Rewritten as "file A, then file B" |
| Identifier (settings-section id) | 1 | D-05-022 decision named the cut settings section by its id | "goes with its settings section" |
| Project-record id | 1 | D-05-029 decision cited an improvement card by its card id and slogan | "an improvement card asks for a single always-on overview of agents" |
| Path / extension | 1 | D-05-066 rule: remote address "ends in .git" | "whatever form its address takes" |
| UI copy over six words | 0 | — | Labels kept are all six words or fewer: Agents, Board, Terminals, View > Workspace View, View > Appearance > Show Status Bar, Show terminal, Show Code, Add artifact, Other sessions, Stage, Unstage, Stage All, Force Push, Publish Branch, Create PR, Add comment, Manage Sessions, Resource Manager, Attached worktrees, PR Checks, Unlimited, More |
| Error text | 0 | — | Failures described by kind (failed search, failed commit, lint failure, push rejected), never quoted |
| Schema / JSON keys | 0 | — | Saved state described as behaviour (falls back, migrates, clamped); no keys or value names |
| Library names | 0 | — | None in the raw prose |

Style rewrites not counted as leaks (implementation vocabulary replaced by what the user observes), 13:
"the renderer owns the chord" (002, 037) → "the window itself handles the key press"; "flushed synchronously"
(005) → "written out before the window finishes closing"; "unknown page ids are rejected" (009) → "a request for
an unknown page is refused"; "code chunk fails to load" (056); "virtualised" (062); "remounts" (001, 064);
"unmounts" (004); "lanes … are mounted" (027); "debounced" (059); "throttled" (083); "store changes" (115);
"the quieter-sidebar pass" (034) → "when the sidebar was simplified on 2026-09-22".

## Similarity hunt

Method: literal, case-insensitive (`rg -iF`) search of six-word phrases against `src`, `tests`, `docs`,
`README.md`, `HANDOFF.md`, `HANDOFF-HISTORY.md` of the old repo (ripgrep 15.0.0; `rg` is not on the Bash
PATH here, so the VS Code bundled binary was used). Phrases are windows inside a clause, so punctuation
never sits inside a phrase.

| Pass | Phrases | Hits |
|---|---|---|
| Formal: three most distinctive phrases per card (plus the scope paragraph) | 353 | 4 on first run, 0 final |
| Sweep: every six-word window of every card's prose | 3,965 | 15 distinct on first run, 1 after round 1, 0 final |
| Sweep: every six-word window of the final spec file (headers, lists, scope) | 4,129 | 0 |
| Sweep: same, with commas kept inside phrases | 5,634 | 0 |

**16 hits fixed** (each sentence rewritten with new structure, then the script and sweeps re-run):

| Card | Matched phrase (lower-cased) | Rewrite |
|---|---|---|
| 001 | "the switch at the top of" / "switch at the top of the" | "in the screen switch in the top bar" |
| 003 | "at the top of the window" | "glances up at the top bar and clicks its search hint or its bell" |
| 010 | "for github issues and pull requests" | "the Tasks page, listing GitHub issues and pull requests" |
| 018 | "nothing when the provider has no" | "stays blank for a provider without a 5-hour window" |
| 023 | "the first line of the final" | "the opening line of the agent's last message … the most recent file it wrote" |
| 025 | "board keeps its own permission buttons" | "the approve and deny buttons on Board cards stayed when the footer … was removed" |
| 028 | same phrase as 025 | "Board cards still carry approve and deny" |
| 031 | "dashboard pop-out window and agent map" (title) | "Separate dashboard window and the Agent Map" |
| 056 | "widths above the former 500px cap" (a firewall rewrite that happened to match) | "a saved width wider than the old 500px limit is honoured" |
| 061 | "instead of showing an empty list" | "explains the failure rather than showing nothing" |
| 063 | "cmd on mac and ctrl elsewhere" | "Mod is the Command key on a Mac and Control on other systems" |
| 070 | "opens another pr without changing local" | "shows it but leaves the local checkout alone" |
| 074 | "create a pull request from the" (title) | "Start a pull request from Checks" |
| 080 | "even when they are older than" | "still appear when the general cap on recent sessions would have cut them" |
| 099 | "only when the session is proven" | "left out only if Kolux has confirmed the session has already ended" |
| 118 | "anchor that is no longer visible" | "when the row a range began from is out of view, Kolux forgets it" |

## Final script line

```
firewall-check: 0 hit(s) across 1 file(s)
```

## Allowlist candidates (not edited; for the coordinator)

Keybinding command ids users may already have in `~/.kolux/keybindings.json`; the spec describes each in words:

- `view.cycleWorkspaceView` — cycle Agents / Board / Terminals (default Mod+Alt+V)
- `terminals.focusNextNeedsYou` — jump to the next session that needs you (also area 04)
- `sidebar.focusWorktreeList` — focus the left sidebar list (default Mod+Shift+0)
- `worktree.navigateUp`, `worktree.navigateDown` — neighbouring worktree (Mod+Shift+Up/Down)
- `workspace.selectByIndex` — jump to worktree by position (Mod+1 … Mod+9)
- `sidebar.sleepingWorkspaces.toggle` — show or hide sleeping workspaces (unbound; also area 01)
- `sidebar.sourceControl.toggle` — open Source Control (Mod+Shift+G)
- `fileExplorer.undo`, `fileExplorer.redo`, `fileExplorer.copyPath`, `fileExplorer.copyRelativePath`, `fileExplorer.delete`
- `sourceControl.sendReviewNotes` — send review notes to the agent (unbound)
- Suggest a single rule instead: `re:^[a-z]+(\.[a-zA-Z]+)+$` for dotted keybinding ids, scoped to Compat lines if the script can do that.

Dotted lowercase ids pass the script and are kept as plain text in Compat, as areas 01 and 02 did:
`view.code`, `view.inbox`, `view.floor`, `view.tasks`, `worktree.palette`, `worktree.history.back`,
`worktree.history.forward`, `workspace.delete`, `tab.rename`, `sessions.add`, `sessions.remove`,
`sidebar.left.toggle`, `sidebar.right.toggle`, `sidebar.explorer.toggle`, `sidebar.search.toggle`,
`sidebar.checks.toggle`, `sidebar.ports.toggle` (D card), `dashboard.toggle` (H card).

## Residual risks

1. Dotted keybinding ids above are old-app identifiers kept on purpose (the shared brief allows keybinding command ids); if the coordinator reads that rule narrowly they must move to the allowlist or be removed.
2. Numeric constants come from the old code: 268px / 240px rail widths, the former 500px right-sidebar cap, 20-row palette sections, 60 % / 80 % memory warnings, 21 workflow statuses, 100-update burst, five-minute readiness staleness, 30-second compare refresh, terminal-tile font 14/12/11, ages switching to days at two days. They are behaviour, not prose, but they are exact.
3. Third-party formats described in behaviour terms: Claude Code's per-project transcript folder naming (VIEW-091), the Codex pet bundle format (VIEW-032), and the `repo:` / `path:` search filters the user types (VIEW-081). Agent and product names (Claude Code, Codex, Kimi, Grok, Devin, Cline, Antigravity, OMP, Rovo, Cursor, Hermes, OpenClaw, Copilot, Pi, MiniMax) are allowed names.
4. The hunt is literal at six words; close paraphrase below that length, and text in `specs/`, `resources/` or the dirty-room dumps, is not detected. Records dumps were not searched (the brief's target list only).
5. 91 acceptance items and four rules were written at this stage from the cards' own rules, not from tests; the build loop should treat them as derived.
6. Carried critic notes, unresolved here (the firewall does not move cards between areas): VIEW-027 is the sidebar workspace board and duplicates area 01 (D-01-085); VIEW-105 duplicates area 03 (D-03-094); the unset default screen is Board for the menu (VIEW-001) but Terminals for per-screen themes (VIEW-006); Floor has no visible entry point at 0.15.0 (VIEW-013); VIEW-118 is half-done with a gesture conflict for the owner to decide.
7. VIEW-097 still mentions a paired web client (area 18, dropped) as the one place keep-awake is hidden; harmless but stale.

## Old repo

Read-only throughout: only ripgrep searches. `git -C G:\Dev\Kolux\kolux status --short` is the last command of this stage.

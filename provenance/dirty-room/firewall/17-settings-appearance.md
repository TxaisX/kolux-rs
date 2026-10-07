# Firewall scrub report — 17 · Settings, appearance & input

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/17-settings-appearance.json` (62 cards, final after critic rounds r1–r3)
- Output: `spec/17-settings-appearance.md` (ids SET-nnn, number taken from D-17-nnn; 1,098 lines)

## Cards written per tier

| Tier | JSON | Spec |
|---|---|---|
| P0 | 16 | 16 |
| P1 | 20 | 20 |
| P2 | 11 | 11 |
| H | 4 | 4 |
| X | 1 | 1 |
| D | 10 | 10 |
| Total | 62 | 62 |

Sort order: tier, then pushed (null last), then id. 62 `### SET-` headings and 62 `Source: D-17-` lines (grep-counted).
Dropped list (10 lines) and Hidden-or-retired list (4 lines) are at the end of the spec.

## Leaks found and fixed (46)

| Category | Count | What was in the card JSON | Fix |
|---|---|---|---|
| Identifier — settings keys (camelCase / JSON keys with values) | 16 | themeId (D-17-001); themeHueShift, themeSaturation, themeDepth (002); theme with its three values (005); terminalShortcutPolicy with its two values (014); ctrlTabOrderMode 'mru' (015); uiLanguage with two-letter codes (017); defaultTuiAgent, disabledTuiAgents, agentCmdOverrides, agentDefaultArgs, agentDefaultEnv (027); workspaceDir, nestWorkspaces (032) | Compat lines now say what the saved choice is and that it imports (e.g. "a saved Kolux first or Terminal first choice imports unchanged"); key names withheld |
| Identifier — camelCase keybinding command ids | 23 | 22 occurrences in the D-17-013 default table (quick open, force reload, select workspace/tab by number, focus worktree list, previous recent tab, split right/down, cycle workspace view, focus next needs-you, new agent tab and its per-agent form, ports toggle, open board, sleeping workspaces toggle, floating minimise, quick commands menu, send review notes, equalise panes, set title, clear pane title, switch input source); 1 in D-17-037 | Commands named in words with their chords; ids listed as allowlist candidates. Lower-case dotted ids (app.settings, settings.search, zoom.in/out/reset, terminal.clear, workspace.create/delete/rename, worktree.palette, tab.rename, sidebar.left/right/checks toggles, view.tasks/inbox/floor, dashboard.toggle, sessions.add/remove) kept as plain text, as specs 01 and 02 do |
| Schema (JSON literal) | 1 | D-17-011 acceptance carried a literal keybindings-file JSON snippet | Rewritten as "put terminal.clear with the value null in the keybindings map"; the file's shape (allowed interface) is described in words in Compat |
| Library / framework term | 2 | "CSS transitions" (D-17-004); "main process" menus (D-17-017) | "colour animation"; "the system menus" |
| Code keyword (script hits, first run) | 4 | "import as", "import previews", "import dialog", "import sources" tripped the code-keyword rule (SET-032, SET-024) | Reworded to "carry over as they are", "bringing in from Warp", "that dialog", "sources the user can bring schemes in from" |
| Path / file name | 0 | only `~/.kolux/keybindings.json` (allowed interface) and `~/.kolux` | kept in backticks / as typed |
| UI copy > 6 words | 0 | tooltip text in D-17-059 was paraphrased; every quoted or named label is ≤ 6 words | — |
| Error text | 0 | none quoted | — |

Acceptance gaps filled by this stage (card had one item, or "n/a — decision item"): SET-042 and SET-043 got a
second check derived from their own rules; SET-044 to SET-047 (H), SET-048 (X) and SET-049 to SET-058 (D) each got
two default-build / if-built checks.

## Similarity hunt

- Per-card phrases: the three longest clauses of six or more words from every card and section block (194 phrases)
  searched with `rg -iF` against old-repo src, tests, docs, README.md, HANDOFF.md, HANDOFF-HISTORY.md → 0 matches.
- Full sweep, stricter than the brief: every six-word window of the spec prose (3,234 windows on the first pass,
  3,229 on the final file) searched the same way. First pass (word-bounded) → 7 distinct matches, all rewritten.
  Final pass without word bounds (`rg -iFo`, superset) → 0 matches. Windows created by each rewrite were re-searched
  separately → 0 matches.

| Matched six words | Old source (kind) | Card | Rewrite |
|---|---|---|---|
| Kolux Account and Input settings removed | HANDOFF entry | SET-045 heading + H list | "Voice, Kolux Account and Input pages are gone" |
| Cmd on macOS and Ctrl elsewhere | test titles (two files) | SET-013 rules | "Mod stands for Cmd on a Mac and for Ctrl on the other two platforms" |
| a value that is not a | test fixture text | SET-002 rules | "a non-numeric value falls back to its default" |
| listed next to the built-in ones | UI string + palette code | SET-053 user sees | "custom agents showed up beside the agents Kolux ships with" |
| by default on Linux and macOS | UI strings + settings search words | SET-025 rules | "starts switched on for Linux and macOS users, while Windows users opt in" |
| that tier's model on the same | UI string + routing section | SET-028 user sees | "the worker runs on the same provider, using the model picked for that tier" |
| again when the window regains focus | code comment (starter kits) | SET-062 rules | "is re-checked whenever the window comes back into focus" |

Extra five-word pass against README.md, HANDOFF.md, HANDOFF-HISTORY.md and the English UI string catalogue (4,135
windows): 6 near-copies. Reworded anyway, not counted as hits: "many commands ship with no" (scope paragraph),
"colour theme and app font" (SET-004), "Ctrl on Windows and Linux" (SET-013, created by the first rewrite),
"the file on disk is" (SET-011 acceptance), "the rest of the app" (SET-027). Kept on purpose: "Ask Before Closing
Running Terminals" (SET-043), a five-word switch label the user clicks.

## Final script line

`firewall-check: 0 hit(s) across 1 file(s)`

## Allowlist candidates (not edited; owner decides)

- Keybinding command ids with capitals, withheld from the spec: worktree.quickOpen, app.forceReload,
  workspace.selectByIndex, sidebar.focusWorktreeList, tab.previousRecent, tab.selectByIndex, terminal.splitRight,
  terminal.splitDown, view.cycleWorkspaceView, terminals.focusNextNeedsYou, tab.newAgent, sidebar.ports.toggle,
  workspace.openBoard, sidebar.sleepingWorkspaces.toggle, floatingWorkspace.minimize, tab.openQuickCommandsMenu,
  sourceControl.sendReviewNotes, terminal.equalizePaneSizes, terminal.setTitle, terminal.clearPaneTitle,
  terminal.switchInputSource
- `re:^tab\.newAgent\.[a-z0-9-]+$` — per-agent new-tab ids (same candidate as area 02)
- `re:^[a-z]+(\.[a-z][A-Za-z0-9]*)+$` — one rule for every dotted keybinding command id, so ids can sit in backticks

## Residual risks

1. SET-019 acceptance: the card said two presses of zoom-in make the interface "about 44 % larger", but the critic-r1
   rule says each press is half a level (×1.2 per whole level), so two presses give about 20 %. The spec follows the
   rule ("roughly 20 % larger (one whole level)"). Owner or critic to confirm.
2. Keybindings-file compatibility: 21 command ids (plus the per-agent form) are named only in words until the
   allowlist accepts them, and the full 129-id default table lives in a dirty-room registry the clean room cannot
   read. The spec carries every bound default the card lists and the named unbound commands; the rest needs an
   owner-approved id list.
3. Old settings import: SET-001/002/005/014/015/017/027/032/035 promise that saved choices import, but the old key
   names and value spellings are withheld (old-app schema). The clean room cannot read an old settings file without
   an owner-approved mapping table.
4. Lower-case dotted keybinding ids pass the script but are old-app identifiers; kept on purpose because users'
   `~/.kolux/keybindings.json` files are keyed by them (same choice as specs 01 and 02).
5. Product names kept as behaviour: the 16 hue names, the three app icon names (Classic, Watercolor, Blue), the
   language list, short labels the user clicks (Match app theme, Kolux first, Terminal first, Reload from Disk,
   Default Compare Base, Show Titlebar App Name, Restart daemon, Open Manage Sessions, Setup failed, Yolo).
6. Third-party names kept as plain text (not artwork): Warp, Ghostty, GSD, Cascadia, Tango, Mission Control, OSC 52.
7. Tier/theme tension carried from critic r3 (SET-031, SET-033 pushed 2; SET-034 pushed 3; SET-059 pushed 4 but P1/P2)
   is left for the priorities stage.

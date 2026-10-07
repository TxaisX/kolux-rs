# Verbatim sections from HANDOFF.md (Last updated: 2026-10-05 per file header)

## Recent work

Newest first. Full write-ups, verification notes and the older "Recent work, and why" /
"What is verified" logs are in [`HANDOFF-HISTORY.md`](./HANDOFF-HISTORY.md); read the entry
you need, not the whole file.

- 2026-10-06: Close-out — security gaps from the abandoned `fix-ipc-security` branch ported (network-share link/probe guards, CDP secret path, executable detection, WSL paths local again), agents-view Thought rows, clean-look polish; full suite + lint + tc green bar 2 known failures; report `docs/research/closeout-2026-10-06.md`
- 2026-10-06: Audit fix wave landed — P1/P2/P3 fixes, lint chain green, ~3.5k lines dead code gone, automatic releases to public TxaisX/kolux-releases on every `ship --main`, Artifacts library inside Kolux
- 2026-10-05: Terminal resource-usage wave — dev server ~50% less memory (no main sourcemaps in dev), hidden tabs join the 6-context WebGL cap, leaking test fixture fixed, dev server exits when its launching shell dies; report `docs/research/terminal-resource-usage-2026-10-05.md`
- 2026-10-05: Every pane header always shows title + usage %; Sessions −/+ stepper and status-bar Claude/Codex usage removed (usage lives top right)
- 2026-10-05: Clean look = rounded session windows (14px, 8px gaps, header ⋯/expand/+/× on every pane, expand-to-fill + restore), sidebar card, weekly-only usage pill, no session stepper (shortcuts kept), no status-bar usage, Claude defaults to `--permission-mode auto`
- 2026-10-05: Terminal-grid pane footer removed entirely — no strip under terminal panes; Board keeps its own permission buttons
- 2026-10-05: Originality cleanup — upstream names scrubbed, cloud-only features removed, update nudge removed
- 2026-10-05: Terminal-grid message bar removed — Swarm pane footer keeps status + Approve/Deny/Answer only; typing goes to the terminal, the Agents view keeps its composer
- 2026-10-05: Redesign landed + design-gap pass — rd-* merged to main; full-width top bar, no classic sidebar on Agents/Board, Swarm "Open file"/Approve-Deny, pane-header context %, `--agent-working` token
- 2026-10-05: Trimmed features — desktop Voice/dictation, Kolux Account and Input settings removed (Mobile kept)
- 2026-10-05: No theme/font flash at startup — main window paints saved theme + font before first render
- 2026-10-05: App colour themes — opt-in 16-hue picker (Classic stays default), terminal "Match app theme"
- 2026-10-05: Pane header (new look) — git branch chip, "Done · 3m ago" + glow on unseen finished panes, narrow-pane hiding order
- 2026-10-05: Session usage meter — context vs 200k + plan usage on Board cards, tabs, Agents view
- 2026-10-05: Dashboard pop-out window and Agent Map retired (drawer kept)
- 2026-10-05: Limit auto-resume — opt-in, Claude continues after its usage limit resets
- 2026-10-05: 200k context cap — Claude and Codex sessions auto-compact at 200k (on by default)
- 2026-09-29: Protected actions — Claude pauses before dangerous commands (PROD-7)
- 2026-09-29: Terminal/workspace restore across quits and a killed daemon (WORK-1)
- 2026-09-28: Claude sign-in opt-out (ACCT-7)
- 2026-09-24: release 0.11.0
- 2026-09-24: CI on main is green again
- 2026-09-23: review the plan before Claude runs it (v1)
- 2026-09-23: OpenCode support removed entirely
- Current handoff: improvement pass for Claude (2026-09-22)
- 2026-09-23: automations can start on an event
- 2026-09-22: one WebGL hiccup no longer slows every new terminal
- 2026-09-22: a quieter left sidebar
- 2026-09-22: per-provider model routing tiers for orchestration workers
- 2026-09-22: one worktree per agent, `pnpm ship` does the git work
- Current pass: the product is renamed Nightshift → Kolux
- Previous pass: Codex access, account authorization, and automatic updates

## Known gaps

- **Sidebar agent rows are dead code.** The sidebar lists sessions now, but
  `sidebar/WorktreeCardAgents.tsx` and its four tests remain; the only live import is the
  `SUPPRESS_WORKTREE_LIST_SCROLL_ADJUSTMENT_EVENT` constant in `use-scroll-suppression.ts`.
  Move that constant, then delete the file and its tests.
- **Standalone terminal-window scrollback resync** previously appended a replacement
  snapshot to the old xterm buffer after resize. The window now resets its buffer before
  replay, guarded by a headless terminal regression test. This standalone window surface
  is dormant in the current pane-based UI, so the fix has not had a live UI repro.
- **The earlier SSH terminal-window restore claim was stale.**
  `restoreLiveTerminalSessionWindows` has no production caller, and the renderer has no
  `terminalWindows.open` caller. Active main-window SSH panes use the persisted remote
  session IDs and a separate reconnect path; no failure in that path was reproduced here.
- **Layout presets** now cover the active terminal-pane grid as well as the tab-group
  tree. The pane path preserves mounted pane and PTY identities — runtime-verified
  2026-09-23 by driving the real `kolux-split-terminal-pane` /
  `kolux-arrange-terminal-pane-grid` events and diffing `data-pane-id`/`data-leaf-id`/
  `data-pty-id` before and after. Still not exercised with WebGL or existing scrollback
  present, or through the actual dropdown-menu click path (the pane header's split
  button and the "Pane Actions" menu are hover/opacity-gated and did not resolve as
  clickable in a hidden/background CDP window; the events they dispatch are the same
  ones driven here).
- **Orchestration control is still intentionally split.** The dashboard now exposes a
  read-only Runs/tasks view with refresh and pagination; creating or routing work still
  happens from the coordinator terminal/CLI. Do not describe the new panel as a full
  dispatcher. Runtime-verified 2026-09-23: with the experimental setting on, the Runs
  view rendered the legacy local run and its read-only detail pane.
- **The agent dashboard is off by default** behind "Experimental agent dashboard popout".
  Until that setting is on, its shortcut does nothing and its row is hidden in the shortcut
  list, which reads as a broken key rather than a disabled feature. This pass only enabled
  it on a throwaway dev profile to verify the Runs view; the shipped default is unchanged,
  so this gap stands.

## Verification limits carried into the next session

- The full suite remains noisy on this Windows machine (happy-dom fork-worker failures,
  missing `/bin/sh`, occasional `EPERM`/`EBUSY`). Use focused suites locally and Linux CI
  (now green, 4 shards) for the whole repository; `gh workflow run CI --ref <branch>` runs
  it on a pushed branch before landing on main.
- The cross-version release checkout is deliberately skipped on Windows because extracting
  a tagged release hangs on OneDrive. Keep the test enabled on Linux; do not “fix” this by
  weakening the wire journey.
- No packaged `dist/win-unpacked/Kolux.exe` exists in this worktree, so the release smoke
  script could only be reviewed, not executed locally.
- A real browser authorization flow and a live hidden-renderer/CDP check of the new UI
  surfaces are still outstanding.

# STATE
Status: RUNNING            (RUNNING | PAUSED | BLOCKED: reason)
Phase: 3                   (Phase 1 was done by the dirty-room team on 2026-10-06; Phase 2, the plan, on 2026-10-07)
Budget: 6 passes per day   (today: 3, date: 2026-10-08; Txais lifted the cap for today)
Next task: T-004 · One agent in its own worktree: the plus menu starts Claude Code in a new pane inside a fresh worktree with a creature name; the pane header shows the agent and the branch
Done: 4 / 339 tasks  ·  P0 parity: 0/228 cards

How to read this: `PLAN.md` holds the 339 tasks in build order; each names the spec cards it must
make pass. Progress is counted in tasks ticked there and in P0 cards whose acceptance boxes all pass.
`node scripts/plan-check.mjs` proves the plan still covers every card exactly once.

What works today: the window has no Windows title bar; Kolux draws its own 36 px top bar with the
six-spoke mark, a sidebar toggle, the centred Agents / Board / Terminals switcher (Terminals is the
screen with content; the other two show their name and "nothing here yet"), a search box with the
Ctrl+Shift+J chips, a bell, a usage pill with the Claude and Codex marks, and its own minimize,
maximize and close. The sidebar is a floating rounded card; the pane sits in a rounded card with
the header composition from the design (status icon, agent mark, folder name, `main` branch chip,
"PowerShell", status word, gauge, menu, expand, split, close); a Layout 1/2/4/6 strip sits above
it (only 1 works) and a 24 px status bar below shows On, the app's memory use (from a Tauri
command), the shell count and the plug count. Colours, sizes and type come from design/DESIGN.md
through CSS custom properties in src/theme.ts; evidence/T-003b-compare.png is the pixel
comparison with the reference. The window opens with one terminal pane running Windows PowerShell. Typing
reaches the shell, output comes back, the pane follows the window size, the status icon's tooltip
says whether the GPU (WebGL) or the plain renderer is drawing, and Close ends the shell and shows "Ended".
Closing the window kills every shell it started.

A sidebar on the left lists projects. Add one by typing or browsing to a folder that holds a Git
repository (anything else is refused with a plain message; the same repository is never added
twice). Each project lists its main checkout and its workspaces (Git worktrees). Type a name such
as "Fix login" and the sidebar shows the branch and folder it will get (`fix-login`, under the
workspaces folder, inside a folder named after the project); Create makes the branch and folder.
Shell restarts the terminal pane inside that folder. Remove asks first, then deletes the folder and
the branch, closing any pane still sitting in that folder. The workspaces folder can be changed and
is remembered; projects are remembered across restarts.

## Needs Txais

13 open decisions in `DECISIONS.md` section 2 are marked "confirm". The loop builds each one's
recorded default until told otherwise; nothing here blocks a pass.

| ID | The call, in one line | Default the loop builds |
|---|---|---|
| OD-01 | Does Kolux call the AI provider's sign-in and usage services itself? | No: browser sign-in only, Claude renewal switched off, usage read from running sessions |
| OD-06 | Fork pull requests: keep the push and pull fallback a fork workspace needs? | Keep it; only the per-repository fork sync setting is cut |
| OD-08 | Mobile page | Cut (went with area 18) |
| OD-09 | One control tower overview of every agent | Skip for parity; Agents screen is the overview; Phase 4 candidate |
| OD-10 | Changed-files list: Mod-click and Shift-click select rows, or open in a split? | Selection wins; Alt-click and the row menu open in a split |
| OD-11 | Quick account switcher | Skip; accounts are added and listed without one |
| OD-12 | WSL | Nothing runs inside a distribution; WSL-stored projects open as local folders |
| OD-14 | Shared folders and archive script in a repository's kolux.yaml | Keep both entries; only the per-repository settings controls are cut |
| OD-15 | GitHub Projects roadmap timeline (half-done) | Show the unsupported notice |
| OD-16 | GitHub star prompt | Off until Kolux RS has a public repository of Txais's |
| OD-18 | Browser knobs after the browser settings page cut | Fixed defaults with toolbar-menu controls |
| OD-20 | Does the old app's update feed hand users over to Kolux RS? | No; own feed, manual first install, importer on first launch |
| OD-21 | Bundle the 24 department agents as default suggestions? | Not bundled; suggestions load from a folder the user points Kolux at |
| LOOK-1 | Bundle the UI and terminal fonts (Inter, JetBrains Mono / Cascadia Mono)? Their licence (SIL OFL 1.1) is not on the LOOP.md licence list | Not bundled; system font stacks only (Segoe UI, Cascadia Mono / Consolas), so the look depends on the fonts installed on the PC |
| LOOK-2 | Vendor marks: keep Anthropic's Claude Spark (from its public press kit, no terms shipped) and the hand-redrawn OpenAI knot (openai.com/brand refused every fetch, terms unread) as model indicators in a public release? | Kept, as nominative use; see src/assets/vendors/NOTICE.md |

## Decisions made for Txais

- 2026-10-07 · Task size: tasks group neighbouring cards of one tier, theme and area, at most 4 P0
  cards, 5 P1, 6 P2 or 5 H cards per task. That gives 338 tasks; at 6 passes a day the plan runs
  about 57 days if every task takes one pass. A task that proves too big is split in place.
- 2026-10-07 · Duplicate cards not covered by DT-39, built once with the owner named first by
  SPEC.md section 4: the jump-to-next-session command is built to TERM-030 (STAT-051 and VIEW-047
  pass against it); keep-awake is built to TERM-122 (VIEW-097, BROW-053 and APP-018 pass against it).
- 2026-10-07 · Two moves under the build-order rules: the shortcuts file and default chords
  (SET-011, SET-013) come right after the walking skeleton, because every later keybinding is
  pressed through that file; sealed secrets (ACCT-009) open the theme 4 block, because rule 10 says
  secrets are never stored in plain text first.
- 2026-10-07 · The walking skeleton launches Claude Code as its one agent: it is installed on this
  PC and is the agent the old app was pushed hardest on.
- 2026-10-07 · The firewall script is a gate for the spec files, not for loop artifacts. Run on
  PLAN.md it reports 18 hits, all of them the stack names LOOP.md fixes (Vite, React, xterm) and
  backticked commands; none is an old-code identifier. Recorded here rather than weakening the script.
- 2026-10-07 · No new source was used in this pass (spec files in this repo only), so PROVENANCE.md
  section 5 gets no line.
- 2026-10-07 · T-001: the app identifier is `com.txaisxiong.kolux-rs`, so the profile folder is
  `%APPDATA%\com.txaisxiong.kolux-rs` and never collides with the old app's `%APPDATA%\kolux`.
  State store = `state.db` (SQLite, WAL) plus `settings.json` written atomically; both open at
  startup. Our own crate carries `license-file` and `publish = false`; cargo-deny ignores private
  crates, the allow-list applies to dependencies only. Window evidence is captured with
  PrintWindow (renders the window itself), because a screen grab caught the game Txais was
  playing instead; that image was deleted before anything was committed.
- 2026-10-08 · T-002: the pane runs Windows PowerShell 5.1 (`powershell.exe -NoLogo`, the one every
  Windows install has) starting in the user's home folder; PowerShell 7 (`pwsh`) is not on this PC's
  path, so picking between them waits for the shell-choice card. Shell output crosses to the
  page base64-encoded so a character split across two chunks is never garbled. The renderer choice
  is GPU first, plain on any failure (TERM-103's "Auto"); the on/off override and the six-context cap
  come with the grid task (T-009), when there is more than one pane. Closing a pane ends its shell
  at once; the "ask first when a program is running" rule from TERM-014 is built with the pane
  header and the close keybinding, not here. The Close button shows the exit code when it is not
  zero (a killed shell reports 1), so a crash is never mistaken for a clean exit.
- 2026-10-08 · Proof routine for typing into the window: keystrokes are posted straight to the
  app's own web view window, never through the shared keyboard, so a check never types into
  whatever Txais has in front of him. (One early attempt used the shared keyboard route; the
  window was not in front, so the text "echo kolux-rs-ok" may have landed in another program.)

- 2026-10-08 · T-003: the default workspaces folder is `%USERPROFILE%\kolux-rs\workspaces`
  (PROJ-025 says "a workspaces folder inside a kolux folder in the home folder"; the `-rs` keeps it
  apart from anything the old app made). New workspaces use the nested layout
  (`<root>\<project>\<name>`); the flat layout and the per-project folder wait for the settings page.
  Every Git action runs the `git` program found on the path (checked once at startup; the sidebar
  shows its version); there is no bundled Git. A new workspace branches from the current HEAD of
  the main checkout; the base-ref chooser is T-013. Name cleaning: lower-case, spaces and
  punctuation become hyphens, repeated dots shrink, accented and non-Latin letters stay, fourteen
  common emoji become words (fire, rocket, bug, sparkles, star, heart, bulb, wrench, tada, check,
  zap, test-tube, memo, lock); other emoji are dropped rather than carrying a full emoji table.
  Removing a workspace first ends any terminal pane started in that folder, because Windows will
  not delete a folder a running shell sits in (seen live: the first removal attempt failed with
  "Permission denied" until this was added). A project can be added with the system folder picker
  (Browse, several folders at once) or by typing a path; the picker is the Tauri dialog plugin.
  Removing a project from the list is PROJ-008, not built yet; the pass's test project was cleared
  by deleting the fresh `state.db` (it held only the start counter and that one entry).
- 2026-10-08 · Evidence harness: `scripts\evidence\shot.ps1` and `type.ps1` are now in the repo
  with a README. Characters are posted to the web view one every 120 ms; faster loses keystrokes
  while the page re-renders (seen live twice).

- 2026-10-08 · Txais: the look is pulled forward. After seeing evidence/T-002.png he asked that the
  app "look exactly like what we have running these sessions right now", so T-003b (the visual
  shell) was inserted after T-003 ahead of theme 7, built from design/DESIGN.md, a pixel-measured
  description of the running 0.15.0 window written by a designer who only photographed it (no old
  code read). Later theme-7 tasks finish each card properly; T-003b only sets the look.
- 2026-10-08 · Txais: vendor marks are used as model indicators (nominative use), sourced from
  public brand kits, never from the old app; X cards SESS-044/TERM-131/VIEW-104/SET-048/HID-040 are
  reinterpreted accordingly (coordinator will reword PLAN.md T-335 after this pass).
- 2026-10-08 · Kolux's own mark stays the six-spoke asterisk (vertical plus two diagonals, `#c5c5c5`)
  drawn inline in src/chrome/icons.tsx; app-icon.svg is untouched.
- 2026-10-08 · No bundled font files: Inter, JetBrains Mono and Cascadia Code are SIL OFL 1.1, which
  LOOP.md's licence list does not name, so the app uses system stacks (LOOK-1 above). Measured
  text therefore differs by a pixel or two from the reference where the installed font differs.
- 2026-10-08 · Default screen is Terminals, although VIEW-001 says Board when none was chosen;
  Terminals is the only screen with content until the Board task, and VIEW-001's own task will
  flip the default. Layout 2/4/6 buttons draw but do nothing until T-009.
- 2026-10-08 · The renderer note ("GPU renderer" / "plain renderer") moved from header text to the
  tooltip of the pane's status icon so the header matches the design's composition.
- 2026-10-08 · Usage pill reads "Claude · unknown  Codex · unknown" with each vendor's mark until
  accounts and usage reading are built; its tooltip says so.
- 2026-10-08 · Memory in the status bar is this process's working set (K32GetProcessMemoryInfo),
  formatted by src/status/memory.ts ("717.9 MB", "1.50 GB"); the old app's exact source for that
  number is unknown and was not looked up.
- 2026-10-08 · Pane and sidebar corners are 12 px as DESIGN.md says; the reference's curve runs one
  pixel longer (about 13 px). Left as is, within the 2 px tolerance.

## Last 10 passes  (date · task · result · evidence)

- 2026-10-07 · Phase 2: write PLAN.md · done: 338 tasks covering 1,030 cards (228 P0, 564 P1, 199 P2, 27 H marked build, 12 X), no dropped card · `node scripts/plan-check.mjs` prints OK
- 2026-10-07 · T-001 · done: Tauri 2 window opens, SQLite state store and JSON settings under the profile folder, cargo-deny and JS license gates green, build/clippy/test/vitest green · evidence/T-001.png
- 2026-10-08 · T-002 · done: one PowerShell pane through a Rust PTY, drawn by xterm.js on the GPU with a plain fallback; typing, resize (shell reports 166x54 after the window grew) and Close all proven live; no shell left behind after Close or after closing the window; 4 Rust tests and 9 front-end tests green · evidence/T-002.png
- 2026-10-08 · T-003 · done: projects sidebar; a throwaway repository added as a project, "Fix login" created as branch `fix-login` in its own folder (confirmed with `git worktree list`), the pane opened inside it, then removed with a confirm step and both branch and folder gone on disk; 15 Rust tests (git runner round trip, name cleaner, project store) and 13 front-end tests green · evidence/T-003.png, evidence/T-003-removed.png
- 2026-10-08 · T-003b · done: frameless window with its own top bar, switcher, search box, usage pill and window controls; floating sidebar card; layout strip; rounded pane card with the design's header; status bar with live memory; palette from DESIGN.md as CSS custom properties; measured against the reference at 1920x1032: top bar 36 px, sidebar x 8..296, pane card from y 84, status bar from y 1008, all six background hexes exact, corners 1 px tighter; 16 Rust tests and 18 front-end tests green · evidence/T-003b.png, evidence/T-003b-compare.png

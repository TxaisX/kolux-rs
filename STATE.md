# STATE
Status: RUNNING            (RUNNING | PAUSED | BLOCKED: reason)
Phase: 3                   (Phase 1 was done by the dirty-room team on 2026-10-06; Phase 2, the plan, on 2026-10-07)
Budget: 6 passes per day   (today: 25, date: 2026-10-09)
Next task: T-152 · Hooks go only to agents that are installed and switched on, and installing them never damages the user's own settings (STAT-004, STAT-005; first open task on the cutline)
Done: 481 / 700 tasks  ·  P0 cards passing: 6 / 228 cards  ·  cutline 2 / 18 left  ·  merge gate 41 waiting  (node scripts/plan-check.mjs --write-state)

How to read this: `PLAN.md` holds the 533 tasks in build order; each names the spec cards it must
make pass. Progress is counted in tasks ticked there and in P0 cards whose acceptance boxes all pass.
`node scripts/plan-check.mjs` proves the plan still covers every card exactly once.

What works today (2026-10-11; the paragraphs below this one are the task-by-task record): a
Windows desktop app (Tauri 2, Rust + React) with its own 36 px top bar: the Kolux mark, a sidebar
toggle, the Agents / Board / Terminals switcher, a search box showing the palette chord, a bell
that opens the Inbox, a usage pill with live Claude and Codex figures (it opens Settings > AI
connections), and the window controls. Terminals is a grid of 1 to 12 panes per workspace (the
Layout 1 / 2 / 4 / 6 strip, split right / down, close, tabs per cell, browser tabs beside the
terminals), each pane a PowerShell, Claude Code, Codex or other installed agent through a Rust
PTY and xterm.js (WebGL when the GPU allows). Board shows the same panes as cards in lanes (Needs
you, Working, Done, Stopped, Idle) with a chip saying what each agent is doing, Approve / Deny on
a card that waits for permission, and the live terminal inside an expanded card. Agents lists
the sessions under each saved agent (unmatched ones under Other sessions) with a status word and
a context ring on each row and the picked session's 5-hour figure in a footer, shows the picked
one's terminal or chooser, and adds a not-started preset with + (its chat body waits for T-050-b). The
Inbox lists what needs you, what is running and what finished
today. Agents report their own state through hooks Kolux installs for Claude Code and Codex
(permission, question, working, done, blocked, interrupted; subagents under their lead), with
one status vocabulary for every dot, chip and label, desktop notifications on finish and
permission, a quiet-terminal alert, tab and workspace unread marks, and a pane header with the
agent mark, name, branch (a detached checkout shows its short commit; a plain folder no chip), program, status word and gauge. Its "..." button or a right-click opens the pane menu (expand, split right or down, close); expand or Ctrl+Shift+Enter makes the pane fill the workspace and the same again restores every pane, terminals and their scrollback untouched. Dragging the line between two panes resizes them live (the 6 px divider of DT-A7), a release outside the window ends the drag where it was, and a narrow pane drops its branch chip, program word, buttons and status word in that order while the dot, mark and name stay. A tab's right-click menu closes it, the others, those to its right or left, or all (Ctrl+Alt+W), middle-click closes a tab, and closing the active tab goes back to the tab used before it. The command line answers in tens of milliseconds over the loopback port and an ask or waiting check stays up for minutes; removing a worktree ends its shells and everything they started, proves them gone, and refuses (unless forced) when one stays. Claude Code in a pane is made to ask before a force-push to main, a hard reset or forced clean, a database drop or truncate, a Stripe change, an infrastructure apply or destroy and a production deploy, each rule switchable in settings.json (the Safety page follows). A recursive delete aimed outside the workspace asks too, and every protected rule sees through wrappers, chains, substitutions, nested shells and encoded PowerShell. Paths on other machines are refused as text before any disk call, and a file handed to the system is revealed in its folder instead of run when it is a program. Discarding work in Source Control asks first, worded for what goes, and never follows a link out of the repository. File access stays inside your projects: a path outside them, or leading out through a link, is refused before the disk is touched, and one file at a time can be allowed for the run. The local endpoints agents' tools use answer only Kolux's own tools: a web page, another host or a bare connection gets nothing. The app keeps a short, capped, user-only log of its own starts, exits and terminal sessions; Settings > General > Diagnostics copies it with secrets masked or writes a review copy to look at and throw away. Settings > General > Privacy says the work stays on the computer, lists every connection the app makes, and Send feedback opens a pre-filled GitHub issue page in the browser instead of sending anything. Quit and reopen: every workspace's tabs and layout come back, a damaged saved entry is dropped on its own and the rest kept, and the workspace and tab that were active are active again while they still exist. A Claude Code or Codex tab comes back on its own session (the agent's resume command with the id its hooks last reported), after a quit or a kill alike.

## Needs Txais

13 open decisions in `DECISIONS.md` section 2 are marked "confirm". The loop builds each one's
recorded default until told otherwise; nothing here blocks a pass.

- [accounts] 2026-10-09 · Resolved: the T-043-a live check made a real 1-year Claude Code key on
  Txais's account (stored sealed, removed with Disconnect two minutes later, never read or printed).
  Txais said the same evening that this was intended, not accidental; the key stays and no builder
  should ask for it to be revoked. Live checks still use stand-in programs and fake keys.

- [accounts] 2026-10-11 · Token analytics (T-136-b's USAGE-012 / 013, T-137) read the Claude Code
  and Codex logs on this PC. Claude Code's public docs say its transcript format "is internal
  ... and changes between versions", and Codex documents none, so a clean-room build has nothing
  public to parse against. Options: (a) let a builder read the shape (field names only, never the
  text) of a few of your own `~.claudeprojects` and `~.codexsessions` files; (b) count
  tokens only from what Kolux sees live; (c) leave token analytics out. Until you pick, T-136-b
  and T-137 stay unbuilt. USAGE-011's activity counts also wait for the status hooks (T-025).
  RESOLVED 2026-10-12: Txais chose (a). A builder may read the FIELD NAMES and value types (never the
  message text, prompts or paths) of a few of his own ~/.claude/projects/*.jsonl and ~/.codex/sessions files,
  record the observed shape with a date in PROVENANCE.md section 5, and parse defensively (unknown fields
  ignored, format changes degrade to "unknown", never crash). T-136-b, T-137 and T-140 are unblocked.

- [accounts] 2026-10-13 · Interface languages (T-210-b, SET-017's rest): the language choice and its
  dates, weekday names and sort order are built (T-210-a), but every menu and screen is still English.
  DT-A5 ties translation to language packs, and SKILL-040 cut those with the plugin runtime. Bundled
  packs would mean pulling every screen's text into lookup tables and writing five translations
  (Simplified Chinese, Korean, Japanese, Spanish, French) with nobody to check them. Pick one:
  (a) build bundled packs, machine-translated and marked as such; (b) build only the lookup and the
  English fallback now, packs later; (c) cut the rest of SET-017 and show the choice as dates-only.
  Until you pick, T-210-b stays unbuilt.
  Answered 2026-10-13 (relayed): (b). T-210-b is unblocked; DECISIONS.md DT-C30.

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
| LOOK-2 | Vendor marks: keep Anthropic's Claude Spark (from its public press kit, no terms shipped) as a model indicator in a public release? And may someone fetch OpenAI's kit file by hand (openai.com/brand refuses every automated fetch)? | Spark kept, as nominative use; the hand-redrawn OpenAI knot was removed the same day (not a kit file, so outside the "public brand kits only" rule) and Codex shows Kolux's neutral spark glyph until a kit file arrives; see src/assets/vendors/NOTICE.md |

## Decisions made for Txais

- 2026-10-12 · [release] T-105 · kolux-dev terminal list, show, create, split, rename, switch (focus) and close now work against the open window; new terminals stay in the background unless asked, close confirms each program stopped and leaves the caller's own terminal open, and terminal stop is a hidden alias (DT-R37).
- 2026-10-12 · [release] T-104-a · A pane with no program starts the best shell that will run (PowerShell 7, Windows PowerShell, then the command prompt in UTF-8), the header names the one that started, panes no longer inherit Kolux's own build variables, and a folder that is gone, unplugged or a drive root (for agents) gets a message (DT-R36).
- 2026-10-12 · [release] T-103-a · Terminals you are not looking at stay alive rather than being parked to save memory, so they come back exactly as left (DT-R35).
- 2026-10-12 · [release] T-101-a · New workspaces can start with several empty panes (never in the classic look or on reopen); a started session fills an empty pane first; Ctrl+] and Ctrl+[ move the keyboard between panes, wrapping (DT-R34).
- 2026-10-12 · [release] T-100-a · Effort and fast mode only on Claude models; Claude Code with nothing picked starts on Opus at high effort unless its own arguments name a model or effort; the last lineup is kept per project once an agent really starts (DT-R33).
- 2026-10-12 · [release] T-098 · Keyboard moves follow the sidebar as shown; history keeps 50 places; the palette's Create workspace row opens the name field prefilled instead of creating at once (DT-R32).
- 2026-10-12 · [release] T-205 · Earlier kit results are copied, not moved, into a dated folder; the run record is hidden in kit-results; waiting roles are checked every ten seconds (DT-R31).
- 2026-10-12 · [release] T-204 · Kit roles fall back round the connected AIs, results go to kit-results, samples live in kolux-rs\samples under their own Git name (DT-R30).
- 2026-10-12 · [release] T-203 · Secret-looking files are left out of a first commit by name, not content, and the user's own Git identity signs it (DT-R29).
- 2026-10-12 · [release] T-202 · Disconnect deletes only what Kolux made and always asks first; for a login the user made it only explains how to sign out in that tool, and removing the active Codex account leaves none active (DT-R28).
- 2026-10-12 · [release] T-185-a · The installed CLI is a kolux.exe plus kolux.cmd shim in the install's bin folder, built only by the release script; only a refused connection means the app is down, lost answers print an exact --retry-request command, and reset takes exactly one scope (DT-R27).
## Last 10 passes  (date · task · result · evidence)
- 2026-10-13 · [main] T-543-b · done: no default pane, 5 unbuilt controls hidden, real hooks badge, Codex pill needs an account, Reopen closed tab unbound and hidden (T-164-b not wired), first screen Terminals (DT-C40); smoke 5/5 first run; evidence/T-543-b.txt
- 2026-10-13 · [main] T-543 · done: App.tsx agent status, settings, workspaces, palette/notice/toast, kits and wizard moved into six hooks as they were, hook order unchanged; lib.rs save_settings deleted, setup log lines go to diag, handler list grouped by module (per-module start() left: needs files outside the pass) · evidence/smoke-2e6821b.txt + evidence/smoke-97bb712.txt
- 2026-10-13 · [accounts] T-265-b · not started, left open: the proof needs a real Claude agent going idle, and live checks may not launch agent CLIs; Needs Txais to run it once (the steps are on the PLAN line)
- 2026-10-13 · [accounts] T-043-f · not started, left open: reading Claude Code's keychain entry names from a real install, the system security tool and the live proof all need a Mac, and this PC is Windows
- 2026-10-13 · [accounts] T-206-c · not started, left open: there are no remote or SSH workspaces in the app, and no PLAN task builds them, so there is no workspace for the kit entry point to be hidden in; build it with remote workspaces
- 2026-10-13 · [accounts] T-201-d · not started, left open: a web search on 2026-10-13 again found only the TRAE editor (trae.ai, docs.trae.ai) and third-party pages, no official TRAE CLI page to check a docs link against; add it to install_page when one appears
- 2026-10-13 · [accounts] test-folder leak · fixed: the key test and the command-line account tests now use the self-removing test folder (test_dir.rs), which also retries its removal for a moment, since Windows can hold a just-closed database; a full cargo test run left no kolux-key or kolux-rs-cli-acct folder in the temp folder. Other tests still leave folders (cli.rs dry/cli038/cli117/cli118/cli/cli129, projects.rs proj-*, scm.rs gh-hang/bare/other/remote, files.rs krs-files-*): not accounts code, left to their lanes
- 2026-10-13 · [accounts] T-265 · done: cache.ts (promptCacheTimer, promptCacheMinutes, cacheDue over idle Claude panes, cacheShown), CacheTimer.tsx on the sidebar row via RowInfo.cache, Agents page CachePick; DT-C19; T-265-b split (live card proof needs a Claude pane) · evidence/T-265.txt, T-265-1-prompt-cache-timer-on-1-hour.png
- 2026-10-13 · [accounts] T-264 · not started, left open: ACCT 022 picks the Codex folder that past-session history and resume read, but neither exists yet (T-168, T-169), so the field would change nothing; noted on T-169. ACCT 028 (MiniMax cookie or key) and ACCT 029 (Gemini CLI sign-in) are there only to ask those providers' usage services, which OD-01 turns off (confirm); build them if OD-01 is reversed
- 2026-10-13 · [accounts] T-263 · done: countdown drops zero parts and says under 1m, nextTick + useResetTick tick both pills; meter.ts PERCENT_FIELD/percentMode/shownPercent and the Usage percentages choice on Appearance; T-263-b and T-263-c split · evidence/T-263.txt, T-263-1-pill-with-an-invented-report.png, T-263-2-usage-percentages-choice.png

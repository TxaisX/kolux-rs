# PLAN

The ordered task list for the Kolux RS build loop. One task per pass. Written 2026-10-07 by the
loop from `SPEC.md`, `PRIORITIES.md` section 4 and `DECISIONS.md`; `node scripts/plan-check.mjs`
proves every P0, P1, P2 card, every H card marked build and every X card is here exactly once and
no dropped card is.

## How to read a task

- `- [ ] T-nnn · CARD [compat] title · CARD title …` One line per task. A task is done when every
  acceptance box on every card it names passes in Kolux RS; tick the box and write the evidence path
  in `STATE.md`. `[compat]` means the card carries a contract kept exactly (`COMPAT.md` wins on spelling).
- `also passes:` lists cards that describe the same behaviour as this task's owner card
  (`DECISIONS.md` DT-39 and `SPEC.md` section 4). Build once; their checks must pass against the same build.
- Tasks group neighbouring cards of one tier, theme and area. If a task turns out too big for one
  pass, split it in place (`T-nnn-a`, `T-nnn-b`) and keep going; if it fails three passes, mark it
  `SKIPPED: reason` and list it under Needs Txais in `STATE.md`.
- Sort rule (`PRIORITIES.md` section 4): walking skeleton, then P0 by theme rank
  1, 2, 3, 4, 7, 5, 9, 11, 8, 6, 10, then P0 with no theme, then P1 and P2 the same way, then the 27 H
  cards marked build, then the 12 X cards. Inside a theme, cards sort by area number then card number.
- Moves under rule 12 (a later card pulled forward because earlier cards cannot pass without it) are
  marked `moved:` on the task and listed in section 0.

## 0. Walking skeleton

One window, one terminal running PowerShell, one agent in its own worktree. These tasks lay the
foundations every later card stands on; the cards they touch are finished in their own tasks later.

- [x] T-001 · Tauri 2 shell: Rust crate plus Vite React front end builds and opens one window on Windows; state store (SQLite for app state, JSON for user settings under the profile folder); `cargo deny` license policy (MIT, Apache-2.0, BSD, ISC, Zlib, MPL-2.0, Unicode) and the JS license check; `cargo build`, `cargo clippy -- -D warnings`, `cargo test`, `pnpm test` all green on an empty app. Evidence: `evidence/T-001.png` of the window. Touches the saved-as-you-go rule (theme 9).
- [x] T-002 · One terminal pane: a PowerShell session through a Rust PTY, rendered by xterm.js with WebGL and a safe fallback, typing and resizing work, closing the pane ends the process. Touches the grid, close-pane and GPU-rendering cards (theme 1 and 9).
- [x] T-003 · One project and one worktree: pick a git folder as a project, create a workspace on a new branch in a folder of its own under a chosen workspaces folder, remove it again (git CLI). Touches the add-project, create-workspace and workspaces-folder cards (theme 2).
- [x] T-003b · moved: by Txais's call 2026-10-08 · Visual shell: the window looks like Kolux at 0.15.0 from the first screen (design/DESIGN.md). Frameless window with in-app min/max/close; 36 px top bar with the centred Agents/Board/Terminals switcher, search box and usage pill placeholders; floating sidebar card; Layout 1/2/4/6 strip; rounded pane cards with the pane header composition and focused/unfocused borders; 24 px status bar; neutral palette and type. Touches the first-screen, top-bar, sidebar-card, pane-header and app-theme cards, each finished in its own task later.
- [x] T-004 · One agent in its own worktree: the plus menu starts Claude Code in a new pane inside a fresh worktree with a creature name; the pane header shows the agent and the branch. Touches the plus-menu, own-worktree and pane-header cards (themes 1, 2, 3).
- [x] T-005 · moved: SET-011 [compat] Shortcuts live in a file the user owns: `~/.kolux/keybindings.json` · SET-013 [compat] Default chords out of the box, and the commands left without one · Pulled forward from the no-theme P0 block (rule 12): every keybinding id on later cards is pressed through this file, so their acceptance cannot pass without it.


## 1. P0: daily use


### P0 · theme 1 · Session-per-pane terminal grid (20 cards)

- [x] T-006 · PROJ-066 Switching workspaces is instant and keeps each one's state
- [x] T-007-a · SESS-001 [compat] Launch choices list only agents that are really installed · SESS-004 One click on the plus menu starts an agent in a new pane
- [x] T-007-b · SESS-007 An empty pane asks what to run · SESS-013 Choose how many sessions to start
- [x] T-008-a · SESS-015 Every seat needs an AI and a model the user chose; nothing is guessed · SESS-024 Launched sessions land one per pane, titled by seat
- [x] T-008-b · SESS-051 Each catalogue agent's program, start line and opening-prompt route
- [x] T-009 · TERM-001 Session-per-pane grid sized by pane count · TERM-004 Grid layout arrangement for each pane count · TERM-006 [compat] Split a pane right or down · TERM-014 [compat] Close a pane
- [x] T-010 · TERM-040 [compat] New terminal tab and tab create menu · TERM-041 [compat] New agent tab · TERM-068 [compat] Paste into a terminal
- [x] T-011 · VIEW-026 Open a session's live terminal inside its Board card
- [x] T-012-a · BROW-001 [compat] Open a browser tab next to the terminals · BROW-002 Browser pages survive switching away and back
- [x] T-012-b · BROW-003 [compat] Address bar goes to a site or searches the web · BROW-005 [compat] Back, forward, reload and stop

### P0 · theme 2 · Isolation: one worktree per agent (20 cards)

- [x] T-013 · PROJ-001 Add a project by choosing a folder; nothing else is pulled in · PROJ-007 After adding a project its main checkout opens, with existing worktrees listed · PROJ-020 [compat] Create a workspace: a new branch in a folder of its own · PROJ-021 Workspace names become safe branch and folder names
- [x] T-014-a · PROJ-025 [compat] Choose where workspace folders live · PROJ-028 Choose what a new workspace starts from (base ref) · PROJ-038 A new workspace can start an agent with a first prompt
- [x] T-014-b · PROJ-077 [compat] `kolux worktree` create and remove
- [x] T-015 · SESS-014 Separate copy per agent, or one shared folder · SESS-023 Each launched agent gets its own worktree with a creature name
- [x] T-016 · ORCH-016 [compat] One command starts a worker agent in a worktree of its own
- [x] T-017-a · SAFE-023 [compat] New worktrees are pre-trusted so an agent's first prompt is not lost (Claude Code) · SAFE-024 A batch of Claude worktrees is trusted in one write before any agent starts
- [x] T-017-b · Pre-trust for Codex in its own configuration file (the rest of the card on T-017-a)
- [ ] T-017-c · Pre-trust for Cursor and Copilot in their own configuration files (the rest of the card on T-017-a; their file formats are not public)
- [x] T-018-a · GIT-002 Stage and unstage by file, folder or section · GIT-004 Commit from the panel with a message
- [x] T-018-b · GIT-006 The main button always proposes the next step · GIT-007 Remote actions from the panel
- [ ] T-018-c · Source Control bulk bar: select several rows and stage or unstage them together (the rest of the stage card on T-018-a)
- [x] T-019 · GIT-067 [compat] Git side of creating, moving and removing worktrees
- [x] T-020 · SET-032 [compat] Pick the folder new worktrees go into
- [x] T-021 · CLI-018 [compat] kolux worktree create, with an optional agent started inside

### P0 · theme 3 · Knowing what each agent is doing (41 cards)

- [x] T-022 · PROJ-045 Group the workspace list by project, status or pull request · PROJ-050 Smart sort puts workspaces that need you first · PROJ-063 Workspace row shows agent status, unread and pull request state
- [x] T-023 · TERM-020 Pane header identity: agent, name, program, status · TERM-021 Status word colour reflects what the agent needs · TERM-023 Finished-while-away glow and age label · TERM-030 [compat] Jump to the next session that needs you · also passes: STAT-051 Shortcut to the next session that needs you · VIEW-047 Jump to the next session that needs you
- [x] T-024 · TERM-055 Tab activity indicators · TERM-118 Bell and finish notifications
- [ ] T-025 · STAT-001 [compat] Agents report their own status through hooks Kolux looks after · STAT-007 [compat] Claude Code and OpenClaude status · STAT-008 [compat] Codex status, with hook trust handled for the user · STAT-026 Subagents and teammates shown under their lead session · also: feed the sidebar rows (T-022's `rows.ts`) the permission, blocked, waiting, interrupted and queued states from the hooks, with a hook status winning over the title guess; and give the pane header its hook-fed `needs` (T-023's `status.ts`), then prove live that the next-that-needs-you shortcut visits two waiting panes
- [ ] T-026 · STAT-041 [compat] Desktop notification when an agent finishes or needs permission · STAT-045 [compat] Alert when a working agent goes quiet · STAT-050 [compat] Inbox of what needs you, what is running and what finished today · STAT-052 One status vocabulary for every dot, chip and label · also: send the desktop notification from the window's finish-and-bell notice (T-024's `noticed` in `App.tsx`, an in-window note today) and let the notification settings gate it · also: USAGE 009's usage alerts obey the master notifications switch this task adds (Settings > Notifications already has the usage-alerts switch, settings field `usageAlerts`)
- [ ] T-027 · STAT-053 Agent reasoning folds into Thought rows in the Agents view
- [ ] T-028 · VIEW-016 One line per session says what the agent is doing · VIEW-017 Fixed status words on the Agents screen · VIEW-023 Board columns and card status chips · VIEW-025 Approve or deny from a Board card
- [ ] T-029 · VIEW-040 Palette rows show live agent state and age
- [ ] T-030 · ORCH-007 An idle agent gets a one-line pointer typed in when mail arrives · ORCH-015 [compat] Workers report done and send heartbeats · ORCH-020 [compat] See a worker's live state, including when it waits on a person · ORCH-021 [compat] Read what a worker has written, from its transcript or its terminal
- [ ] T-031 · AUTO-013 Numbered run history for each automation
- [ ] T-032 · SAFE-001 [compat] Pane header offers a plan-review button while Claude waits for plan approval · SAFE-002 The review sheet breaks the plan into sections that each take comments · SAFE-003 Approving from the sheet lets Claude carry out the plan · SAFE-004 Request changes returns the plan to Claude with the user's comments
- [ ] T-033 · GIT-001 [compat] Source Control lists a workspace's changes by section · GIT-016 Review changes: an agent checks the branch before it ships · GIT-037 [compat] Open a changed file as a diff · GIT-038 Every change in one scrolling view · folder rows stage and unstage everything beneath them (the folder rule of the stage card on T-018-a; the back end takes folder paths already) · also from T-093-c: Source Control rows open the diff tab (openDiff in App.tsx), and its git status watcher replaces the diff tab's 2 s poll · also from T-093-d: the commit-message area that All Changes shows while a branch is being reviewed, and the git status watcher replacing All Changes' 2 s poll
- [ ] T-034 · GIT-040 [compat] Review notes on diff lines · GIT-041 [compat] Gather review notes and send them to the agent
- [ ] T-035 · EDIT-041 [compat] Open in Code and Answer in Code jump to the agent's pane
- [x] T-036 · SET-027 [compat] Agents page: which agents, the default one, and how they start
- [x] T-037 · APP-054 Resource Manager: memory per session, with a way to end one
- [x] T-037-fix-look · fixes on card VIEW 003 (full-width top bar): the centred switcher no longer covers the search box at the default window size, and narrow windows keep the window controls on screen · and card SESS 007 (an empty pane asks what to run): Start stays in view below the choices in a small pane

### P0 · theme 4 · Accounts, sign-in and usage limits (20 cards)

- [x] T-038 · ACCT-009 [compat] Saved keys and sign-ins are sealed on disk · moved: from theme 5 (rule 10): secrets are sealed from the first card that stores one, never a plain-text stage
- [ ] T-039 · STAT-022 Stopped state says why an agent halted · STAT-023 [compat] Notification when an agent stops · STAT-040 Claude Code's status line feeds usage and context figures · STAT-046 Expired sign-in notice in the main window · also: when a Claude pane stops on a usage limit, write the reset time (ms) to kv `claudeUsageLimitResetsAt` so the Claude card says when it can be used again, and a key that expires mid-session flips the Claude card to Renew; the main-window sign-in notice already exists (`src/settings/SignInNotice.tsx`), extend it rather than adding a second one · also: the rest of T-036's card: an agent on Settings > Agents that is not signed in links to its sign-in on Accounts & keys (Claude and Codex in the browser; the others start in the current workspace's terminal, which needs an open workspace, and Settings stays open if that fails)
- [ ] T-040 · USAGE-002 Board cards carry a compact session meter · USAGE-003 Agent tabs carry a tiny context ring · USAGE-004 Agents view shows rings per session and a plan footer · USAGE-005 How the meters work out context and plan figures · also passes: VIEW-018 Usage line on the Agents screen
- [ ] T-041 · USAGE-006 [compat] Claude, Agent Teams and Codex are held to a 200k window by default · USAGE-007 [compat] Claude carries on by itself once a limit resets (opt-in) · USAGE-008 Weekly usage pill at the top right · USAGE-021 [compat] Claude plan figures read safely from several sources · also passes: VIEW-008 Weekly usage pill in the top right · also: the resume switch already sits on the Claude card as settings field `claudeResumeAfterLimit` (on only when true), so read that field rather than adding a second switch; and the rest of T-045's card: rate-limit panels list only the accounts that belong to the view on screen · also: the rest of T-036's card: the 200k cap with auto-compact switch (on by default) sits on Settings > Agents; also SET 020 rule: usage can read as amount used or amount left (a choice under Settings > Appearance > Window & Sidebar once the pill shows figures)
- [x] T-042-a · USAGE-022 [compat] Codex plan figures read without opening a session · this part: the sign-in lookup order, the hidden background-process read, the figure rules, sign-in again, one read per home, the Codex half of the pill
- [ ] T-042-b · the rest of T-042-a's card: Codex's own usage service tried first, the status screen in a hidden terminal as the last route (a sign-in screen there ends the read with sign in again), and the 5-hour figure and the reset-credit count taken from the service when the background process leaves them out
- [x] T-043-a · ACCT-004 [compat] Claude connects once with a key that lasts a year · this part: the hidden key setup, the sealed key with its date and mode, the twelve-month clock with the 30-day Renew warning, the key handed to every Claude pane in key mode, and the first Settings page (AI connections) with the Claude card
- [x] T-043-b · ACCT-005 [compat] Sign a Claude account in through the browser and keep it as a managed account · ACCT-006 [compat] Claude sign-ins are renewed by default, with an opt-out · this part: Add Account and Sign in again through Claude Code's own browser sign-in into a private folder per account, the sealed vault copy, email and organisation read from Claude Code, Cancel and failed re-auth keeping the earlier sign-in, Make active for new Claude panes (the 1-year key still wins), and renewal left to Claude Code (the default)
- [x] T-043-c · ACCT-007 Codex connects with a ChatGPT sign-in or a device code
- [ ] T-043-d · the rest of T-043-b's cards: the renewal opt-out toggle and Kolux-side renewal when it is off (renew in the last 5 minutes and on Make active, never while a Claude pane is open on that account, a refused renewal marks the account Needs re-auth, network failures are retried, managed accounts only), and the macOS keychain rules for a managed sign-in record, plus CLI 014's restore of the earlier macOS Keychain entry when a `kolux account add` is interrupted
- [x] T-044 · ACCT-012 A lapsed sign-in is flagged outside Settings with Sign in again · ACCT-013 A needs-attention card states the reason and offers the one fix that fits
- [x] T-045 · SET-030 Accounts & keys flags sign-in trouble

### P0 · theme 7 · Redesign and the new look (24 cards)

- [ ] T-046 · SESS-018 The New session page takes over the workspace instead of a dialog
- [ ] T-047 · TERM-013 [compat] Expand one pane to fill, then restore · TERM-019 Every pane shows a header with title and usage · TERM-022 Branch chip in the pane header · TERM-025 Pane header buttons
- [ ] T-048 · TERM-028 Clean look for the terminal grid
- [ ] T-049 · VIEW-001 Three workspace screens: Agents, Board and Terminals · VIEW-002 [compat] Cycle the workspace screen from the keyboard · VIEW-003 Full-width top bar with search hint and inbox bell · VIEW-004 No worktree sidebar on Agents and Board
- [ ] T-050 · VIEW-015 Agents screen lists sessions by saved agent · VIEW-019 Chat, terminal and composer for the selected session · VIEW-021 Add a session from the Agents screen · VIEW-024 Board shows every terminal session in order
- [ ] T-051 · VIEW-050 [compat] Left sidebar: show, hide, resize and focus · VIEW-051 Sidebar card lists projects and their sessions
- [ ] T-052 · USAGE-001 Each agent pane header carries a context ring and a percentage
- [x] T-053 · SET-001 [compat] App colour theme: Classic or one of 16 hues · SET-002 [compat] Tint, saturation and depth sliders adjust the theme · SET-003 Terminal colours can follow the app theme · SET-004 Startup never flashes the wrong theme or font
- [x] T-054 · SET-005 [compat] Light, Dark or System mode · SET-006 [compat] Settings: ten pages plus a small page per repository · SET-037 [compat] Classic or New look, and the screen that opens first

### P0 · theme 5 · Safety and trust (20 cards)

- [x] T-055 · PROJ-070 [compat] Delete a workspace safely
- [ ] T-056 · SESS-027 [compat] Agents start in their own no-prompt approval mode by default
- [x] T-057 · TERM-045 Confirm before closing a terminal with a live program
- [ ] T-058 · SAFE-009 [compat] Claude stops and asks before running a protected shell command · SAFE-010 Built-in rules protect git history: force-push to main and discarding uncommitted work · SAFE-011 Built-in rule: pause before dropping or emptying database objects · SAFE-012 Built-in rules protect live services: Stripe, infrastructure and production deploys
- [ ] T-059 · SAFE-013 Built-in rule: pause before a recursive delete that reaches outside the workspace · SAFE-014 Protected commands are still caught when wrapped, chained, nested or encoded · SAFE-015 [compat] The Protected actions section on the Safety page · SAFE-019 Secrets inside paused commands are masked before they are kept or shown
- [ ] T-060 · SAFE-021 Paths on other machines are refused before any file access · SAFE-022 Clicking a link to a program reveals it in its folder instead of running it
- [ ] T-061 · GIT-003 Discard asks first and spells out what will be lost
- [ ] T-062 · EDIT-044 Projects stored in WSL open and save like local ones again · EDIT-045 File access stays inside your projects and refuses other computers' shares · EDIT-053 Opening a file in its system app never runs a program
- [ ] T-063 · BROW-051 The agent page-control endpoint answers only Kolux's own tools
- [ ] T-064 · APP-041 Diagnostic logs stay on the computer and are scrubbed before sharing · APP-070 The user's work stays on the computer and the app sends no usage data

### P0 · theme 9 · Reliability and no lost work (20 cards)

- [ ] T-065 · PROJ-067 Workspace tabs and layout are saved and restored
- [ ] T-066 · SESS-030 Agent sessions resume after a quit or a crash
- [ ] T-067 · TERM-017 Panes keep their identity across layout changes · TERM-065 [compat] Copy terminal selection, never silently · TERM-103 GPU rendering with safe fallback · TERM-105 Terminals survive quitting and reopening Kolux
- [ ] T-068 · TERM-106 Restore after the background host or computer died
- [ ] T-069 · VIEW-005 The app reopens on the screen and page you left · VIEW-107 Saving the workspace when Kolux quits
- [ ] T-070 · USAGE-023 Usage figures refresh on a timer and ride out errors
- [ ] T-071 · ORCH-012 [compat] Changing a task's state, with guards that keep tasks and workers in step · ORCH-022 [compat] Stop a worker and keep its worktree
- [ ] T-072 · AUTO-012 [compat] Every run ends with a truthful status
- [ ] T-073 · EDIT-003 Banner when a file you have open is changed on disk by an agent
- [ ] T-074 · BROW-008 Pages that fail to load get a recovery overlay · BROW-009 Crashed pages recover by themselves
- [ ] T-075 · APP-048 [compat] Everything the user set up is saved as they go and survives quits and updates · APP-050 Quitting writes one final save without freezing · APP-052 Terminals survive app restarts and a replaced terminal service · also from T-093-a: keep each worktree's open editor tabs so they come back after a restart · also from T-097: when only the background terminal service is running with no window, kolux open waits for it to show the desktop window, and fails with a clear reason when it cannot safely become the desktop app
- [ ] T-076 · CLI-012 [compat] kolux status tells whether the app is up

### P0 · theme 11 · Orchestration and automations (31 cards)

- [x] T-077 · PROJ-047 Child workspaces nest under their parent
- [x] T-078 · SESS-012 Launch shapes Solo, Pair, Workbench and Swarm assign roles · SESS-025 [compat] Agents launched side by side get a rules block and keep a handoff note
- [ ] T-079 · TERM-125 [compat] Terminal commands in the CLI
- [ ] T-080 · VIEW-020 Hand one agent's result to another agent
- [x] T-081 · ACCT-034 [compat] Model routing tiers per provider for workers
- [x] T-082 · ORCH-001 [compat] A coordinator opens a Run and its terminal becomes the Run's home · ORCH-002 [compat] Switch between, inspect and list Runs from the coordinator terminal · ORCH-003 [compat] Send typed mail to a Run, a worker, a terminal or a group · ORCH-005 [compat] check reads the mailbox oldest batch first and repeats it until acknowledged
- [x] T-083 · ORCH-006 [compat] Answer a message, and browse recent mail · ORCH-010 [compat] Tasks can wait on each other and become ready when their dependencies finish · ORCH-011 [compat] List a Run's tasks, filtered or compact · ORCH-013 [compat] Hand a task to an agent terminal that already exists
- [x] T-084 · ORCH-014 [compat] A worker's brief tells it how to report, ask and stay in touch · ORCH-018 [compat] Choose a worker's model by work tier instead of by name
- [x] T-085-a · AUTO-001 [compat] Launch an agent with a saved prompt on a timetable · AUTO-005 [compat] One dialog to create or edit an automation (also from T-086: the Automations page's New Automation button and row Edit open this dialog, and the upcoming time is worked out again after every run)
- [ ] T-085-b · AUTO-004 [compat] Event triggers: pull request opened, checks failed, agent finished · AUTO-011 Runs launch in the background and never take focus (split from T-085: also RRULE lines with INTERVAL, COUNT, UNTIL, BYSETPOS, DTSTART or numbered weekdays; needs T-025 hooks for agent finished and T-176 PR status polling)
- [x] T-086 · AUTO-016 Automations list with sorting, filters and search · AUTO-019 Run now, pause, edit or delete an automation
- [x] T-087 · SET-028 Model and effort per tier for orchestration workers
- [x] T-088 · CLI-007 [compat] kolux works in every Kolux terminal with no setup · CLI-030 [compat] Orchestration runs: start one, bind to one, look one up · CLI-031 [compat] Orchestration messages: send and reply · CLI-032 [compat] Orchestration inbox: check and inbox · also: `worktree create` records the calling terminal's handle and pane key in the workspace origin once the terminal carries them (the calling-terminal rule of the worktree-create card on T-021; the calling folder is recorded already)
- [x] T-089-a · CLI-034 [compat] Orchestration tasks and dispatch · CLI-035 [compat] Orchestration worker-start launches a worker, with model routing (task-update waits for the task-state guards in T-071)
- [ ] T-089-b · CLI-033 [compat] Orchestration ask: a question that waits for its answer, and can be resumed · CLI-036 [compat] Orchestration workers: list, show, read, stop, abandon, release and retain (split from T-089: ask needs the ask flow in T-190; worker show, read, stop and abandon need live worker state and transcripts in T-030, stop in T-071 and abandon in T-155)

### P0 · theme 8 · Release, update and CI pipeline (7 cards)

- [x] T-090 · APP-024 [compat] Quiet update checks on start-up and then every half hour · APP-025 A downloaded update waits behind a small ready pop-up and installs on restart or quit · APP-026 The update card follows a requested check from start to finish · APP-027 Release notes inside the update card
- [x] T-091 · APP-058 [compat] One ship command commits, syncs and lands work on main · APP-059 [compat] Every ship to main publishes a release by itself · APP-060 CI on main runs in four shards and gates releases · also from T-090: make the release signing key (private half kept outside the repo), put its public half in `src-tauri/src/update.rs` RELEASE_PUBKEY, and publish `latest.json` with the installer and its `.sig` to the TxaisX/kolux-rs-releases feed

### P0 · theme 6 · Business-user frame (4 cards)

- [ ] T-092 · ACCT-001 The AI connections page shows a Connect card for each agent · ACCT-002 [compat] A Connect card walks from not installed to connected through clear states · ACCT-003 A missing agent tool installs from its Connect card · ACCT-008 [compat] Grok connects by its CLI login, a device code or a pasted xAI key

### P0 · theme none · No theme (13 cards)

- [x] T-093-a · EDIT-001 [compat] Edit a file in a tab and save it
- [x] T-093-b · EDIT-012 [compat] Markdown opens in a rich editor, with source and preview views
- [x] T-093-c · EDIT-027 [compat] Single-file diff tab: inline or side by side, step through changes · also from T-093-b: a markdown file's diff opens as source, never in the rich view (markdown card rule)
- [x] T-093-d · EDIT-029 All Changes: every changed file in one scrolling view
- [x] T-094-a · EDIT-033 [compat] Explorer tree with mouse and keyboard · also from T-093-a: the explorer and Quick Open are the editor's main open routes, and the editor card's check 'take away read permission on a file and open it, failure with Retry, give it back, Retry loads' runs from the explorer (Windows' own Open dialog refuses an unreadable file before Kolux sees it); a pane rebuilt by a move to another pane keeps caret, selection and scroll, which needs the state kept per tab once tabs can move
- [x] T-094-b · EDIT-034 [compat] Explorer file operations, part 1: create a file or folder, inline rename, delete to the trash with one confirmation, undo and redo, copy path and relative path, Delete key, permanent delete on a WSL share
- [x] T-094-b2 · Explorer file operations, part 2 (the rest of the card built in T-094-b): copy and paste without overwriting, drag to move (a folder dragged with its own children moves only the folder) with edge scrolling, drop in from the desktop (folders copied whole, clashing top-level items renamed, symlinks refused)
- [x] T-094-c · EDIT-036 [compat] Quick Open a file by name with Mod+P
- [x] T-095-a · SKILL-036 Artifacts library page and offline viewer (adding a page by hand stores it and its relative assets under the caps; a page on a network share is listed as unavailable unread) · also passes: VIEW-012 Artifacts library
- [x] T-095-b · SKILL-035 Pages Claude publishes are kept in Kolux automatically (picking publishes out of session output and transcripts, one entry per URL, offline copies of allow-listed CDN scripts, WSL and SSH paths listed as remote) · also from T-095-a: a captured page that loads scripts from a CDN runs from its stored copies, because the viewer lets an entry load only its own stored files
- [x] T-096-a · SET-008 Shortcuts page lists every command with its keys · SET-010 Clashing shortcuts are flagged, scope by scope
- [x] T-096-b · SET-009 Record, add, disable or reset a shortcut (the recorder, several chords per command, disable and reset, and writing ~/.kolux/keybindings.json from the Rust side)
- [x] T-097 · CLI-011 [compat] kolux open starts the app or brings it to the front

## 2. P1: shipped and used


### P1 · theme 1 · Session-per-pane terminal grid (30 cards)

- [ ] T-098 · PROJ-055 [compat] Move between workspaces with the keyboard · PROJ-057 [compat] Worktree palette: jump to any workspace by typing · also passes: VIEW-046 Move between worktrees by keyboard · VIEW-037 Worktree palette: jump anywhere
- [ ] T-099 · SESS-002 Refresh agents finds a fresh install without a restart · SESS-003 [compat] Turn individual agents off so launch menus skip them · SESS-006 The create menu offers shells, an agent chooser, a browser and markdown · SESS-008 [compat] Shortcuts add chooser panes or close sessions · SESS-010 [compat] Choose a default agent
- [ ] T-100 · SESS-011 [compat] Shortcuts open a new agent tab, a terminal or the workspace composer · SESS-016 Effort, fast mode and role label per seat · SESS-021 Use last lineup brings back this project's previous launch when asked · SESS-028 [compat] Per-agent command, default arguments and environment · SESS-029 Each agent's model list, discovered live for some
- [ ] T-101 · TERM-002 [compat] Add and remove session shortcuts · TERM-005 Default pane count for a new workspace · TERM-007 Starting a session into a full grid makes room · TERM-009 [compat] Equalize pane sizes · TERM-012 [compat] Move focus between panes
- [ ] T-102 · TERM-015 Drag a pane to rearrange the split · TERM-044 [compat] Close tabs in bulk · TERM-049 Tab right-click menu · TERM-054 Reorder tabs by dragging · also: the rest of T-057's card: a tab that holds several split panes, and closing tabs in bulk, go through `closeTab` in App.tsx with all their pane keys, so one question covers them all · also from T-094-a: an editor pane rebuilt by a move to another pane keeps its caret, selection and scroll, which needs that state kept per tab
- [ ] T-103 · VIEW-036 [compat] Add or remove sessions by shortcut · VIEW-108 [compat] Terminals keep their scroll position across view switches
- [ ] T-104 · ACCT-046 Windows terminals choose the best shell on the machine · ACCT-047 Startup commands run once, after the shell is ready · ACCT-048 Terminals begin with a clean environment · ACCT-049 Terminals refuse start folders that are unsafe or out of reach · ACCT-065 macOS and Linux terminals fall back to a shell that works
- [ ] T-105 · CLI-023 [compat] kolux terminal list and show · CLI-026 [compat] kolux terminal create, split, rename and switch (also focus)

### P1 · theme 2 · Isolation: one worktree per agent (36 cards)

- [x] T-106-a · PROJ-006 Picking a linked worktree adds or selects its main repository · PROJ-022 Branch names get a configurable prefix · PROJ-026 [compat] KOLUX_WORKSPACES_DIR moves the default workspaces folder · PROJ-030 Open an existing branch or pull request as a workspace (the existing-branch half) · PROJ-032 [compat] Ignored local files the repo lists are copied into new workspaces, within a budget
- [ ] T-106-b · Open a pull request as a workspace (the rest of the PR card on T-106-a: pick a PR, a remote-name clash gets a suffix, a local PR branch is reused only when it points at the PR head)
- [x] T-107-a · PROJ-041 Worktrees made outside Kolux are noticed and offered for review · PROJ-042 Show or hide individual worktrees, with defaults for new projects (the per-worktree half: hide/show, the hidden list a page at a time, relative paths)
- [ ] T-107-b · PROJ-033 A project setup script runs when a workspace is created · also: the composer's setup policy and wait-for-setup options under Advanced (the Advanced card on T-109-a)
- [ ] T-107-c · PROJ-037 Create a workspace straight from a GitHub issue or pull request (needs T-106-b's PR checkout)
- [ ] T-107-d · PROJ-039 The branch is renamed to fit the work once it begins
- [x] T-108-a · PROJ-044 Kolux tells its own worktrees apart from external and scratch ones · also: the per-origin show/hide choice for worktrees Kolux did not make (Claude Code, elsewhere on disk, extra root folders that start hidden), global and per repository, where the global choice never overwrites a repository's own (the visibility rules of the workspaces-folder card on T-020); and the visibility defaults of the show/hide card on T-107-a (new projects start hidden, existing ones keep their earlier behaviour, at most 32 custom folders with their own errors, a project override that shows the global value and resets to it, the link to the global defaults)
- [ ] T-108-b · The made-by-GSD visibility source (the rest of the per-origin rule on T-108-a): GSD's worktree folder is not documented publicly, so its worktrees count as elsewhere on disk until the folder is known
- [x] T-109-a · SESS-035 New workspace composer: pick the project · SESS-036 The workspace name can come from a branch or a GitHub item (the branch half, emoji shortcodes, the fallback name, Enter during input-method composition) · SESS-037 Composer parent worktree and Advanced options (setup options on T-107-b) · SESS-038 Create workspace, Create more, and what guards them (disabled until valid, Create more, focus, where Enter submits, long names)
- [ ] T-109-b · The GitHub half of the composer (the rest of the name-source and Create cards on T-109-a): issue and pull-request suggestions in the name field from the chosen project's own repository, a pasted GitHub link resolves to its item and seeds the name, overlong lookup text is refused, Create more drops the linked item, and switching project drops a GitHub item of the old repository but keeps a tracker link bound to none
- [ ] T-109-c · The rest of the Create card on T-109-a: a failed worktree creation is retried according to policy, and cancelling mid-submit leaves no half-built workspace
- [ ] T-110 · STAT-039 The agent's first real work names a new worktree · STAT-055 [compat] Setup and archive scripts for worktrees
- [x] T-111-a · VIEW-068 Branch summary against the base branch
- [x] T-111-b · VIEW-048 [compat] Delete-workspace and rename-tab shortcuts (the delete half; its Mod+R rename of the active tab moves to the tab-rename task T-119)
- [ ] T-111-c · VIEW-038 Palette ranking · VIEW-041 Filter the palette by repository · VIEW-042 Create a worktree and run quick actions from the palette (needs the worktree palette on T-098)
- [ ] T-112 · VIEW-076 Folder workspaces: attached worktrees and PR checks · VIEW-112 [compat] Import setup scripts from other tools' configs
- [x] T-113-a · ACCT-056 A failed scan never drops worktrees from the list (the sidebar half)
- [ ] T-113-b · The cleanup half of the failed-scan card on T-113-a: cleanup offers and removes only worktrees Kolux can show it made (its origin record), and a worktree Kolux did not create is left in place; built with the cleanup dialog on T-162
- [ ] T-114 · AUTO-010 Choose whether per-run worktrees run the project setup
- [x] T-115-a · EDIT-040 [compat] Per-workspace handoff note that can be given to an agent
- [ ] T-115-b · EDIT-047 Worktree switcher search in the Mod+J palette (needs the worktree palette on T-098)
- [x] T-116-a · SET-031 Git & worktrees page: branch names and source control defaults (the next-branch sample, the refused and only-slashes prefix notes, and Default compare base; in the sidebar gear until the Settings page, T-054)
- [ ] T-116-b · The rest of the Git & worktrees card on T-116-a: renaming branches after the work done on them (needs the agent status hooks, T-025..T-030), updating the local base branch before a worktree is made (off by default), how the source control view opens (list and group order, with T-033's tree view), and the AI help for commit messages and other source control actions with its recipe and extra-arguments checks (with the AI source-control actions); all on the Settings page (T-054)
- [ ] T-116-c · SET-033 Per-repository page: base branch, setup script, folder (needs the Settings page, T-054, and a setup run: the Setup tab on T-107-b, and the prompt on T-156 before a shared script runs)
- [x] T-117-a · CLI-009 [compat] Selectors for repos, worktrees and terminals, with the current folder as default · CLI-015 [compat] kolux repo: list, add, show, base ref and ref search · CLI-016 [compat] kolux project list · CLI-017 [compat] kolux worktree list, show, current and ps
- [ ] T-117-b · CLI-019 [compat] kolux worktree set: rename, link, comment, board status and lineage (board status needs the core lane's Board, T-025..T-030), plus the WSL path rule and the folder: parent form of the selector card on T-117-a (folder workspaces are T-218)
- [x] T-118 · CLI-021 [compat] kolux worktree changes and overlap: what a worktree touched and who else touches it

### P1 · theme 3 · Knowing what each agent is doing (57 cards)

- [ ] T-119 · TERM-027 [compat] Name a pane · TERM-029 Needs you strip above the grid · TERM-048 [compat] Rename a tab · TERM-058 Tab titles follow the running program · TERM-063 Floating button shows pending activity · also: the rest of T-036's card: the automatic tab titles switch (off by default) sits on Settings > Agents · also: the delete-workspace and rename-tab shortcuts card's Mod+R, which makes the active chat or terminal tab's title editable (T-111-b built the delete half)
- [ ] T-120 · STAT-002 [compat] Settings switch for agent status hooks · STAT-003 [compat] `kolux agent hooks` commands · STAT-009 [compat] Gemini CLI status · STAT-010 [compat] Antigravity status · STAT-011 [compat] Amp status through a Kolux plugin · also: the rest of T-036's card: the status hooks switch (on by default) sits on Settings > Agents
- [ ] T-121 · STAT-012 [compat] Cursor Agent status · STAT-013 [compat] Droid status · STAT-014 [compat] Command Code status from tool events and its transcript · STAT-015 [compat] Kimi status in a marked block of its settings · STAT-016 [compat] Hermes status through a switched-on plugin
- [ ] T-122 · STAT-017 [compat] Copilot CLI status · STAT-018 [compat] Grok status, with its hook settings removed at quit · STAT-019 [compat] Devin status in its commented settings file · STAT-020 [compat] MiMo Code status through a plugin in a separate home · STAT-021 Pi and OMP status and titles through Kolux extensions
- [ ] T-123 · STAT-024 Monitoring state while background work outlives the turn · STAT-025 Status shows the tool in use, the prompt and the last reply · STAT-027 Waiting rows carry the plan or the question · STAT-028 Interrupted turns read interrupted, not done · STAT-029 Starts, resumes, clears and manual compacts are not finished work
- [ ] T-124 · STAT-032 Status with no update for 30 minutes is marked unverified · STAT-033 Terminal titles stand in when no hook reports · STAT-034 [compat] Status written into terminal output (OSC 9999) · STAT-035 [compat] Tab titles follow status, with optional generated titles · STAT-042 [compat] Notifications settings page
- [ ] T-125 · STAT-044 Notifications are merged, paced and open the right pane · STAT-047 [compat] Tray icon with an attention dot · STAT-048 Dock and taskbar badge counts workspaces with unseen results · STAT-049 Looking at a finished session marks it seen · STAT-061 Grok questions show needs you with the question
- [ ] T-126 · STAT-062 Late events after a finished Antigravity or Amp turn never bring back working
- [ ] T-127 · VIEW-073 Checks panel for the current pull request · VIEW-075 PR comments as cards in the sidebar · VIEW-084 Session rows show prompt, latest turn, sub-agents and worktree · VIEW-088 Find the live pane a past session is running in · VIEW-093 Tab titles follow session names
- [ ] T-128 · ACCT-050 Kolux recognises which agent runs in each pane
- [x] T-129-a · ORCH-040 [compat] `kolux worktree ps` sums up orchestration across worktrees
- [ ] T-129-b · ORCH-026 [compat] List workers by terminal state to see what can be cleaned up · ORCH-037 Coordinators see which workers need attention · ORCH-056 Open agent prompts are noticed even with no hook reporting them · ORCH-066 A worker's agent row is named after its task, not its brief (split from T-129: worker-list's terminal states need settled dispatches and release / retain from T-089-b; attention flags need the status hooks on T-025 and live worker state on T-030; prompt detection needs a scan of the terminal screen text; the task-named rows need the Agents view and Board rows)
- [x] T-130 · AUTO-015 Runs dashboard across every automation
- [ ] T-131 · SAFE-005 Unsent comments are kept when the sheet closes and reopens · SAFE-006 A very long plan is cut down in the sheet, with a pointer to the terminal · SAFE-007 The sheet turns read-only once Claude stops waiting on that plan
- [ ] T-132 · EDIT-007 [compat] Copy a selection together with its path and line numbers · EDIT-020 [compat] Review notes on a file, sent to an agent
- [x] T-133 · SET-034 Notifications page: which alerts, which sounds
- [ ] T-134 · CLI-024 [compat] kolux terminal read: output history or the screen as it looks now · CLI-025 [compat] kolux terminal send and wait · CLI-040 [compat] kolux agent hooks: status, on, off and prepare-codex

### P1 · theme 4 · Accounts, sign-in and usage limits (21 cards)

- [x] T-135 · SESS-022 Warning before launching close to a usage limit
- [x] T-136-a · USAGE-009 [compat] Alerts at 80% and 95% of a usage window · USAGE-010 Launch dialogs warn when an account is nearly spent (built with T-135)
- [ ] T-136-b · USAGE-011 [compat] Stats & Usage page with Kolux activity counts · USAGE-012 Usage analytics opens on a combined overview · USAGE-013 Token tracking is opt-in for each provider
- [ ] T-137 · USAGE-014 Claude and Codex token analytics panels · USAGE-015 Estimated cost from each model's published prices · USAGE-018 Grok credits panel
- [x] T-138 · ACCT-016 The Claude accounts list: system default and managed accounts · ACCT-017 Changing the active Claude account is safe with sessions running · ACCT-018 The same Claude account cannot be added twice · ACCT-019 [compat] The Codex accounts list for fast switching · ACCT-020 Codex's system-default login is shown truthfully
- [ ] T-138-b · Codex accounts list (ACCT 019): label a personal and a business workspace on one email so they can be told apart (today both rows show the email and their own last sign-in time; the workspace kind lives in token claims OpenAI does not document, so it needs a public source first)
- [x] T-139-a · ACCT-032 Model choice per agent; the live per-account lookup exists but is off the main path (built-in lists for Claude, Codex, Grok, Gemini and Cursor; any other agent skips the model step; the live per-account lookup is SESS 029 in T-100)
- [ ] T-139-b · ACCT-023 A resumed session keeps the account it began on · ACCT-064 Changing the Codex account offers to restart live Codex panes (needs per-pane account memory, the foreground-program check and an in-pane restart prompt: HAND TO FABLE)
- [ ] T-139-c · ACCT-027 The Grok section shows the CLI sign-in and credit use (needs a public source for the Grok CLI's session file and credit figures first)
- [ ] T-140 · AUTO-014 Saved run output with token and cost figures
- [x] T-141 · CLI-014 [compat] kolux account add and account list · ACCT-031 [compat] `kolux account add` and `kolux account list` (the same two commands, moved here from T-139)

### P1 · theme 7 · Redesign and the new look (18 cards)

- [ ] T-142 · PROJ-085 [compat] Workspace board: lanes by status · also passes: VIEW-027 Large workspace boards stay smooth
- [x] T-143 · SESS-009 Agent dropdown leads with three featured agents and searches the rest
- [ ] T-144 · TERM-010 Resize panes by dragging dividers · TERM-024 Narrow panes drop header items in a set order · TERM-035 Pane right-click menu · TERM-078 [compat] Zoom the terminal font · TERM-097 Terminal font settings
- [x] T-145-a · TERM-098 Terminal colour themes: Kolux dark by default and a Tango-style light scheme in light mode; programs that ask the terminal for its colours or for light/dark mode, or subscribe to mode changes, are answered by the pane (custom themes are in T-148)
- [ ] T-145-b · TERM 098 rules that need the PTY: on Windows the system console layer swallows the colour and light/dark questions (OSC 4, 10, 11 with "?", CSI ? 996 n, CSI ? 2031 h) before they reach the pane, so programs get no answer; needs a pass-through console or answering in the Rust output reader; also check no stray replies at startup (output that arrives before the pane knows its terminal id is dropped today)
- [ ] T-146 · VIEW-006 Each workspace screen can have its own theme · VIEW-009 [compat] Full-page views open over the workspace · VIEW-056 [compat] Right sidebar: open, close, width and remembered tab · VIEW-057 [compat] Right sidebar tab strip · VIEW-086 Resume a past session as chat · also from T-094-a: the explorer card (src/editor/Explorer.tsx, fixed 280 px) is the right sidebar's first tab; its resizable width, tab strip and remembered tab come here
- [x] T-147 · VIEW-096 Status bar: show, hide and choose items
- [x] T-148-a · SET-023 Terminal colour schemes for dark and for light: a searchable scheme catalogue, one pick for dark mode and one for light mode (Tango-style light by default), custom schemes added by pasting a Windows Terminal scheme, kept in settings and tidied when loaded · also: the rest of T-053's card: the scheme catalogue, the separate light scheme and imported schemes go in the same Terminal colours picker as Kolux dark and Match app theme (Settings > Appearance, settings field `terminalScheme`); also TERM 098 rule: custom terminal themes can be added (they go in that same picker)
- [x] T-148-b · SET-016 Appearance page in three foldable sections · SET-018 App font and editor font
- [x] T-148-c · SET-020 Show or hide the title, toolbar buttons and status bar items
- [x] T-148-d · SET 023 rules for the panes: divider colour set per mode and divider width starting at 3 px; panes not in focus dim to an adjustable opacity over a 140 ms fade

### P1 · theme 5 · Safety and trust (37 cards)

- [ ] T-149 · PROJ-034 [compat] kolux.yaml shares setup, issue command and tabs with the whole team · PROJ-082 Bulk remove from cleanup runs in the background
- [ ] T-150 · SESS-026 [compat] Setup scripts and hook trust are settled before any agent starts
- [ ] T-151 · TERM-003 Confirm before removing a started session · TERM-031 Answer an agent permission prompt from Kolux · TERM-046 Pin tabs; pinned tabs ask before closing · TERM-069 Safe multi-line paste
- [ ] T-152 · STAT-004 Hooks go only to agents that are installed and switched on · STAT-005 [compat] Installing hooks never damages the user's own settings
- [ ] T-153 · VIEW-054 Per-worktree skip-permissions override · VIEW-067 Discard changes with confirmation · VIEW-089 Delete, reveal or open a past session's files · VIEW-099 Kill a terminal session from the Resource Manager · VIEW-116 Confirmation prompts: Enter, Escape and don't ask again · DT-37: build this card only if a click-through of the installed app shows the control; otherwise SKIPPED
- [ ] T-154 · ACCT-010 A key that can no longer be unsealed is cleared with a reconnect hint · ACCT-011 Keys and sign-in links never show up in logs, errors or on screen · ACCT-055 The app window can read only files it was given access to
- [x] T-155-a · ORCH-023 [compat] Abandon a worker's dispatch without touching processes or files · ORCH-032 [compat] Workers cannot spawn further workers past a depth cap · ORCH-033 One Run cannot see or change another Run's work
- [ ] T-155-b · ORCH-036 Typing into a worker's terminal takes it over · ORCH-067 [compat] Worker report commands carry a secret dispatch pass that output reads hide (split from T-155: the takeover needs release and stop (T-071, T-089-b) and a way to tell the user's typing from Kolux's own; the dispatch pass checks need the done-report settle (T-030), ask (T-190) and worker read with its redaction (T-089-b, T-134))
- [ ] T-156 · SAFE-016 Users add their own protected rules by prefix, text or regular expression · SAFE-017 Protected rules can differ per project, and each scope can be reset · SAFE-018 A recent-attempts list shows what was paused and how it ended · SAFE-020 [compat] The installed Claude hook can only make Claude ask, and keeps the settings file private · SAFE-025 Kolux asks before running a repository's shared kolux.yaml scripts · also passes: STAT-056 Repository scripts need the user's trust before running
- [ ] T-157 · SAFE-026 Stored secrets stay sealed by the system keyring, with no plain-text fallback
- [ ] T-158 · BROW-015 Popups open in a small window that shows only the origin · BROW-024 Trust a self-signed certificate on a local dev server · BROW-029 Importing cookies never brings Google sign-ins · BROW-031 Passkey account chooser · BROW-036 Grabbed page details are scrubbed of secrets
- [ ] T-159 · BROW-040 Document previews are fenced to their folder
- [x] T-160 · CLI-003 Typos are caught before the app is contacted, with safe suggestions · CLI-020 [compat] kolux worktree rm, also reachable as remove and delete · CLI-039 [compat] Who is calling: caller identity for orchestration

### P1 · theme 9 · Reliability and no lost work (93 cards)

- [ ] T-161 · PROJ-027 [compat] Worktree work on cloud-synced folders fails fast instead of hanging · PROJ-031 Workspace-creation errors say what kind of problem it was · PROJ-064 Rows show commits not yet pushed · PROJ-068 Workspace records survive refreshes, renames and re-adds · PROJ-072 Recover from a failed delete
- [ ] T-162 · PROJ-073 Branches stay when a workspace was opened on an existing branch · PROJ-074 Deleted folders go to a hidden trash and are cleared in the background · PROJ-080 Workspace cleanup: scan for stale and merged workspaces
- [ ] T-163 · SESS-005 The user hears about an agent that will not start · SESS-032 The opening prompt reaches the agent exactly once, or the user is told
- [ ] T-164 · TERM-047 [compat] Reopen a closed tab · TERM-071 Large pastes stay responsive · TERM-090 Scroll position: follow output or stay put · TERM-107 Restored-session banner · TERM-108 Background host updates without losing sessions
- [ ] T-165 · TERM-109 Host crash containment · TERM-110 Terminal error messages in plain words · TERM-111 Shell exit overlay with restart · TERM-112 Hidden terminals use less memory · TERM-113 Fast startup with many saved terminals
- [ ] T-166 · TERM-114 Recover after sleep, wake and window focus · TERM-115 Typing and output never get stuck · TERM-116 Copy terminal diagnostics · TERM-132 Full-screen programs keep their own screen · TERM-134 Programs always see the pane's true size
- [ ] T-167 · STAT-006 Hooks stay harmless outside Kolux, finish quickly and catch up after a restart · STAT-030 Last known status survives a restart until a live event confirms it · STAT-037 Agents that can be resumed are recorded at quit and sleep
- [ ] T-168 · VIEW-007 Screen and sidebar preferences stay in step across windows · VIEW-066 Push failures explain themselves · VIEW-080 Agents tab: past sessions for this workspace · VIEW-081 Search, filter and group past sessions · VIEW-082 Session list view options persist
- [ ] T-169 · VIEW-083 Session list refreshes without stealing keystrokes · VIEW-085 Resume a past session in a terminal · VIEW-091 [compat] Session history reads many agents' transcripts · VIEW-095 Handoff note autosaves · VIEW-098 Resource Manager: memory and CPU per worktree
- [ ] T-170 · USAGE-016 [compat] Claude log scan counts each turn once · USAGE-017 [compat] Codex log scan counts each token event once
- [ ] T-171 · ACCT-014 Connection status stays current without constant polling · ACCT-021 [compat] Codex settings are copied into each account, with sync problems flagged · ACCT-024 [compat] New sessions wait until the chosen sign-in is ready · ACCT-025 Sign-ins survive quitting and restarting · ACCT-026 [compat] Accounts and keys carry over from older releases
- [ ] T-172 · ORCH-008 Waiting mail outlives a restart without repeating keystrokes · ORCH-017 [compat] A failed worker start says what happened and how to recover · ORCH-024 [compat] Release a finished worker's terminal after saving its output · ORCH-025 [compat] Keep a settled worker's terminal open on purpose · ORCH-027 The coordinator hears when a worker's terminal dies
- [ ] T-173 · ORCH-030 [compat] Retrying a command after a timeout never does the work twice · ORCH-034 [compat] The orchestration store is private and upgrades in place · ORCH-038 In-flight workers come back inspectable after a restart · ORCH-039 Finished worker tabs stay after a restart and do not wake by themselves · ORCH-053 The background daemon starts once and checks it can run terminals
- [ ] T-174 · ORCH-054 The command line reaches the open app through a local channel · ORCH-055 Prompts typed into agents land exactly once · ORCH-058 Removing a worktree stops its processes first
- [x] T-175 · AUTO-007 [compat] Grace window for runs missed while Kolux was away · AUTO-021 History keeps the newest 100 runs · AUTO-022 Runs refuse cleanly when the target is not ready
- [ ] T-176 · GIT-027 PR status stays current without flooding GitHub · GIT-028 GitHub rate limits and outages are visible · GIT-039 Very large diffs are held back instead of freezing the app · GIT-063 Agents never stall on an unseen Git password prompt · GIT-065 Workspaces warn about unpushed commits
- [ ] T-177 · EDIT-002 Autosave, off by default, writes edits after a short pause · EDIT-004 [compat] Open tabs and unsaved drafts come back after a quit or crash · EDIT-019 [compat] Rich editing leaves the untouched parts of a note byte-for-byte · EDIT-028 Very large diffs ask before they draw · EDIT-032 Renaming or moving a file keeps its tab and unsaved edits
- [ ] T-178 · EDIT-046 Saves are all-or-nothing, and big or binary files are handled safely
- [ ] T-179 · BROW-020 Browser tabs come back after a restart · BROW-021 [compat] Hidden worktrees give back browser memory
- [ ] T-180 · SKILL-022 Delete skills safely from the Skills page
- [ ] T-181 · SET-035 [compat] Settings save at once, reach every window, and hide secrets · SET-036 Settings text fields never lose what was typed
- [ ] T-182 · APP-001 Only one copy runs; launching again brings the open window forward · APP-002 The window appears quickly even when the terminal service is slow · APP-006 Closing asks first when work could be lost, and quitting always finishes · APP-011 Restart, reload and update only go ahead after a safe save · APP-020 Terminals find the same tools as the user's shell, including new installs
- [ ] T-183 · APP-021 Broken folder permissions are detected and repaired on Windows · APP-039 After a crash the app offers to report it as a GitHub issue · APP-042 When the interface crashes or a screen fails to load, the app recovers or asks · APP-043 Repeated graphics crashes lead to safe graphics, with the user's consent · APP-049 A damaged saved-state file never wipes the user's setup
- [ ] T-184 · APP-053 Closing a terminal or the app leaves no orphaned processes · APP-062 A manual restore check proves terminals survive quits and a killed service · also passes: STAT-054 Closing an agent ends every process it started · ACCT-051 Closing a pane or quitting ends every child process
- [ ] T-185 · CLI-006 [compat] Windows: the kolux.cmd shim and the kolux.exe launcher · CLI-010 Which commands need the app to be running · CLI-027 [compat] kolux terminal close, with the old stop kept as a hidden alias · CLI-038 [compat] Safe retry after a lost result: the retry flag, request-show and reset

### P1 · theme 11 · Orchestration and automations (47 cards)

- [x] T-186-a · PROJ-040 Nest a new workspace under a parent workspace · PROJ-048 Change a workspace's parent · PROJ-078 [compat] `kolux worktree` list, show, current and set · PROJ-079 [compat] `kolux worktree changes` and `kolux worktree overlap` (list, show and current were built on T-117-a, changes and overlap on T-118)
- [ ] T-186-b · the rest of T-186-a's cards: changing a parent by a Board-card middle drop and by `worktree set` with its parent flags (split from T-186: the Board is T-025..T-030 and `worktree set` is T-117-b), plus the fall back to the active folder workspace when the parent is gone (folder workspaces are T-218)
- [x] T-187-a · SESS-020 [compat] Save a lineup as a shape or team and use it again · SESS-031 Carry a conversation over to a different agent · SESS-033 Start an agent to fix failing checks · SESS-034 Start an agent directly from an issue
- [ ] T-187-b · the rest of T-187-a's cards: carrying a conversation over to another agent (needs session transcripts, T-169), starting an agent on failing pull-request checks (needs the checks panel, T-127) and starting one from a GitHub issue or pull request (needs the issue and pull-request checkout, T-106-b, T-107-c, T-109-b); split from T-187, which built only the saved lineups
- [ ] T-188 · TERM-126 [compat] Send a prompt to an agent and confirm it was submitted
- [x] T-189-a · VIEW-011 [compat] Automations and Skills pages · VIEW-069 Ask an agent to fix things from Source Control · VIEW-087 Continue a session with another agent
- [ ] T-189-b · the rest of T-189-a's cards: the Skills title-bar button and Skills page restore (needs the Skills page, T-243) and continuing a past session with the same or another agent (needs session transcripts, T-169); split from T-189, which built the Automations button, the page restore and resolving conflicts with an agent
- [x] T-190-a · ORCH-004 [compat] Group addresses fan one message out to several agents · ORCH-009 Delivered mail reads as a banner with sender, priority and a reply hint · ORCH-019 [compat] Give a worker a model and effort by name · ORCH-028 [compat] Decision gates hold a task until the coordinator decides · ORCH-029 [compat] A worker asks the coordinator a question and waits for the answer
- [x] T-190-b · the rest of T-190-a's cards: decision gates (gate-create, gate-resolve, gate-list holding a task blocked until the coordinator decides) and the worker's ask command (a question to the coordinator that waits for its answer and can be resumed); split from T-190, which built group addresses, the mail banner and worker models by name
- [x] T-191-a · ORCH-031 [compat] Reset orchestration state by scope · ORCH-041 [compat] Start Claude Agent Teams inside a Kolux terminal · ORCH-065 [compat] Every orchestration command speaks JSON for scripts and agents
- [ ] T-191-b · the rest of T-191-a's cards: the Claude Agent Teams entry in the agent picker (offered only when the Kolux command line and Claude Code are installed, hidden on Windows and WSL), the Agent Teams mode preference (off, in-process or native panes) and the keybinding command that opens a new Agent Teams tab with no key bound; split from T-191, which built reset by scope, JSON on every orchestration command and the claude-teams command
- [x] T-192-a · AUTO-002 Custom cron field that checks itself as you type · AUTO-003 Time picker with AM and PM · AUTO-006 Starter templates for a first automation · AUTO-008 [compat] A precheck command gates each run · AUTO-009 [compat] Keep one agent session across runs
- [ ] T-192-b · the rest of T-192-a's cards: the precheck command ahead of timed and event-started runs with its 1, 2, 5 or 10 minute limit and the precheck skip in the history (never ahead of Run Now; `--precheck` and `--precheck-timeout`), keeping one agent session across runs in existing-worktree mode (`--reuse-session` and `--fresh-session`), and the templates filling in the grace window once T-175 adds that field; split from T-192, which built the 12-hour time boxes, the self-checking Custom line and the starter templates
- [x] T-193-a · AUTO-017 Keyboard control of the list and the detail view · AUTO-018 Automation overview with a collapsible prompt · AUTO-020 [compat] The kolux automations command group · AUTO-025 Hermes and OpenClaw cron jobs in the same list
- [ ] T-193-b · the rest of T-193-a's cards: Hermes and OpenClaw cron jobs in the same list (needs those tools installed to prove; the command group was built on T-197-a); split from T-193, which built the keyboard control, the opened automation page, the Overview tab and the unreadable-history case
- [x] T-194 · GIT-068 [compat] Worktree changes and overlap from the CLI
- [ ] T-195 · BROW-037 Annotate page elements and send the notes to an agent · BROW-042 [compat] Agents drive the worktree's visible browser tab · BROW-046 [compat] CLI: navigate, wait, snapshot and capture pages · BROW-047 [compat] CLI: act on page elements
- [ ] T-196 · SKILL-024 Nudge when an installed Kolux skill falls behind · SKILL-026 [compat] Update stale Kolux skills in the background · SKILL-028 [compat] Install a Kolux skill for your AIs from inside Kolux · SKILL-029 [compat] Kolux's own skills, matched to the app version
- [x] T-197-a · CLI-004 [compat] JSON output and structured errors · CLI-005 [compat] Exit codes · CLI-013 [compat] kolux claude-teams runs Claude Code agent teams in Kolux panes · CLI-028 [compat] kolux automations list, show and runs · CLI-029 [compat] kolux automations create, edit, remove and run
- [ ] T-197-b · the rest of T-197-a's cards: the precheck and precheck timeout, reuse-session and fresh-session, source context and the owner conflict and recovery steps on create and edit; skipped runs after a precheck and orphaned-host rows in list (after T-192-b, T-175 and remote hosts); the open-the-app advice, status, account add, keepalive and base64 rules and per-shell quoting; the shim exit 2, ask exit 75, terminal wait and skills exit codes; the tmux stand-in for agent teams (with the orchestration tmux card); split from T-197, which built the automations command group, its JSON rows and refusals, and leans on T-191-a for the claude-teams pass-through and its Windows refusal
- [x] T-198-a · CLI-037 [compat] Orchestration decision gates · CLI-042 [compat] kolux agent-context: a machine-readable map of every command · CLI-043 [compat] kolux skills list and get: the agent guides bundled with the CLI · CLI-044 [compat] kolux skills install and update · also passes: SKILL-030 The skills list and get commands print the bundled guides · SKILL-031 The skills install and update commands
- [ ] T-198-b · the rest of T-198-a's cards: skills install and update through the community skills installer (skill, all, agent, local and dry-run flags, the detected-agents rule, JSON refused on a real run, the package tool's exit status, the Windows command-script shim rules and the forwarded-shell refusal); it needs the repository the installer pulls the bundled skills from, which T-196 packages; plus the browser reference of the kolux-cli guide once the browser command group exists; split from T-198, which built the gate rule, agent-context and skills list and get

### P1 · theme 8 · Release, update and CI pipeline (4 cards)

- [ ] T-199 · APP-028 A failed update install is reported at the next launch, with a retry · APP-029 Restart to update either installs or explains why it could not · APP-031 Update download problems fix themselves or offer a fix · APP-061 Packaged builds are smoke-tested before they are published

### P1 · theme 6 · Business-user frame (33 cards)

- [ ] T-200 · PROJ-002 The Add Project dialog opens on cloning, with browse and create one step away
- [ ] T-201 · SESS-017 Featured agent cards show what is missing and how to set it up · SESS-019 The older launch dialog with starter kits and a folded Advanced section
- [ ] T-202 · ACCT-015 Disconnect removes only what Kolux made
- [ ] T-203 · GIT-061 Turn a plain folder into a Git repository
- [ ] T-204 · SKILL-001 Six ready-made starter kits for common business jobs · SKILL-002 Starter kit gallery and its entry points · SKILL-003 Kit roles go to the AIs the user has connected · SKILL-004 Kit setup dialog gathers inputs and stops bad files · SKILL-005 Try a kit on bundled sample data, and recall past inputs
- [ ] T-205 · SKILL-006 Starting a kit opens one titled session per role · SKILL-007 [compat] Every kit seat works under the same plain rules · SKILL-008 A waiting kit role starts once the role it depends on is done · SKILL-009 Kit results strip above the session grid · SKILL-010 Each kit role row says what its AI is up to
- [ ] T-206 · SKILL-011 Rescue a stuck kit role: move it, sign in, or restart · SKILL-012 Preview or open a kit's result files · SKILL-013 [compat] Collect a kit's results into one dated folder with a summary page · SKILL-014 [compat] Kit run record and recent kit runs · SKILL-015 Kits run only in local projects or the samples folder
- [ ] T-207 · ONB-001 Guided first run is a four-screen card floating over the app · ONB-002 Welcome screen: three AIs at work side by side · ONB-003 Connect an AI screen keeps Continue locked until one AI is connected · ONB-004 Your work screen: choose a folder or use sample data · ONB-005 Choose a kit screen starts a kit or one plain session
- [ ] T-208 · ONB-006 Leaving the wizard asks first and says how to return · ONB-007 [compat] Wizard progress and outcome are kept, and a failed save can be retried · ONB-008 [compat] Only new profiles get the wizard; older progress carries forward · ONB-010 The first folder added after onboarding starts the default agent · ONB-012 Grid tour runs once when the first run ends
- [ ] T-209 · ONB-036 Plain words on newcomer paths, guarded against jargon
- [ ] T-210 · SET-017 [compat] Interface language, falling back to English
- [ ] T-211 · APP-023 The landing screen warns about missing or signed-out tools

### P1 · theme 10 · Identity and originality (2 cards)

- [ ] T-212 · PROJ-023 New workspaces are offered a unique sea-creature name
- [ ] T-213 · APP-004 [compat] Settings and data from the app's former name carry over on first launch

### P1 · theme none · No theme (171 cards)

- [ ] T-214 · PROJ-003 Clone a repository from a URL into a suggested folder · PROJ-004 Start a brand-new empty project from a name · PROJ-005 A folder without Git can be opened as a folder project · PROJ-008 Remove a project from Kolux · PROJ-010 [compat] The `kolux repo` commands
- [ ] T-215 · PROJ-011 [compat] The `kolux project list` command · PROJ-012 Scan a parent folder for the repositories inside it · PROJ-013 Import found repositories as one group or as separate projects · PROJ-014 Project groups organise the sidebar · PROJ-015 Delete a project group, with or without its projects
- [ ] T-216 · PROJ-016 Drag project and group headers into order · PROJ-046 Pin workspaces to a pinned section · PROJ-049 Manual order: drag workspaces into a custom order · PROJ-051 Recent sort orders by last activity · PROJ-052 Filter the workspace list
- [ ] T-217 · PROJ-053 [compat] Put a workspace to sleep · PROJ-056 [compat] Back and forward through visited workspaces · PROJ-059 [compat] Rename a workspace inline · PROJ-060 Workspace details: name, linked item and notes · PROJ-065 Workspace context menu · also passes: VIEW-053 Show or hide sleeping workspaces · also: the rest of T-055's card: Delete in the workspace menu; a workspace with children offers only to delete them all, children first and the parent last; a parent or a batch always asks even with the question switched off
- [ ] T-218 · PROJ-071 Delete many workspaces at once · PROJ-076 Forget a workspace locally without touching disk · PROJ-083 Space view: what each workspace costs on disk · PROJ-084 Workspace statuses form a workflow · PROJ-086 Folder workspaces for projects without Git · also passes: VIEW-014 Space view: disk use per worktree and bulk delete · the remove form's keep-the-branch choice and the later delete of a kept branch through `Git::delete_branch_if_at` (the kept-branch rule of the worktree card on T-019) · a plain folder workspace's folder is recorded as the parent of a worktree the CLI makes from one of its terminals (the folder-workspace rule of the worktree-create card on T-021)
- [ ] T-219 · TERM-037 Fork or continue an agent session · TERM-042 Type a URL or path in the new tab box · TERM-043 Choose the Windows shell for a new terminal · TERM-050 [compat] Switch to the recent tab with Ctrl+Tab · TERM-051 [compat] Cycle tabs by type
- [ ] T-220 · TERM-052 [compat] Go to a tab by number · TERM-059 [compat] Floating workspace panel · TERM-060 [compat] Move, resize and maximize the floating panel · TERM-061 Floating panel tabs and close behaviour · TERM-070 Paste a screenshot as a file path · also from T-093-a: with a floating editor panel focused, Mod+S writes only that panel's file and leaves the main editor alone, and Mod+S works outside a workspace screen while a floating editor is the active one
- [ ] T-221 · TERM-074 Drop files onto a terminal · TERM-075 Programs can copy to the clipboard (OSC 52) · TERM-076 [compat] Clear the screen · TERM-077 [compat] Find text in a terminal · TERM-079 Kolux shortcuts versus shell keys
- [ ] T-222 · TERM-080 Shift+Enter makes a new line in agents · TERM-081 Option key as Alt on macOS · TERM-083 Typing in Korean, Chinese and Japanese · TERM-092 Clickable web links in output · TERM-093 Clickable file paths in output
- [ ] T-223 · TERM-120 Windows terminals behave natively · TERM-122 Keep the computer awake while agents run · also passes: VIEW-097 Keep the computer awake while agents run · BROW-053 Keep the computer awake while agents run · APP-018 Optional: keep the computer awake while agents run · also: the rest of T-036's card: the keep-awake choice sits on Settings > Agents (On / Agent / Off, Off by default) with help text on what closing the lid does
- [ ] T-224 · VIEW-010 [compat] Tasks page button and shortcut · VIEW-043 Find pull requests and checks from the palette · VIEW-059 Explorer file tree · VIEW-060 [compat] Explorer file operations · VIEW-061 [compat] Search in files from the right sidebar
- [ ] T-225 · VIEW-062 [compat] Source Control: changed files list · VIEW-063 Open a changed file's diff · VIEW-064 Commit box with saved drafts and AI message · VIEW-065 One main git button that changes with the state · VIEW-070 Create or link a pull request from the sidebar
- [ ] T-226 · VIEW-071 Git history in the sidebar · VIEW-074 Start a pull request from Checks · VIEW-078 Ports in the status bar
- [ ] T-227 · GIT-005 Commit together with push, sync or force push · GIT-009 A failed push can be handed to an agent · GIT-011 Branch row compares the workspace with its base · GIT-015 Merge and rebase conflicts with abort and AI resolve · GIT-017 [compat] AI writes the commit message from what is staged
- [ ] T-228 · GIT-018 [compat] Choose who writes commit messages · GIT-020 Branches are named after the work done in them · GIT-021 Create a pull request from Source Control · GIT-022 One click takes unfinished work all the way to a pull request · GIT-023 Create PR explains why it is unavailable · the Source Control main button's pull-request step: Create pull request opens the composer, waits while the PR check loads, and the remote menu's "PR already merged" reason (the main-button and remote-menu cards on T-018-b)
- [ ] T-229 · GIT-024 AI drafts the PR title and description · GIT-025 Each workspace knows its branch's pull request · GIT-026 A PR link printed by an agent attaches to its workspace · GIT-029 [compat] Checks panel shows CI results and hands failures to AI · GIT-030 Read and answer PR review comments in Kolux · also: hand each row's pull-request state to the sidebar's pull-request grouping (T-022's `rows.ts`, `pr` field) so a merged one reads done and a suppressed one in progress
- [ ] T-230 · GIT-031 Send review comments to the agent · GIT-032 PR merge conflicts are explained, with AI resolve · GIT-033 Merge, auto-merge, merge queue and PR state actions · GIT-035 History panel draws the commit graph · GIT-036 History commit menu: copy, open or explain
- [ ] T-231 · GIT-042 Review notes on Markdown documents · GIT-043 Tasks page lists GitHub issues and pull requests · GIT-046 Create a GitHub issue from Tasks · GIT-047 Close, reopen and comment on issues · GIT-049 [compat] Start or resume a workspace from an issue or PR
- [ ] T-232 · GIT-050 Issue and PR preview dialog · GIT-051 Full pull request page · GIT-052 Review a PR's files and mark them viewed · GIT-059 Paste a GitHub URL to start work on it · GIT-060 GitHub repositories are recognised from any remote form
- [ ] T-233 · GIT-066 Git & worktrees settings page
- [ ] T-234 · EDIT-005 [compat] Find and replace inside a code file · EDIT-009 Merge conflicts are coloured and can be stepped through · EDIT-013 Rich markdown editing: slash menu, tables, lists, code blocks, toggles · EDIT-014 [compat] Links in notes: web links, [[note]] links and line anchors · EDIT-015 Images in notes: show local pictures, paste or insert new ones
- [ ] T-235 · EDIT-016 Contents panel, diagrams and maths in notes · EDIT-017 Find and replace in markdown preview and rich view · EDIT-021 Image viewer with zoom · EDIT-022 PDF viewer keeps its zoom and position · EDIT-030 CI check details tab with Fix with AI
- [ ] T-236 · EDIT-031 [compat] Editor tab header, closing tabs, and untitled files · EDIT-035 Explorer toolbar, name filter, row menus and live refresh · EDIT-037 [compat] Search file contents across a worktree with Mod+Shift+F · EDIT-039 Desktop drops land where they are dropped · EDIT-042 [compat] `kolux file` opens a file, a diff, or every changed file · also from T-093-a: a link in a terminal opens its file in an editor tab; anything waiting on a save is called off when the save fails, once something waits on one · also from T-093-c: kolux file diff opens the same diff tab, staged with --staged · also from T-093-d: kolux file's every-changed-file form opens the All Changes tab (AllChangesPane) · also from T-094-a: the explorer reads each folder once, when it is first opened, until live refresh lands · also from T-094-b: an editor tab open on a file renamed, moved or deleted from the explorer still shows the old path, so the tab follows a rename and says when its file is gone
- [ ] T-237 · EDIT-043 Open a worktree or folder in another editor or the file manager · EDIT-054 A new markdown note starts untitled and is named on its first save · EDIT-056 Every file tab has a view switch, including a Changes view of uncommitted edits · EDIT-057 Formatting toolbar above the rich markdown editor
- [ ] T-238 · BROW-004 Address bar suggests pages from history · BROW-007 [compat] Find in page · BROW-012 [compat] Each browser tab keeps its own zoom · BROW-013 Downloads land in the Downloads folder without overwriting · BROW-014 New-window links open as Kolux browser tabs
- [ ] T-239 · BROW-017 Right-click menu inside pages · BROW-018 [compat] App shortcuts still work while focus is inside a page · BROW-019 [compat] Close and reopen browser tabs · BROW-022 The jump palette finds open browser pages · BROW-025 [compat] Google sign-in works inside the pane
- [ ] T-240 · BROW-027 [compat] Browser session profiles keep logins apart · BROW-028 [compat] Bring cookies over from installed browsers or a file · BROW-033 [compat] Browser traffic follows the configured HTTP proxy · BROW-034 [compat] Viewport presets for phone, tablet and laptop · BROW-035 [compat] Grab a page element to hand to the AI
- [ ] T-241 · BROW-038 Draw on a page screenshot · BROW-039 Preview a worktree's HTML documents in a browser tab · BROW-044 [compat] CLI: list, switch, create and close browser tabs · BROW-045 [compat] CLI: manage browser session profiles · BROW-048 [compat] CLI: read and change cookies and web storage
- [ ] T-242 · BROW-049 [compat] CLI: intercept requests and read console and network logs · BROW-050 [compat] CLI: emulate devices, answer dialogs, use the clipboard · BROW-067 Preview a workspace's running dev server in a browser tab
- [ ] T-243 · SKILL-017 Skills page lists every skill the AIs can see · SKILL-018 Sidebar Skills button, off by default · SKILL-021 [compat] Where Kolux finds skills
- [ ] T-244 · ONB-014 Setup Guide dialog with a progress ring and a list of steps · ONB-017 Enable Kolux CLI step installs the CLI and agent skills · ONB-022 Explore Kolux workflow tour · ONB-027 [compat] Startup tips: one per launch, in a set order · ONB-028 CLI tip installs the CLI and skills
- [ ] T-245 · ONB-031 Contextual tour overlay: callouts with Back, Next, Skip and Done · ONB-032 [compat] Contextual tours appear once, only for new profiles, when the target is ready · ONB-033 Catalogue of contextual tours
- [ ] T-246 · SET-007 [compat] Search all settings · SET-012 Open, reveal or reload the keybindings file from Settings · SET-014 [compat] Decide whether Kolux or the terminal gets shortcuts first · SET-015 [compat] Tab and workspace keys suit the platform and keyboard layout · SET-019 [compat] Zoom the whole interface · also: the rest of T-054's card: opening Settings empties a search left over from before, and a section that only makes sense on one platform is hidden on the others; also SET 016 rule: a settings search unfolds every Appearance section that holds a match (sections are `<details class="look-fold">`); also SET 008 rule: each Shortcuts row says whether the command still works while a terminal has focus or is held back by the terminal policy; also SET 010 rule: on macOS a warning shows when the system grabs the chord (Mission Control desktop switching), only when the current keyboard layout really produces it; also SET 009 rule: tapping one modifier twice (Shift then Shift) can be recorded as a shortcut, counting only when the second press of the same key comes within about 300 ms with no other key between, no other modifier held and no key repeat (needs a spelling in the keybindings file and a timed matcher in the window's key handler)
- [ ] T-247 · SET-022 Terminal text, cursor and drawing · SET-025 Terminal input, clipboard and scrolling · SET-026 Default shell on Windows · SET-029 Install the command-line tool from Settings · SET-043 Bring skipped confirmations back; also SET 016 rule: the folded Terminal section's summary names the chosen terminal font (it shows the built-in one until then)
- [ ] T-248 · APP-008 Tray icon with a short menu and an attention dot · APP-009 Standard menu bar: File, Edit, View, Window, Help · APP-010 Settings and Help menu in the sidebar footer · APP-013 Zoom and tab-switch shortcuts work wherever focus sits · APP-015 Web addresses go to the default browser; the app window never navigates away · also: the rest of T-054's card: Settings in the app menu (File on Windows and Linux, under the app name on macOS) showing the Settings shortcut as a hint, and a View menu radio group for Agents, Board and Terminals; also VIEW 096 rule: View > Appearance > Show Status Bar in the menu bar (until then the bar comes back from Settings > Appearance); also SET 020 rules: the View menu's Appearance submenu holds Toggle Left Sidebar, Toggle Right Sidebar and tick boxes for the status bar, Tasks button, Automations button and title bar app name, each agreeing with its Settings switch (fields `statusBarVisible`, `tasksButton`, `automationsButton`, `titleBarAppName`), and changing the Automations button rebuilds the menu; also SET 010 rule: a chord that collides with a native menu accelerator counts as a clash on the Shortcuts page; also SET 009 rule: a shortcut changed on the Shortcuts page rebuilds the app menu so it shows the new accelerator (the page already sends `keybindings-changed` to every window)
- [ ] T-249 · APP-016 The clipboard handles files, images and verified text · APP-037 [compat] Send Feedback opens a pre-filled GitHub issue for the user to review · APP-055 [compat] `kolux diagnostics memory` prints a memory snapshot · APP-056 [compat] `kolux open` starts the app and waits until it is ready · APP-057 [compat] `kolux status` reports whether the app and its runtime are ready · also passes: PROJ-089 Crash reports and feedback from the sidebar
- [ ] T-250 · CLI-001 [compat] Help on every level of the command tree, plus a version flag · CLI-002 [compat] Argument grammar: flags, values, aliases and bare arguments · CLI-008 [compat] Register or remove the kolux command for the whole system · CLI-022 [compat] kolux file open, diff and open-changed · CLI-045 [compat] Browser tabs and profiles (kolux tab)
- [ ] T-251 · CLI-046 [compat] Browser page interaction through snapshot references (kolux snapshot, click, fill and more) · CLI-047 [compat] Browser state, emulation and capture (kolux cookie, storage, set, screenshot and more)

## 3. P2: present, rarely used


### P2 · theme 1 · Session-per-pane terminal grid (9 cards)

- [ ] T-252 · TERM-008 Tidy the grid · TERM-016 Move a pane out into its own tab
- [ ] T-253 · VIEW-109 Keyboard layouts, Option as Alt and key protocols · VIEW-110 Clipboard size limits and terminal copy
- [ ] T-254 · ACCT-052 macOS terminals start as real login sessions · ACCT-053 Wide characters are not doubled in Windows terminals · ACCT-060 Terminal modes reset sensibly when an agent exits · ACCT-061 Terminal links open only when safe
- [ ] T-255 · ORCH-042 [compat] Agent Teams teammates open as real side-by-side panes

### P2 · theme 2 · Isolation: one worktree per agent (1 cards)

- [ ] T-256 · TERM-119 Shell history per worktree

### P2 · theme 3 · Knowing what each agent is doing (7 cards)

- [ ] T-257 · SESS-040 Busy spinners and tab titles credit the agent that was launched
- [ ] T-258 · TERM-056 Tab title tooltip and generated titles
- [ ] T-259 · STAT-036 Count of working agents per workspace
- [ ] T-260 · VIEW-013 [compat] Floor timeline of agent activity · VIEW-111 First-run notification permission
- [ ] T-261 · ACCT-063 Each agent pane has one clear owning session
- [ ] T-262 · ORCH-060 Session tab inventory the command line and agents can read

### P2 · theme 4 · Accounts, sign-in and usage limits (9 cards)

- [ ] T-263 · USAGE-019 Share a usage card as a picture or a post · USAGE-024 Reset times count down live · USAGE-025 Choose whether usage reads as used or left · USAGE-026 [compat] Gemini and Antigravity quota reading · USAGE-027 [compat] Kimi and MiniMax quota reading
- [ ] T-264 · ACCT-022 Choose which Codex folder past sessions come from · ACCT-028 [compat] MiniMax credentials for usage tracking · ACCT-029 [compat] Use Gemini CLI credentials (experimental)
- [ ] T-265 · SET-059 Optional prompt-cache countdown once a Claude agent goes idle

### P2 · theme 7 · Redesign and the new look (10 cards)

- [ ] T-266 · PROJ-017 Project headers have a colour · PROJ-062 Workspace cards: Default and Compact looks
- [ ] T-267 · TERM-011 Inactive panes dim · TERM-026 Pane header density · TERM-057 Tab strip overflow scrollbar · TERM-102 Minimum contrast and ligatures
- [ ] T-268 · VIEW-052 [compat] Left sidebar tint
- [ ] T-269 · BROW-006 Address bar folds up in a narrow pane · BROW-011 Loading pages match the app theme
- [ ] T-270 · SET-021 Left sidebar look and worktree card density

### P2 · theme 5 · Safety and trust (3 cards)

- [ ] T-271 · SAFE-027 The floating workspace opens only in folders the user picked
- [ ] T-272 · BROW-016 Runaway pages cannot flood the user with tabs · BROW-032 Site permission requests in the pane

### P2 · theme 9 · Reliability and no lost work (30 cards)

- [ ] T-273 · PROJ-087 Claude finds each workspace's history on Windows
- [ ] T-274 · TERM-095 Link detection never freezes on huge lines · TERM-137 Shell hooks from different Kolux builds coexist
- [ ] T-275 · STAT-031 Agents that are gone stop reporting
- [ ] T-276 · VIEW-090 Scan notices in the session list · VIEW-092 Session scans run in the background and survive restarts · VIEW-115 The shell avoids needless redraws
- [ ] T-277 · USAGE-028 Resource Manager lists terminals picked up after a reload
- [ ] T-278 · ACCT-054 Fast output never freezes a pane · ACCT-059 Memory caps scale with the machine
- [ ] T-279 · ORCH-035 A task that keeps failing is no longer handed out · ORCH-057 Many viewers follow one terminal without drifting apart · ORCH-059 Closing a terminal retires it everywhere
- [ ] T-280 · SAFE-028 Saved settings come back valid after a restart
- [ ] T-281 · GIT-012 Huge change sets are capped, with an offer to ignore heavy folders · GIT-045 Tasks explains empty lists, missing sources and sign-in trouble · GIT-048 Edits in Tasks appear at once and do not flip back · GIT-070 Git stays quick across many worktrees
- [ ] T-282 · EDIT-008 Huge pastes keep the window responsive or are turned away
- [ ] T-283 · BROW-010 Pages are checked again after the computer wakes · BROW-043 Leftover browser helper processes are cleaned up
- [ ] T-284 · SKILL-023 An interrupted skill delete is undone or completed on restart
- [ ] T-285 · SET-042 End every terminal session in one go · SET-060 Restart the background terminal service · SET-062 macOS warns when terminal commands lose the app's permission grants · also: the rest of T-037's card: the Resource Manager offers to restart the terminal service, asking first; on macOS its free memory follows memory pressure (it shows unknown there now)
- [ ] T-286 · APP-003 Startup failures and stray background errors never silently kill the app · APP-017 After sleep the window repaints, and hidden windows stop doing interface work · APP-040 Only real crashes are recorded, with useful context · APP-051 Stale worktree records are cleaned up safely
- [ ] T-287 · CLI-041 [compat] kolux diagnostics memory

### P2 · theme 11 · Orchestration and automations (8 cards)

- [ ] T-288 · PROJ-036 Linked issues can start with a per-project issue command
- [ ] T-289 · TERM-036 Copy session, terminal and pane IDs · TERM-096 Links to other terminals and orchestration tasks
- [ ] T-290 · ORCH-043 Kolux checks whether each agent has the orchestration skill
- [ ] T-291 · AUTO-023 Automations row in the sidebar, off by default · AUTO-024 Hide or tag worktrees made by automations
- [ ] T-292 · SKILL-025 Skill freshness pill · SKILL-027 Status bar shows a running skill update · also passes: VIEW-100 Skill and app update progress in the status bar

### P2 · theme 8 · Release, update and CI pipeline (1 cards)

- [ ] T-293 · APP-030 An update whose Windows signature does not match is stopped, with no bypass

### P2 · theme 6 · Business-user frame (6 cards)

- [ ] T-294 · PROJ-035 Sidebar card that suggests adding a setup script
- [ ] T-295 · VIEW-114 Onboarding checklist and setup guide in the sidebar
- [ ] T-296 · ACCT-035 The first connection is recorded; failures name the agent
- [ ] T-297 · SKILL-016 Kits tick off first-run milestones and carry a tour anchor
- [ ] T-298 · ONB-009 Reopen the wizard from the sidebar help menu · ONB-011 [compat] First-success milestones are recorded locally and appear in diagnostics

### P2 · theme 10 · Identity and originality (4 cards)

- [ ] T-299 · PROJ-019 Choose a project icon or emoji by hand · PROJ-024 Names of deleted workspaces are not suggested again
- [ ] T-300 · SET-041 Window, tray and app icon choices; also SET 016 rule: the app icon chooser sits at the bottom of Settings > Appearance (after Window & Sidebar)
- [ ] T-301 · APP-012 App icon choice and window look options

### P2 · theme none · No theme (110 cards)

- [ ] T-302 · PROJ-009 Projects with the same folder name stay distinguishable · PROJ-018 Projects pick up an icon from the repository · PROJ-029 Hint when the local base branch is behind its remote · PROJ-043 A card for outside worktrees heads each project · PROJ-054 Jump back to the current workspace or to the top · PROJ-058 Select several workspaces at once
- [ ] T-303 · PROJ-061 Type :shortcodes: to insert emoji · PROJ-069 Repositories are tidied quietly in the background · PROJ-075 Delete the workspace under the pointer · PROJ-081 Cleanup filters, search and sorting · PROJ-088 Friendly local addresses for each workspace's dev server
- [ ] T-304 · SESS-039 Open a worktree in an outside editor
- [ ] T-305 · TERM-018 Focus follows mouse · TERM-053 Search open tabs · TERM-062 Shortcuts inside the floating panel · TERM-066 Copy on select · TERM-067 [compat] Select all in a terminal · TERM-072 Right-click to paste
- [ ] T-306 · TERM-073 Middle-click paste of the selection · TERM-082 Enhanced keyboard protocol for modern TUIs · TERM-084 Yen key types backslash (JIS keyboards) · TERM-085 [compat] Switch input source shortcut · TERM-086 Control keys work on non-Latin keyboard layouts · TERM-087 Hide the mouse pointer while typing
- [ ] T-307 · TERM-088 Selecting text in mouse-capturing programs · TERM-089 Mouse wheel scroll speed · TERM-091 Scrollback length · TERM-094 Link action menu · TERM-099 [compat] Import settings from Ghostty · TERM-100 [compat] Import Warp themes · also passes: VIEW-105 Link popover: choose where a link opens
- [ ] T-308 · TERM-101 Cursor style · TERM-104 Correct rendering of complex scripts and emoji · TERM-121 Setup script runs in its own tab · TERM-133 Colour-code a tab · TERM-135 First web link click asks where links open
- [ ] T-309 · STAT-038 Pull request status refreshes when an agent finishes · STAT-043 [compat] Notification sound, custom file and volume
- [ ] T-310 · VIEW-039 Palette list caps and focus return · VIEW-072 [compat] Send or clear review notes · VIEW-106 [compat] View, Help and Appearance menus · VIEW-113 Markdown view preferences · VIEW-117 Hover-only buttons stay visible on touch screens · VIEW-118 Select changed files and stage or unstage them together
- [ ] T-311 · ACCT-030 Settings search finds account sections · ACCT-033 Commit-message model choices are discovered per agent · ACCT-057 Task sources fall back to GitHub · ACCT-058 Review-bot authors can be overridden · ACCT-062 Nim files get syntax colours
- [ ] T-312 · ORCH-061 Runtime browser commands for agents · ORCH-062 Runtime file commands for agents · ORCH-063 Runtime git and GitHub calls · ORCH-064 Runtime calls for past sessions and automations
- [ ] T-313 · GIT-008 Pull guides the user when git has no pull policy · GIT-010 Pushing to a fork is flagged · GIT-013 Submodules show as single rows · GIT-014 Filter the changes and act on a file from its menu · GIT-019 Source Control AI actions tuned per action and per repository · GIT-034 Stacked pull requests
- [ ] T-314 · GIT-044 [compat] Opening Tasks and its default view · GIT-053 Mentions, reviewers and avatars · GIT-054 Filter PR lists · GIT-055 Forks: issues from upstream or from the fork · GIT-056 GitHub Projects as an editable table · GIT-057 GitHub Projects roadmap timeline
- [ ] T-315 · GIT-058 Paste a GitHub URL into the quick switcher · GIT-062 A failed clone gives one line of reason · GIT-064 Workspace label shows the branch or a detached commit · GIT-069 [compat] Open changed files from the CLI · GIT-071 Invitation to star the project on GitHub
- [ ] T-316 · EDIT-006 [compat] Word wrap, editor font, zoom and minimap · EDIT-010 [compat] Colouring for Astro, Svelte, Vue, Nim and JSON Lines files · EDIT-011 File-type icons and natural name order · EDIT-018 Export a note to PDF · EDIT-023 [compat] CSV and TSV files shown as a table · EDIT-024 [compat] Jupyter notebooks: edit cells and run Python
- [ ] T-317 · EDIT-025 Preview an HTML file in the built-in browser · EDIT-026 Follow a growing log file live · EDIT-038 Search the worktree for what is selected in the editor · EDIT-048 Search in the repository and base-branch pickers · EDIT-049 [compat] Settings search stays responsive · EDIT-050 Project picture taken from an icon file in the repository
- [ ] T-318 · EDIT-055 [compat] New notes can start from the repository's own templates
- [ ] T-319 · BROW-023 Tabs show the site icon and page title · BROW-026 Sites fall back to popup sign-in when FedCM is off · BROW-030 A hint in the toolbar offers to bring logins over · BROW-041 Turn a document preview into a web page and back · BROW-052 Drags pass across browser pages
- [ ] T-320 · SKILL-020 Skill row actions and skill details
- [ ] T-321 · ONB-015 Setup Guide steps tick from real state, not from clicks · ONB-016 Setup Guide actions for workspaces, notifications and the default agent · ONB-018 Connect integrations step: GitHub review and tasks · ONB-020 Sidebar onboarding checklist entry · ONB-023 Explore Kolux marks a stop complete only after a visit and real setup · ONB-024 Explore Kolux stops carry their own setup cards
- [ ] T-322 · ONB-025 Explore Kolux animations respect visibility and platform · ONB-029 Command palette tip with a one-time demo · ONB-037 [compat] GitHub star prompt: when it shows · ONB-038 GitHub star prompt: starring and its states · ONB-042 Kolux remembers on this machine which features each profile has used
- [ ] T-323 · SET-024 [compat] Bring in terminal schemes from Warp and Ghostty · SET-038 Editor and diff preferences · SET-039 Pick the outside apps listed under Open in · SET-040 Network proxy · SET-061 The mouse wheel scrolls long pickers and menus, dialogs included; also SET 018 rule: the editor draws in `--editor-font`, which already falls back to the terminal font when the Editor font field is empty
- [ ] T-324 · APP-007 Optional: closing the window hides the app to the tray (Windows) · APP-014 Right-click menu in text fields with spelling suggestions and edit actions · APP-019 Markdown files opened from the system open inside the app · APP-022 [compat] More memory headroom for the interface on bigger machines · APP-032 A network proxy can be set for the app's own traffic · APP-038 Screenshots can go with feedback and land on the clipboard for pasting · also: USAGE 009's rule that a usage alert held back while the window is hidden still puts the attention dot on the tray icon

## 4. H cards marked build (27; the other 113 H cards are skipped as DECISIONS.md section 3 records)


### H · theme 3 · Knowing what each agent is doing (14 cards)

- [ ] T-325 · CHAT-002 Which sessions can be shown as chat · CHAT-006 Chat follows the agent's transcript live, even before the file exists · CHAT-007 [compat] Finding and reading each agent's transcript · CHAT-010 Each message once, in order, without system noise · CHAT-011 The reply streams in while it is being written
- [ ] T-326 · CHAT-012 Reasoning, compaction, plans and provider notices · CHAT-013 Tool calls fold into the agent's turn · CHAT-014 File edits show as diff cards · CHAT-015 Subagents appear as one roster row · CHAT-016 Responding, thinking and working indicators
- [ ] T-327 · CHAT-017 Chat message box · CHAT-020 Sending from chat types into the agent's terminal · CHAT-022 Answer an agent's question with a card · CHAT-027 Chat sticks to the newest message

### H · theme 4 · Accounts, sign-in and usage limits (1 cards)

- [ ] T-328 · USAGE-031 Forecast of when a usage window runs out (off screen since 2026-10-05)

### H · theme 5 · Safety and trust (3 cards)

- [ ] T-329 · CHAT-018 Stop interrupts the agent · CHAT-023 Allow or deny a tool permission in chat · CHAT-025 Links in chat open files and web pages

### H · theme 9 · Reliability and no lost work (2 cards)

- [ ] T-330 · CHAT-009 Hidden chats pause reading and keep their last good view
- [ ] T-331 · HID-036 [compat] Retired settings quietly dropped when an old profile loads

### H · theme 11 · Orchestration and automations (1 cards)

- [ ] T-332 · CHAT-028 Files the agent wrote, with send to another agent

### H · theme 6 · Business-user frame (1 cards)

- [ ] T-333 · ONB-013 Newcomer setup checklist with four plain first-success items

### H · theme none · No theme (5 cards)

- [ ] T-334 · CHAT-008 Long conversations load in pages · CHAT-019 Autocomplete for slash commands, skills and file mentions · CHAT-021 Attach images and files to a message · CHAT-024 [compat] Model and effort controls beside Send · CHAT-026 [compat] Chat text zoom

## 5. X cards: replace third-party assets with Txais's own (never copied)

Until these pass, earlier cards use a neutral placeholder (a text label or initial), except the Claude Spark already sourced from Anthropic's public kit in T-003b (the OpenAI mark waits for a kit file; its hand-redrawn stand-in was removed).

- [ ] T-335 · SESS-044 Third-party agent logos in pickers · TERM-131 Agent brand marks in pane headers and tabs · VIEW-104 Third-party provider logos in usage UI · SET-048 Other companies' logos on settings pages · HID-039 Bundled agent maker logos (29 images plus an OpenClaude logo) · HID-040 Redrawn provider marks (Claude, OpenAI, Gemini, MiniMax and others) · HID-041 Agent icons fetched live from Google's favicon service · HID-043 Shell, editor and terminal-app logos · HID-044 Integration and phone-platform logos (GitHub, GitLab, Jira, Linear, iOS, Android) · reinterpreted by Txais 2026-10-08: vendor marks STAY as model and provider indicators (nominative use), sourced only from each vendor's public brand kit with its URL, date and terms in src/assets/vendors/NOTICE.md, never from the old app; shells, editors and integrations likewise from public kits or as names; nothing fetched at run time
- [ ] T-336 · USAGE-020 X logo on the post-sharing button · a plain share icon or the word Share
- [ ] T-337 · ONB-026 Feature tile recordings and other tools' names in their captions · new recordings of Kolux RS itself; captions name no other tools
- [ ] T-338 · HID-042 Pet character art (Claudino and Gremlin) · no asset while the pet stays out; the task is a check that nothing of the old art ships

## 6. Never planned

The 120 D cards (dropped by Txais on 2026-10-05, including all of area 18) and the 113 H cards
marked skip stay listed in `DECISIONS.md` only.

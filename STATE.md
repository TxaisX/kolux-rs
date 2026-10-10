# STATE
Status: RUNNING            (RUNNING | PAUSED | BLOCKED: reason)
Phase: 3                   (Phase 1 was done by the dirty-room team on 2026-10-06; Phase 2, the plan, on 2026-10-07)
Budget: 6 passes per day   (today: 17, date: 2026-10-09)
Next task: T-018 · GIT-002 Stage and unstage by file, folder or section · GIT-004 Commit from the panel with a message · GIT-006 The main button always proposes the next step · GIT-007 Remote actions from the panel
Done: 23 / 341 tasks  ·  P0 parity: 0/228 cards

How to read this: `PLAN.md` holds the 341 tasks in build order; each names the spec cards it must
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

T-004 adds the first agent launch: "+ New session" in the sidebar and the "+" in any pane header open
a menu listing Claude Code and Codex; an agent whose program is not on the PATH is greyed "not
installed". Picking Claude Code makes a fresh worktree off main with a creature name (adjective +
sea creature, e.g. `jade-seahorse`, unique across every project's folders and branches) and opens a
pane running `claude --permission-mode auto` in it; the header shows the Claude mark, the creature
name, a branch chip, "Claude" and "Running"; the sidebar lists the worktree with a live dot; closing
the pane ends the Claude process. Panes sit side by side (1, 2 or 3 columns) until the real grid in T-009.

T-005 makes shortcuts the user's own: Kolux reads `~\.kolux\keybindings.json` at start (creating it
empty when missing, through a temporary file), knows all 127 carried command ids with their
built-in chords per platform, applies the file's all-platforms section and then its win32 section
(a chord, a list of chords, or null / false for unbound), warns about and ignores ids it does not
know, keeps the default for any entry with a bad chord, drops a custom chord that clashes with
another in the same place, and shows a red notice when the file will not parse while leaving the
file alone. The search box chips and "Next that needs you" read their keys from that map (an
override shows at once at the next start; unbound shows "Unassigned"). Ctrl+B hides and shows the
sidebar and Ctrl+Alt+V cycles Agents / Board / Terminals through the keymap. The app icon and the
top-left mark are now Txais's own (design/icon/).

T-006 makes the sidebar rows a switch: a click on a workspace row (main checkout or worktree)
shows that workspace's panes on the same click and highlights the row; every other workspace's
panes stay mounted but hidden, so switching back finds each terminal exactly as it was (same
output, same program, no resize). A workspace with no pane yet gets a plain shell on first click;
a workspace whose last pane was closed shows "No terminal open here" with an "Open a shell"
button. A launch from the plus menu switches to the new worktree. Removing a workspace from the
sidebar closes every pane inside it wherever it was, and the view falls back to the start-up
PowerShell pane if the removed one was in front.

T-007-a fills the agent catalogue: all 34 visible agents of SESS-001 in its order, each with its
program name(s) from SESS-051 and its fixed start arguments (Kiro `chat --tui`, Command Code
`--trust`, Hermes `--tui`). Detection walks the PATH and then the usual install folders (npm's
global bin, nvm's current or newest version, `~\.local\bin`, cargo, bun, volta, WinGet links,
scoop shims, `%LOCALAPPDATA%\Programs\*`) without spawning anything; only a runnable file with a
PATHEXT ending counts, never a folder or a plain file. The plus menu now lists only the agents that
were found (on this PC: Claude Code and Codex), the default agent first with the "new agent tab"
shortcut beside it when one is bound, and every other row has a "default" button; the choice is
saved as `defaultAgent` in `settings.json` and the bound shortcut (`tab.newAgent`) starts the
default agent. An npm-installed agent whose entry is a `.cmd` shim (Codex) now starts through
`cmd.exe /d /c`, as the command line would.

T-007-b adds the chooser pane (SESS-007): the plus menu (sidebar "New session" and a pane's "+")
has a "Choose what to run…" item, and an empty workspace offers a "Choose what to run" button;
either opens a pane titled "Session N · Choose what to run" in which nothing runs yet. Each seat is
a radio group of the installed agents plus Terminal, and once an AI is picked a second radio group
asks for the model (Claude Opus/Sonnet/Haiku, Codex GPT-5 Codex/GPT-5, Gemini, Cursor, Grok lists,
plus "Program default" for every agent, which adds no flag); Start stays disabled until every seat
has both picks, Terminal counts as ready at once. A count row (SESS-013) offers 1, 2, 3, 4, 6, 8
and a free number field (applied on Enter, blur or the spinner, so typing "15" never passes
through a one-seat moment): new seats arrive empty, shrinking drops seats from the bottom and keeps
the rest untouched, 15 gives fifteen seat blocks in a scrolling body. Start replaces the chooser
with one pane per seat in the same grid position: agent seats run in the chooser's workspace (or in
one fresh worktree when the chooser sits outside any workspace) with `--model <id>` appended to
the start line, terminal seats open a shell in the same folder. The chooser's close button is
absent when it is the only pane shown.

T-008-a finishes the seat rules (SESS-015) and the landing (SESS-024). The chooser opens on the
caption "Every seat starts blank. Kolux never picks an AI or a model for you."; a "Same for all"
button, greyed until a seat is finished (and with one seat), copies the first finished seat's AI
and model into every seat while job titles stay per seat; a pick whose agent is no longer detected
is cleared, never swapped. Each seat has a "Job title (optional)" field. Start shows a passing
toast ("Starting 3 sessions"), the panes land one per seat and the grid re-tiles; a seat's job
title names its pane (the workspace chip still shows the worktree), a pane without one keeps the
workspace name, and a pane outside any workspace reads "Terminal N". A pane whose session fails
to start is dropped instead of left blank, with the reason in a toast, and "Nothing started: …"
when the whole lineup is gone. Without a project the error toast explains that an agent needs a
repository.

T-008-b gives every catalogue agent its start line and opening-prompt route (SESS-051). An AI seat
in the chooser has an "Opening prompt (optional)" box; the back end builds the line from the
catalogue: the prompt goes last for Claude Code, OpenClaude, Codex, Pi, OMP, Command Code, Cursor
and Droid, behind `--` for Trae, Prime Agent and Grok (a prompt beginning with a dash stays the
task), behind `--prompt` for MiMo, `--prompt-interactive` for Gemini CLI and Antigravity, `-i` for
GitHub Copilot, and through `chat --query <prompt> --tui` for Hermes (the user's own `--query` /
`--tui` arguments give way; a line past 24,000 characters is refused and Start reports it); the
other agents start bare and the prompt is typed in once the program has drawn its screen and gone
quiet. A blank prompt adds nothing. A foreground matcher credits a running program to its agent
(case, folder and `.exe`/`.cmd` endings ignored, `kimi-code` → Kimi, `mistral-vibe` → Mistral
Vibe, `codex-…`/`grok-…` builds, and interpreter runs such as `node …/claude-code/cli.js`); nothing
polls it yet.

T-009 turns the pane area into a real grid (TERM-001, TERM-004, TERM-006, TERM-014). A workspace
holds 1 to 12 panes tiled in balanced rows (1, 2, 2x2, 3x2, 3x3, 4x3; `src/terminal/grid.ts`).
The layout strip's 1 / 2 / 4 / 6 buttons set the count of the workspace in front and the pressed
button is the current count (none at 3, 5 or above 6): growing adds empty chooser panes, nothing
starts on its own; shrinking removes unstarted panes newest first and never a started session (a
toast says to close one instead). Every pane header has a split button that opens a shell beside
it in the same folder; Ctrl+Shift+D (split right), Alt+Shift+D (split down: the cell below) and
Ctrl+W (close the focused pane) go through the shortcuts file. Closing a pane ends its program and
the neighbours take the space; closing the last one leaves the workspace's empty placeholder.

T-010 gives every grid cell tabs (TERM-040, TERM-041, TERM-068). The strip's "New tab" menu (and
Ctrl+T) opens a shell as a tab beside the focused pane, started in the workspace folder and ready
to type; the menu also lists every installed agent, each with its own `tab.newAgent.<id>` command
(unbound unless the shortcuts file says otherwise) that opens a tab with that agent starting in the
workspace folder; outside any workspace an agent still gets a fresh worktree. A cell with one tab
shows no tab strip (the clean look); with two or more, the strip sits above the pane and each tab
closes from its own x, the next tab taking over. A requested start folder for a new terminal may
be relative to the workspace or absolute, and a missing one falls back to the workspace folder.
Paste (Ctrl+V, Ctrl+Shift+V, Shift+Insert) goes through the focused pane's own text area, so it
can never land in another pane, and a paste made while an opening prompt is still owed waits for
it.

T-011 gives the Board its first life (VIEW-026). The Board lists every pane of every workspace as
a card (the pane header: status, name, program, the header buttons), in cell and tab order; a
card's expand button shows that session's live terminal inside the card and the same button
collapses it again. The panes never move in the page: the grid and the Board are the same cells
drawn two ways, so the program, its scrollback and the pane's place in the grid are untouched
by expanding, collapsing or switching screens (a command typed in the card shows in the grid
pane afterwards, and the other way round). Switching to Agents or Board no longer unmounts the
terminals (it did before T-011).

T-012-a adds browser tabs (BROW-001, BROW-002). The New tab menu's "Browser" item (Ctrl+Shift+B)
opens a "New Tab" beside the focused pane: a pane whose header is a globe, the page title and an
address bar that takes the cursor at once, over a blank page. The page is a real child web view
of the window (Tauri `Window::add_child`, feature `unstable`), laid over the pane body and moved
with it, so sites render exactly as in Edge, without the iframe limits. Away means hidden, never
torn down: switching to another tab, to the Board or to Agents keeps the page's scroll, form
fields and history, and a page's `window.close()` does nothing to the tab. The tab is named after
the page's title. The bar takes a full address only until T-012-b (typed words, back / forward,
reload / stop).

T-012-b makes the bar and the toolbar work (BROW-003, BROW-005). Enter reads the bar: a full
web or file address is taken as is, `localhost:3000` opens over HTTP, `example.com` over HTTPS,
an absolute path on disk as a file address, and anything else is a Google search; `javascript:`,
`mailto:` and every other scheme are refused with a red notice and the page stays. Ctrl+L
puts the cursor in the bar with its text selected. Back and forward sit before the bar and dim
when there is nothing that way; reload turns into Stop inside a spinner while a page loads.
History is the tab's own record of its loads (a redirect replaces its entry), since the web
view does not say whether it can go back. The harness now drives the app through WebView2's
own debugging port (`scripts/evidence/cdp.mjs`), so chords and typing land even while another
window holds the foreground.

T-013 finishes the project and workspace flow (PROJ-001, PROJ-007, PROJ-020, PROJ-021). Adding a
project, whichever worktree was picked, registers its main checkout, opens that checkout with a
shell and lists its worktrees, minus a coding tool's scratch worktrees (any worktree under a
dot-folder inside the checkout, such as Claude Code's `.claude/worktrees/`). Mod+N or the
header's plus opens the name field for the project in front; the preview shows the branch and
folder the name becomes, a name with no usable letters is refused in the field, and a taken
branch or folder name gets `-2`, `-3`, counting local and remote branches. Create shows a
stand-in row at once; the new workspace then opens with its own shell unless the user moved to
another workspace meanwhile. The row shows the name as typed (emoji included), the branch and
folder carry the cleaned form; typed names live in the state store under `workspaceNames`.

T-014-a decides where a workspace goes and what it starts from (PROJ-025, PROJ-028, PROJ-038).
The footer gear's form sets the global workspaces folder and the layout: nested (a folder per
project, the project's folder name minus `.git`) or flat (every workspace side by side). The
project row's gear sets that project's own folder (absolute, or relative to the project root)
and base ref; folders used before are offered from a list. Create starts the branch from the
typed ref, else the project's saved base, else the default branch (origin/HEAD, then
main/master, then the current branch). A remote-tracking base is fetched first; a saved base
that no longer exists falls back to the default branch and says so in the sidebar note; a full
commit id is used as is. The create form also takes an agent and a first prompt: with an agent
chosen the workspace opens with that agent running as its first tab and no shell.

T-014-b is the first command line (PROJ-077). The app listens on a loopback port and writes the
port and a token to `cli.json` in its data folder; `kolux-dev` (`src-tauri/src/bin/kolux-dev.rs`,
all logic in `src-tauri/src/cli.rs`) sends one request per call. `kolux-dev worktree create
--name <name>` makes a workspace in the project the shell is standing in (or `--repo`
id:/name:/path:), from `--base-branch` or the project's base; `--agent` with `--prompt` starts
that agent in the new workspace's first tab, in the background unless `--activate` (or the older
`--run-hooks`) shows it. `worktree rm` (also remove, delete) takes `--worktree` current, name:,
branch:, path: or id:, refuses a checkout with uncommitted changes unless `--force`, closes its
panes and removes it. `--json` prints the envelope (request id, success, result or error with
code, message and data, runtime id); exit 0 worked, 1 any error; help works with the app closed,
and a closed app answers "Kolux is not running; start it first".

T-015 gives the chooser a "Folders" row (SESS-014): "Separate copy for each AI" or "Same folder
for all". With two or more seats in a Git project the separate copy is picked for you; one seat,
or no Git project, picks the shared folder (and the separate choice is disabled with "Not a Git
project: there is nothing to copy"). Choosing the shared folder with several seats shows a
warn-coloured note, "Several AIs would be editing the same files at once", with a one-click
"Give each its own copy". On Start every agent seat with separate copies gets a fresh
creature-named worktree of its own (SESS-023), made one after another so no two seats ever take
the same name; a terminal seat stays in the chooser's folder. Every creature name ever handed
out is kept under `creatureNamesUsed` in the store, so a removed worktree's name never comes
back.

T-016 adds `kolux-dev orchestration worker-start` (ORCH-016): `--spec <text>` makes a task
(`task-N`, title from `--task-title` or the brief's first line) or `--task <id>` takes an
existing one; `--agent <id>` names who runs it, or `--tier major|deep|build|light` picks the
model and effort from the shipped routing (Claude: fable/high, opus/high, sonnet/medium,
haiku; Codex since T-081: gpt-6-sol at high, high, medium, low; see Model routing below).
`--worktree` defaults to `new-top-level`: a fresh creature-named worktree (or `--name`/
`--base-branch`/`--display-name` for a shaped one); `current` or a selector reuses one. The app
opens the worker as a background tab named after the task, with the brief as the first prompt,
and the command waits (default 60 s, `--timeout-ms`) until the agent has written and is still
there a second later, then prints a receipt (dispatch id, task id, worktree, terminal id, model,
effort, `setup: not_configured`); a timeout answers `timeout` with the same receipt in `data`.
Every flag mix the spec refuses is refused before the app is asked; `--terminal` answers
`unsupported` until terminal handles exist. Tasks and dispatches live under
`orchestration.tasks` / `orchestration.dispatches` in the store.

T-017-a pre-trusts every folder a Claude launch will use (SAFE-023 / SAFE-024): before any
Claude process starts, the worktree and its main repository are marked
`hasTrustDialogAccepted` in Claude's own `.claude.json` (under `CLAUDE_CONFIG_DIR`, else the
home folder), keyed by the real path on disk with forward slashes. One write covers a whole
launch (every seat of a chooser Start, a new tab, a sidebar launch, or a `worker-start` from
the command line); an already-trusted folder changes nothing; a file that is not valid JSON is
left alone; at most 12 folders per launch. The step is best effort: a failure is logged and
the launch goes on. Claude therefore goes straight to the first prompt in a fresh worktree
instead of halting on its "Quick safety check" menu.

T-017-b does the same for Codex: before a Codex worker starts, the worktree and its main
repository are written to Codex's own `config.toml` (under `CODEX_HOME`, else `~/.codex`) as
`[projects."<real path, lower-cased on Windows>"] trust_level = "trusted"`, the key form Codex
itself writes. The file is edited with `toml_edit`, so every other line, comment and the key
order stay byte for byte; an already-trusted folder changes nothing; a file that is not valid
TOML is left alone. Same batch rules and the same one lock as Claude (`checked_keys`,
`write_whole` shared by both). Cursor and Copilot still get nothing (T-017-c).

T-086 (orchestration lane) adds the Automations page (AUTO-016, AUTO-019): the clock
button in the sidebar footer opens it over the content column (the pane grid stays alive
underneath; picking a workspace closes the page). A toolbar holds a search box (focused on open;
it looks at name, project, worktree, agent and the first 2,048 characters of the prompt, ignores
case and extra spaces, keeps its text across Refresh, refuses more than 200 characters), filters
(on / paused, last run's result, several agents at once), Refresh, and Runs / New Automation,
present but greyed until T-130 / T-085. The table keeps its header and first column in view,
sorts names the way people count ("Report 2" before "Report 10") and by last run with never-run
ones last; the first row is selected on open and the detail shows the on/off switch, Run now,
the prompt and the numbered runs. Each row's menu (Run now, Pause/Resume, Edit greyed until
T-085, Delete) acts without changing the selection. Delete asks first in an inline bar with
"Don't ask again" (setting `confirmAutomationDelete`, on out of the box); deleting removes the
automation's runs too. There are three different empty states: nothing created, nothing matches,
and a load failure with Retry. Run now works on a paused automation as well: `automations.rs`
records a manual run with its own number (numbers only go up), places it in the automation's
worktree or a fresh one, trusts the folder, and opens a background tab named after the
automation that runs the prompt. If the project is gone the run is marked skipped, and if the agent is
missing it is marked failed. Automations live under `automations` / `automations.runs` in the store; the clock that
starts them on time is T-085.

T-087 (orchestration lane) adds Model routing (SET-028): the sliders button in the sidebar
footer opens a page with one tab per provider that can route by tier (Claude Code, Codex) and a
row per tier (Major, Deep, Build, Light), each with a model picker ("Provider default" first) and
an effort picker. A model with no effort levels (Claude Haiku) hides the effort picker, and a new
model keeps the effort while it still offers that level, otherwise the effort goes back to
Default. Picks are saved in settings under `modelRouting`; a tier nothing was saved for uses the
shipped ladder (`src-tauri/src/routing.rs`, the same table ORCH-018 used). `kolux-dev
orchestration worker-start --tier <t>` now reads those picks, so the worker starts with the
picked model. Every agent pane started with `--model` (a seat's pick or a worker's tier) names the
model in its header ("Claude · haiku"). The reset button and the "not on this computer" mark are
still to come in T-081.

T-081 (orchestration lane) completes Model routing for ACCT-034: each provider tab carries a
"Not detected" mark when this computer lacks that program, and stays selectable. "Reset <provider>"
(greyed when nothing was changed) puts back that provider's shipped ladder and leaves the other
provider alone. Codex's ladder now follows DT-12: the newest Codex model, gpt-6-sol, at high for
Major and Deep, medium for Build and low for Light. Its model list (GPT-6 Sol / Astra / Luna,
GPT-5.6 Sol / Terra / Luna, GPT-5.5) and each model's effort levels come from Codex's own models
cache on this PC. Claude's levels come from `claude --help` (low to max). A 0.15.0 profile's
routing table is carried over by the settings importer (T-181).

T-077 (orchestration lane) nests child workspaces under their parent (PROJ-047). A worker started
with `orchestration worker-start --worktree new-child` from inside a workspace gets a new
workspace listed indented under the one it was called from, to any depth (child, grandchild...).
A row with children has a chevron that folds them away and back. When a parent is removed, its
children move to the top level. The footer gear has a checkbox, "Nest child workspaces under their
parent"; unticked, every workspace sits at one level. The parent is remembered in the app's store
(`workspaceParents`) and forgotten when the workspace is removed.

T-085-a (orchestration lane) makes automations on a timetable (AUTO-001, AUTO-005). New
Automation and a row's Edit open one dialog: a name, a large prompt editor (Ctrl+F opens a find bar;
Escape shuts the find bar first, then the dialog), the agent, the project, an existing worktree (the
main one preselected) or a new worktree for every run cut from a base branch (empty means the
project's default), and a timetable: every hour, every day, Monday to Friday, once a week, or a
custom cron line or RRULE, in a time zone that starts as the computer's. Under the timetable a live
preview reads it back in words with the next run ("Monday to Friday at 09:00 (America/Los_Angeles),
Next run: Monday 09:00"); a line that cannot work (minute 61, 30 February) shows why and Save stays
off. The list shows that sentence and "Monday 09:00 · in 3 days". A clock in the app checks every
30 seconds and starts what is due, works out the next time after every run, never starts a paused
automation, and moves on a due time more than two minutes old instead of running it late.

T-078 (orchestration lane) gives a lineup of sessions a shape (SESS-012, SESS-025). The chooser
has a Shape row (Solo, Pair, Workbench, Swarm, Custom) and one "Task for every seat" box. Swarm
makes five seats marked scout, builder, builder, tester, reviewer; more seats than roles start the
roles again; dropping below the shape's count turns it into Custom, which has no roles. Each AI
seat starts with its role's short brief, then the task, then its own opening prompt, and its tab
is named after the role unless it has a job title. With two or more AI seats, every agent also gets
a short rules block (others are working alongside, stay in your worktree, keep your handoff note
current, check libraries against current docs), and Kolux makes each one's handoff note first, in
the project's `.kolux/handoffs/<worktree>.md`, never overwriting one. The start line Kolux shows
on hover leaves the rules block out. A single seat gets no rules block.

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
| LOOK-2 | Vendor marks: keep Anthropic's Claude Spark (from its public press kit, no terms shipped) as a model indicator in a public release? And may someone fetch OpenAI's kit file by hand (openai.com/brand refuses every automated fetch)? | Spark kept, as nominative use; the hand-redrawn OpenAI knot was removed the same day (not a kit file, so outside the "public brand kits only" rule) and Codex shows Kolux's neutral spark glyph until a kit file arrives; see src/assets/vendors/NOTICE.md |

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
- 2026-10-09 · T-017-b: Codex's key is the real path, lower-cased on Windows, exactly as the
  public Codex source resolves and writes it; both the worktree and the project root are
  trusted because Codex looks a linked worktree's trust up on the main checkout. `CODEX_HOME` is
  honoured when set, otherwise `~/.codex`; the rebuild has no managed Codex home of its own
  (Txais's shell currently points `CODEX_HOME` at the old app's managed home, which this pass
  neither read nor wrote: the live proof ran the dev app and the CLI with the variable unset,
  so his real `~/.codex/config.toml` gained the two entries). `toml_edit` (already in the
  dependency tree) edits the file in place so nothing else moves. T-017-c (Cursor, Copilot) is
  split off and left unticked: neither tool's trusted-folders storage is documented anywhere
  public, Cursor is not installed on this PC and Copilot's `config.json` carries only a
  first-launch stamp here, so there is nothing to copy the shape from. Options for Txais: install
  Cursor / trust a folder in Copilot once by hand and read back what each wrote, or drop the two
  from the card. Live note: Codex printed "Hook failed · hook exited with code 1" twice in the
  throwaway repo before answering; those are hooks from his own Codex profile, not Kolux's, and
  not part of this task.
- 2026-10-09 · T-017-a: T-017 is split in place: T-017-a is Claude (the agent this app launches
  today) plus the one-write batch; T-017-b is Codex, Cursor and Copilot, each with its own file
  format. The batch is the real list of folders the launch is about to use, not a list of
  names: the front end makes the worktrees first, then trusts them all in one `trust_folders_cmd`
  call before any pane mounts, so the "pre-trust 13 names → refused" rule became "more than 12
  folders in one call → refused before any path is resolved". The main repository is trusted
  through the project's registered path (Kolux's own record), never by following the worktree's
  `.git` file, so tampered Git metadata cannot extend trust elsewhere. The quarter-second merge
  window is not built: all writes go through one lock and happen before the processes start,
  and Claude's own rewrites keep our key because we write the flag before Claude reads its file.
  `serde_json` gained `preserve_order` so Claude's file keeps its key order on our rewrite.
  Live note: Claude itself adds `lastGracefulShutdown`/`lastVersionBase` to the main
  repository's entry when a worker runs in a linked worktree, so the config file's bytes change
  between two launches even though our entry does not. The throwaway repo's two entries stay in
  Txais's `.claude.json` (the feature's normal trace; harmless). A worker launched from the dev
  app inherits the launching session's environment (the pane showed Claude's "inherited
  CLAUDE_CODE_CHILD_SESSION" note): a test artefact of starting the dev app from inside a Claude
  session, not a product path.
- 2026-10-09 · T-016: tasks and dispatches are JSON lists under two store keys (no tables
  yet); the Board (STAT/ORCH cards) reads them later. Readiness = the worker's terminal has
  written something and is still running one second after; the spec's idle detector comes with
  the status cards. `new-child` is placed like `new-top-level` for now (lineage waits for parent
  cards). `--setup` is accepted but always answers `not_configured` (no setup hooks built).
  Tier routing is the shipped table in `cli.rs::route`; the per-provider routing page in
  Settings (ORCH-018) is not built, so `--tier` with an agent other than Claude or Codex answers
  `no_route`. A worker started from the command line stays a background tab: the view does not
  jump to it. The `kolux-dev` CLI binary is not rebuilt by `pnpm tauri dev`; after a Rust change
  run `cargo build --bin kolux-dev` before a live CLI proof. Seen again live: Claude's "Quick
  safety check … trust this folder?" prompt in the new worktree, which T-017 (SAFE-023) removes.
- 2026-10-09 · T-015: the copies choice lives on the chooser pane and defaults from the seat
  count and the Git state (separate for 2+ seats in Git, shared otherwise). Separate copies are
  made sequentially under the store lock (`workspace_create_fresh`), so parallel seats cannot
  collide on a name. The shared folder outside any workspace still means one fresh worktree for
  all seats (as before T-015); terminal seats always open in the chooser's folder. After Start
  the view shows the first pane's workspace and the other agents sit in their own rows, because
  a workspace is the view model. Retired creature names are kept forever under
  `creatureNamesUsed` (case-insensitive match). "Outside Git" is true only with no workspace
  and no project, because folder projects (PROJ-005) are not built yet. Found, not fixed (outside
  SESS scope): when two Claude seats start in the same instant one `claude.exe` launcher can sit
  at 0 CPU with one thread and its pane stays blank (the other seat and a single launch render
  fine); belongs with the terminal spawn work, worth a look when TERM tasks come up.
- 2026-10-09 · T-014-b: the CLI talks to the app over a loopback TCP port, one JSON line each
  way, with a per-start token in `<data folder>/cli.json` (removed at exit); the dev program is
  `kolux-dev` (COMPAT.md 2.1), the release `kolux` binary and the PATH / kolux.cmd shim are T-185
  and T-250. `--setup`, `--issue`, `--comment`, `--parent-worktree`, `--no-parent` and
  `--run-hooks` are parsed and checked (a prompt needs an agent; empty agent, prompt or setup
  refused; setup only run/skip/inherit; run-hooks clashes with setup skip; parent flags cannot
  disagree) but nothing runs on them yet: setup scripts, issues, comments and lineage are later
  cards; `--run-hooks` only activates. `worktree rm` removes the branch with the checkout, the
  same as the sidebar's Remove (T-013); CLI-020's "the branch stays under --force" comes with
  T-160, when the sidebar gets the same choice. `--worktree active` and identity:/issue:
  selectors are refused with a clear message until the app tracks them. Requests are answered
  one at a time. The CLI's not-running advice says "start it first" because `kolux open` is
  T-097.
- 2026-10-09 · T-014-a: the per-project workspaces folder and base ref live in the project
  record, edited behind the project row's gear, until a per-repository settings page exists. A
  relative folder resolves from the project root. Nested layout strips `.git` from the project
  folder name; flat puts every workspace straight in the folder. Folders used before are kept
  under `workspacesDirsUsed` (ten, newest first). A saved base that is gone falls back to the
  default branch with a warn-coloured note in the sidebar, no dialog queue. A base that tracks a
  remote is fetched on every create and a fetch that fails offline is ignored; a 40-hex commit id
  is never fetched; refs are passed to Git untouched. A prompt with no agent chosen picks the
  default agent, else the first installed one; the agent's tab is the first tab and no shell is
  opened beside it. T-014-b (PROJ-077, `kolux worktree` create / remove) is split off: no CLI
  binary or transport to the running app exists yet, and that foundation (transport, JSON
  envelope, exit codes: T-076, T-097, T-185, T-197, T-250) has to come first. The throwaway
  "repo" project from the live proof stays registered in the dev profile's store.
- 2026-10-09 · T-013: a project's folder is its main checkout whichever worktree the user
  picked (PROJ-007 "chosen on purpose"). A worktree under a dot-folder inside the main checkout
  (Claude Code's `.claude/worktrees/*`) is a tool's scratch worktree and is not listed; nothing
  else is filtered. A taken branch or folder name (local branch, any remote's branch, or an
  existing folder) gets `-2`, `-3` instead of an error (PROJ-021). Typed names are stored in the
  state store under `workspaceNames`, keyed by the lower-cased folder path, and forgotten on
  remove; Git never sees them. Until a settings page exists the sidebar header's plus is New
  workspace and the footer gear opens the add-by-path / workspaces-folder form. One create at a
  time: the field is closed while Git works and a second Mod+N waits; cancelling an overtaken
  create (and removing its half-made checkout) and the stand-in *tab* are not built, only the
  stand-in sidebar row. Folder projects without Git are PROJ-005, not built. There is no
  project-remove command yet, so the throwaway "repo" project from the live proof stays
  registered in the dev profile's store (its folder under the scratchpad may vanish; the row
  will then show an error until a remove exists).
- 2026-10-09 · T-012-b: the default search engine is Google (OD-18 said "a fixed standard web
  search"; DuckDuckGo, Bing and Kagi addresses are in `src/browser/address.ts` for the day a
  setting chooses one; the Kagi session link is not built). Back / forward availability is
  tracked by the tab from its own actions and the loads it sees, because wry exposes no
  can-go-back: a page's own `history.back()` or `pushState` can drift the dimming, not the
  navigation itself. A load that starts before the previous one finished counts as a redirect
  and replaces the entry (Google's `&sei=` hop proved this live). Ctrl+L / Alt+Left / Ctrl+R
  reach the tab only while the keyboard is in the app's own web view, not when the cursor is
  inside the page (the child web view has no IPC); a page click then a chord does nothing
  until the bar or a tab is clicked. Hard reload (Ctrl+Shift+R) is the same as reload. The
  evidence harness gained `scripts/evidence/cdp.mjs`: the dev app is started with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and the script sends
  keys and reads the DOM over that port, never through the shared keyboard; the earlier
  posted-message typing stopped landing while a full-screen game held the foreground.
- 2026-10-09 · T-012-a: a browser tab is a native child web view (WebView2) of the main window,
  not an iframe: iframes are refused by most sites' frame headers and give no history or
  title. Consequences to live with until a card asks otherwise: the page sits above every
  HTML overlay of the app (a menu or toast over a browser tab is covered; the page hides
  while its tab is away so the Board and Agents are unaffected); browser tabs are not Board
  cards (VIEW-023 / VIEW-024 own hiding editor / browser tabs); pages get no Tauri
  capability (`capabilities/default.json` names the `main` web view only). Opening a page
  moves the keyboard to it, so `browser_open` hands the keyboard back to the app's web view
  and the address bar re-focuses itself. The Ctrl+Shift+B chord itself was not pressed by
  the harness (it posts characters, not chords); the menu item and the key id are wired the
  same way. Harness: `scripts/evidence/type.ps1` targets the first web view child; with a
  browser tab open there are two, so T-012-a's proof used a scratch variant choosing the
  largest (app) or smallest (page) child, to fold into type.ps1 when the next browser task
  needs it.
- 2026-10-09 · T-011: the Board card and the grid pane are one DOM element styled two ways
  (`.board` on the cells container, `card` / `expanded` on the pane), not a terminal moved
  between two homes: React cannot reparent a mounted xterm without remounting it, and the
  spec's rule is that only the view moves. One card expands at a time (`toggleCard` in
  grid.ts) at a fixed 420 px height; a taller or resizable card can come with the Board
  polish (VIEW-023 / VIEW-024, T-028 / T-050), which also owns lanes, chips, chooser cards and
  hiding editor / browser tabs. The header's expand button is the Board toggle; on the
  Terminals screen it still reads "not built yet" (pane zoom is its own card).
- 2026-10-09 · T-010: a "tab" is a pane sharing a grid cell with others (`group` on the pane,
  `cellsOf` in grid.ts); the split tree of the old app (tabs holding split panes) is not rebuilt,
  so a split is a new cell and a tab is a sibling in the same cell. The tab create menu lives in
  the layout strip ("New tab"); browser and markdown entries join it with their own tasks (T-012,
  BROW / MD cards). `tab.close` and `terminal.closePane` both carry Ctrl+W and both close the
  focused pane, so the clash is harmless. Paste uses the browser's own paste event on the pane's
  text area instead of an asynchronous clipboard read: the clipboard is handed over in the same
  tick, so TERM-068's "cancel when the target changes while reading" has no window to guard; the
  paste chords are taken away from xterm (which would otherwise send ^V to the program). Neither
  the paste chords nor Ctrl+T could be proven live from the harness (posted keys carry no modifier
  state and no context menu opens from a posted right-click), so Txais should press Ctrl+V in a
  pane and Ctrl+T once by hand; the menu route and the tab strip were proven live.
- 2026-10-09 · T-009: the strip keeps DESIGN.md's 1 / 2 / 4 / 6 presets; 3, 5 and 7..12 panes are
  reached by splitting (the limit is 12, TERM-001), and the strip then shows no pressed button.
  Shrinking never removes a started session: TERM-003's "ask first" is T-151, so for now a toast
  says to close one. Closing a pane whose program is still running ends it without asking; the
  confirmation is TERM-045 (T-057). Closing the last pane leaves the empty placeholder, since tabs
  arrive with T-010. "Split down" is an index jump in the uniform grid (`ponytail:` in grid.ts), not
  a nested split tree, so a pane split down from the bottom row lands at the end. The three chords
  (Ctrl+W, Ctrl+Shift+D, Alt+Shift+D) are matched by the keymap unit tests and wired to the pane
  actions, but no chord could be proven live from the harness: the proof routine posts keys to the
  web view window and a posted key carries no modifier state, while the shared-keyboard route is
  forbidden (and, tried once, reached neither the new chords nor the older Ctrl+B). Txais should
  press Ctrl+W and Ctrl+Shift+D by hand once; if they do nothing, the keymap listener is the place
  to look (`src/App.tsx` onKey, `src/keys/keymap.ts` chordMatches).
- 2026-10-09 · T-008-b: the opening prompt lives on the seat (SESS-051) until PROJ-038 / TERM-126 /
  CHAT-029 add their own fields. The typed route (Aider, Goose, Kiro, Kimi, …) sends the prompt
  after the first 1.5 s of silence following output, a stand-in for SESS-032's readiness rule
  (P1), which replaces the timer; it is unit-tested but not proven live (none of those agents is
  installed here). Codex's "start line sent once the pane's shell is ready" is moot: the rebuild
  runs the program directly in the PTY, not through a shell, so Codex takes the plain trailing
  argument. The foreground matcher (`credited_agent`) is built and tested, but nothing polls the
  foreground yet: that belongs to the status cards (04-agent-status-hooks), so a pane is credited
  to the agent it was started as. The Hermes 24,000-character limit is enforced by the builder
  (SESS-005's reporting is the Start toast). Claude Agent Teams stays skipped (DECISIONS.md).
- 2026-10-09 · T-008-a: T-008 was split in place (SESS-015 + SESS-024 as T-008-a, SESS-051 as
  T-008-b); PLAN.md now has 341 tasks. "Same for all" copies the AI and model only; job titles
  stay per seat (one title on three panes would hide which is which). A pane without a job title
  keeps the workspace (creature) name from T-007-a rather than "Terminal N", which is used only
  outside any workspace; SESS-024's "a seat's title wins over any title the agent sets later"
  holds trivially, since panes do not yet take titles from the program (a later terminal card).
  Kit launches (the "reuse one untouched idle tab" rule) wait for the kits area; "the lineup is
  remembered only if an agent seat started" waits for the New session page (T-046), which is the
  first thing that would read it, so nothing is saved yet. The failure path (a pane whose
  session fails to start is removed, "Nothing started" when the whole lineup failed) is covered
  by unit tests only: every offered agent is installed, so no seat could be made to fail live.
- 2026-10-09 · T-007-b: the model lists are built in (`src/launch/seats.ts`) until SESS-029 (P1)
  asks each installed program for its live list; "Program default" is the explicit no-flag pick so
  SESS-015's "nothing is guessed" still holds. The quick counts settled on 1 · 2 · 3 · 4 · 6 · 8 plus
  the free field. The chooser's entry points are the plus-menu item and the empty-workspace button;
  the New session page (SESS-018) is T-046. One chooser's seats share a workspace: the chooser's
  own, or one fresh worktree for all of them when it was opened outside a workspace (a worktree per
  seat would scatter one Start across the sidebar; SESS-024 in T-008 decides the final rule).
  `--model <id>` is passed to every agent that has a list; agents without one only offer the
  program default. The free field applies on Enter/blur/spinner, not per keystroke (typing "15"
  from 2 would otherwise shrink to 1 and lose seat 2's picks).
- 2026-10-09 · T-007-a: T-007 was split in place (SESS-001 + SESS-004 as T-007-a, SESS-007 +
  SESS-013 as T-007-b); PLAN.md now has 340 tasks. SESS-004's "one item opens agent settings"
  waits for the Settings page (area 17); in its place each non-default row carries a "default"
  button, so the acceptance "make Codex the default" can be done from the menu itself. "Detected
  and switched on": there is no per-agent on/off switch yet (it belongs to the agent settings), so
  every detected agent is on. The shortcut chip beside the default agent shows only when
  `tab.newAgent` is bound (the built-in Windows default is unbound, as in COMPAT.md); Txais's own
  keybindings bind it to Ctrl+Shift+K, which the evidence shows. SESS-001's "reads the search path
  the user's shell would use" is covered on Windows by the usual-folder list (Explorer-launched
  apps already see the registry PATH); the macOS login-shell PATH read is left for the macOS
  pass. The missing-agent case keeps the agents out of sight (SESS-001 allows either), with one
  hint line naming what was looked for when nothing at all was found.
- 2026-10-09 · T-006: a row click now selects (shows) the workspace; it no longer restarts an
  ended shell there as T-003 had it (that was the only way to get a shell before there was a
  selection; an ended pane keeps showing "Ended" until its own restart card). Panes of the other
  workspaces are kept mounted and hidden (`hidden` on the pane section) rather than unmounted and
  rebuilt, because xterm's buffer is the state PROJ-066 wants kept; a hidden pane skips its fit /
  resize so the program never sees a 0x0 terminal. The start-up PowerShell pane belongs to a "no
  workspace" group with no sidebar row; it is shown at start and again when the shown workspace is
  removed. The "last pane is never removed" rule from T-004 still counts panes across all
  workspaces, so a workspace can become empty (it then shows the "Open a shell" placeholder).
  Live checks: `pnpm tauri dev` failed once with Windows error 1450 (insufficient system resources)
  in the Vite step and worked on the retry; nothing in the repo caused it.
- 2026-10-08 · T-005: a missing keybindings file is created "empty" as the shape Txais's own file has
  (version 1, empty keybindings map, empty darwin / linux / win32 sections); the defaults stay
  built in and are never written out, so a fresh file is a true "no overrides" file. The file is
  read once at start; reload is explicit (COMPAT.md 4.1 found no watcher), and the Settings
  reload / open / reveal buttons come with SET-012 (T-246). Linux takes the Windows column of
  COMPAT.md 4.3 (Mod = Ctrl on both). Only global-scope actions that exist today are wired to the
  keyboard (sidebar toggle, screen cycle); every other id resolves, shows its label, and waits for
  its own card. Chords are matched on the physical key (KeyJ) with the typed character as the
  fallback; the layout rules of SET-015 come later. Warnings (unknown ids such as the old app's
  `voice.dictation` and the cut `tab.openQuickCommandsMenu`, both in Txais's file) are kept in the
  keymap but not shown; only errors reach the notice. The live checks edited Txais's real file
  (backed up first, restored byte for byte, SHA-256 compared) because the file lives in the home
  folder by contract and the app has no test override for that path.
- 2026-10-08 · T-005: the Tauri icon generator also writes Android and iOS icon sets; they were
  deleted from src-tauri/icons (LOOP.md: Windows first; those targets are not built).
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
- 2026-10-08 · T-003b follow-up (a second pass on the same task, run in parallel by mistake; it
  committed only its own files and left the T-004 work in progress untouched): the hand-redrawn
  OpenAI knot is out, because Txais's rule is "vendor logos only from public brand kits" and a
  redrawing is not a kit file; Codex gets Kolux's own neutral spark glyph until a kit file is
  obtained (LOOK-2). A render test (src/chrome/shell.test.ts) now fails if the top bar, its
  switcher, search hint, usage pill or window controls, the Layout 1/2/4/6 strip, or the status bar
  disappear; proven by dropping the "6" button (test failed) and restoring it. `cargo-deny` was
  not on this PC (no `cargo-deny.exe` anywhere under the cargo bin, AppData or the build folder),
  so `cargo install cargo-deny --locked` put 0.20.2 in `%USERPROFILE%\.cargo\bin`; the licence
  gate now really runs ("licenses ok"). How the earlier "cargo-deny green" lines were produced
  is UNKNOWN.

- 2026-10-08 · T-004 · Claude Code is launched as `claude --permission-mode auto` (the value SESS-027
  Compat names; `claude --help` on this PC lists `auto` among the accepted modes); Codex as
  `codex --dangerously-bypass-approvals-and-sandbox`. Agent detection is a PATH + PATHEXT lookup of
  the program name, done in Rust at start (`src-tauri/src/agents.rs`), so the menu shows what Kolux
  really found. Creature names come from 26 adjectives x 26 sea creatures written into
  `src-tauri/src/creatures.rs`, seeded from the clock, with `-2`, `-3` suffixes once a round is used
  up; a name is refused if any project already has a folder or branch of that name (case-insensitive).
  A launch from the sidebar goes to the only project when there is one, else the project that owns
  the focused pane's folder, else the first project; a launch from a pane header always uses that
  pane's project. The last pane is never removed (it shows "Ended"). Panes split evenly
  (`columnsFor`: 1 / 2 up to four / 3) until T-009 builds the grid. The live check pre-seeded the
  throwaway project straight into state.db (kv `projects`) and removed it after; during the first
  run extra launches appeared with no scripted input (a "Shell" row click, two more "Claude Code"
  picks), then the window was closed from outside: a click-recording rerun showed exactly one trusted
  click per scripted action and one launch, 50 s idle produced nothing more, so the extras are read
  as someone using the mouse while the app was in front, not a code path. The evidence harness
  note was extended: `type.ps1` needs the window activated first.

- [orchestration] T-086: the Automations page (DT-17) is reached from a clock button in the sidebar footer until AUTO-023's optional sidebar row (T-291) and the command palette exist.
- [orchestration] T-086: the "ask before deleting an automation" switch is the setting `confirmAutomationDelete` (on by default); the confirm bar's "Don't ask again" turns it off.
- [orchestration] T-086: Runs, New Automation and row Edit are shown but greyed until T-130 (runs page) and T-085 (create/edit dialog) build them.
- [orchestration] T-086: a search longer than 200 characters is refused (the box says so) instead of being run.

- [orchestration] T-087: Model routing is a page of its own, opened from a sliders button in the sidebar footer, until Settings > Agents exists (T-036 / T-054); it should move there then.
- [orchestration] T-087: the per-tier picks are saved in settings as `modelRouting.<provider>.<tier> = { model, effort }`; an empty model means the provider's own default (no `--model`, no effort).
- [orchestration] T-087: when a new model does not offer the current effort, the effort goes back to "Default" (no effort flag) rather than to some other level.
- [orchestration] T-087: effort levels offered are low / medium / high / xhigh / max for Claude Fable, Opus and Sonnet, none for Haiku, and low / medium / high / xhigh for the Codex models.

- [orchestration] T-081: Codex's default ladder is gpt-6-sol at high / high / medium / low (DT-12: "newest Codex model"; Codex's own models cache on this PC lists gpt-6-sol, gpt-6-astra and gpt-6-luna as the newest, and `~/.codex/config.toml` uses gpt-6-sol). This replaces T-016's gpt-5.6-sol / terra / terra / luna ladder.
- [orchestration] T-081: the Reset button is greyed while the chosen provider has no pick of its own.
- [orchestration] T-081 for the coordinator: the importer task T-181 (SET-035) should bring a 0.15.0 profile's routing table into `modelRouting` (COMPAT 5.7, ACCT-034 row). It was not added to T-181's line because that line is outside this lane's section of PLAN.md.

- [orchestration] T-077: `worker-start --worktree new-child` called from outside one of the project's workspaces makes a top-level workspace (no parent) instead of refusing; called from the main checkout it is top level too, since main is never a parent row.
- [orchestration] T-077: the nesting switch is a checkbox in the footer gear form (setting `workspaceNesting`, on unless false) until a Settings page holds workspace options. Folded rows are not saved; they reset when the window closes. A loop of parents (should one ever be written) is listed flat rather than hidden.

- [orchestration] T-085: split in place. T-085-a is the timetable and the dialog (AUTO-001, AUTO-005); T-085-b keeps event triggers and background runs (AUTO-004, AUTO-011), which need T-025's hooks and T-176's PR polling, plus RRULE lines with INTERVAL other than 1, COUNT, UNTIL, BYSETPOS, DTSTART or numbered weekdays, which are refused with a message until then.
- [orchestration] T-085-a: a timetable that is not one of the presets is described as "Custom: <line> (zone)" rather than turned into a sentence; an RRULE that leaves out BYHOUR / BYMINUTE runs at minute 0 / hour 0; a due time more than 2 minutes old (Kolux was closed or asleep) is skipped to the next one, and the grace window for those is T-175 (AUTO-007); the clock checks every 30 seconds. `jiff` (already in the lock tree through another crate, MIT/Unlicense) is now a direct dependency for time zones. Editing an automation that waits for an event turns it into a timed one until T-085-b adds events to the dialog.

- [orchestration] T-078: a new chooser starts on Custom, so nothing changes for someone who never picks a shape; the role briefs are Kolux's own one-sentence wording (the card names the roles, not their text). Handoff notes live in the main checkout's `.kolux/handoffs/` (or the chooser's folder outside any project); when the seats share one folder each note is named `<folder>-seat-<n>`, so no two agents share a note. The rules block names the note's full path as the one file outside the worktree the agent may write. Kolux cannot hide the prompt inside the agent's own screen (Claude Code echoes it in full); what Kolux itself shows, the start line on hover, has the block cut. Multi-line opening prompts reach a typed-route agent or a .cmd shim only up to the first line break until T-163 (SESS-032).

## Last 10 passes  (date · task · result · evidence)
- 2026-10-09 · [orchestration] T-080 · HAND TO FABLE: VIEW-020 drops a finished result into another session composer; it needs the chat composer and chat bridge of VIEW-019 (T-050, not built) and a finished run result from the status cards (T-028 and hooks); neither exists yet, so there is nothing to hand over or to receive it · none
- 2026-10-09 · [orchestration] T-078 · done: shapes, roles, briefs, rules block and `withoutRules` in `seats.ts` (4 new tests), Shape row, task box and role chips in `ChooserPane.tsx` (1 new test), `prepare_handoff` / `handoff_note_prepare` in projects.rs (1 test: made once, never overwritten, unsafe names cleaned), notes and prompts composed in `App.startSeats`, the hover start line cut in TerminalPane; live: Swarm showed scout, builder, builder, tester, reviewer; Workbench then 2 read Custom with no roles; a Pair with a task started two Claude agents whose real start lines held brief, task, then the rules block naming hazel-beluga.md and dusky-squid.md, both notes on disk before the agents ran, hover start lines without the block; a Solo with a task had no rules block · evidence/T-078-swarm.png, T-078-custom.png, T-078-pair-lineup.png, T-078-pair-launched.png, T-078-solo-lineup.png, T-078-solo-launched.png
- 2026-10-09 · [orchestration] T-085-a · done: `schedule.rs` (cron + RRULE parser, next run in a zone, words; 5 tests incl. 29 Feb, DST, minute 61), `automations.rs` save / preview / clock `tick` (2 new tests: validation + doubled create, due / paused / missed), `create_fresh_from` in projects.rs, `AutomationDialog.tsx` + test, model labels; live: weekday 09:00 saved on Friday reads "Monday 09:00 · in 3 days", double-clicked Save left 1 automation, minute 61 refused, 0 0 29 2 * next run 29 Feb 2028 00:00, Escape shut find then the dialog, a * * * * * automation started run #1 "by the timetable" at 16:57:16 and none after it was paused · evidence/T-085-dialog.png, T-085-cron-61.png, T-085-leap-day.png, T-085-find.png, T-085-saved-list.png, T-085-edit.png, T-085-clock-run.png
- 2026-10-09 · [orchestration] T-079 · not built, left unticked. HAND TO FABLE: TERM-125 is terminal grid + PTY + two-way IPC. The Rust side keeps no screen of a terminal (output only streams to xterm in the window), so show/read/--cursor/--screen need either a terminal-emulator crate (a new dependency to clear with cargo-deny) or a round trip asking the window's xterm buffer; tabs, splits, titles and focus live only in App.tsx, so list/split/switch/rename/close --tab need the window to report its layout to Rust and take orders back over `cli-workspace`-style events; wait --for tui-idle needs a quiet-screen rule. Nothing was changed · no evidence
- 2026-10-09 · [orchestration] T-077 · done: `nestRows` in `src/projects/model.ts` (3 new tests: depth, fold, orphan, nesting off, loop), fold chevron and nesting checkbox in `ProjectsPanel.tsx`, `workspaceParents` store with `set_parent` / `forget_workspace` in `projects.rs`, worker-start records the calling workspace as parent (cli.rs test extended); live: P > sandy-beluga > nimble-crab, nimble-tuna nested, P folded hid all three, nesting off listed five flat, removing sandy-beluga put its two children at the top · evidence/T-077-nested.png, T-077-folded.png, T-077-nesting-off.png, T-077-parent-gone.png
- 2026-10-09 · [orchestration] T-081 · done: `resetProvider` / `isCustom` in `src/settings/routing.ts` (1 new test), Reset button and "Not detected" tab mark on `RoutingPage.tsx` (1 new render test), Codex models and DT-12 ladder in `routing.rs` (Rust tests updated); live: Claude Build set to Opus/high and Codex Light to GPT-6 Luna, Reset Claude Code put Build back to Sonnet/medium and left Codex's pick saved. This PC has Codex, so the not-detected mark is shown by the render test only · evidence/T-081-codex.png, T-081-before-reset.png, T-081-after-reset.png
- 2026-10-09 · [orchestration] T-087 · done: new `src-tauri/src/routing.rs` (catalogue of routable providers, models, effort levels and the shipped ladder; `route` reads `modelRouting` from settings and drops an effort the model lacks; 3 Rust tests) used by `worker-start --tier` (CLI test now expects the saved Sonnet/low pick); `src/settings/routing.ts` (3 tests) + `RoutingPage.tsx` (1 render test), sliders button in the sidebar footer, model shown in the pane header; live: defaults table, Build set to Haiku hides its effort picker and saves, `kolux-dev orchestration worker-start --tier build` started a worker whose header reads "Claude · haiku" (Claude itself reports Haiku) · evidence/T-087-routing.png, T-087-no-effort.png, T-087-worker-header.png
- 2026-10-09 · [orchestration] T-086 · done: new `src-tauri/src/automations.rs` (list / pause / delete / Run now commands, numbered manual runs, placement + trust + background tab via the cli-workspace event, skipped when the project is gone, failed when the agent is missing; 3 Rust tests), `src/automations/model.ts` (natural sort, last-run sort, filters, search, 5 tests) and `AutomationsPage.tsx` (3 render tests), clock button in the sidebar footer; live: list, search on prompt text, last-run sort, Run now on a paused row, delete confirm + Don't ask again, the background run tab, failed-load Retry · evidence/T-086-list.png, T-086-search.png, T-086-sort.png, T-086-runnow.png, T-086-confirm.png, T-086-deleted.png, T-086-run-tab.png, T-086-failed.png
- 2026-10-09 · T-017-b · done: `trust.rs` gains `codex_config_file` (`CODEX_HOME` else `~/.codex`), `codex_key` (real path, lower-cased on Windows), `trust_codex` (`toml_edit` in-place edit of `[projects."<key>"] trust_level = "trusted"`, rest of the file byte for byte, locked, tmp + rename), `trust_folders` routes `codex`; `checked_keys` and `write_whole` shared with Claude; `toml_edit = "0.25"` in Cargo.toml; 1 Rust test (53 total); live with `CODEX_HOME` unset: `worker-start --spec "say hi and stop" --agent codex` → `trust: true`, the pane shows Codex (GPT-6-Sol) answering "Hi!" with no trust prompt, `~/.codex/config.toml` gained the worktree and the lower-cased repo root (12 → 14 `[projects…]` headers, everything above untouched); a second worker in the same worktree → `trust: true`, file hash unchanged; worktree removed; build / clippy / 53 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-017-b-codex.png
- 2026-10-09 · T-017-a · done: new `src-tauri/src/trust.rs` (`claude_config_file`, `claude_key` real-case forward-slash key, `trust_claude` locked read-modify-rename write that only touches the flag, `trust_folders` per agent, `trust_folders_cmd` command); `Ctx.claude_config` and a trust step in `worker_start` with a `trust` field in the receipt; App.tsx `pretrust(agent, dirs)` called from the new-tab path, `startSeats` (one call per agent for all its seats) and `startIn`; `serde_json` `preserve_order`; 3 Rust tests (52 total) + the cli dispatch test checks the trust write; live in the throwaway "repo": `worker-start --spec "say hello and stop" --agent claude` → `trust: true`, the pane shows Claude answering "Hello." with no trust menu (prompt reached it), `.claude.json` gained `C:/Users/XiongT/kolux-rs/workspaces/repo/nimble-starfish` and the repo root with the flag; a second worker in the same worktree → `trust: true`, the entry unchanged and no new entry; worktree removed, both workers gone; build / clippy / 52 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-017-a-no-prompt.png
- 2026-10-09 · T-016 · done: `terminal.rs` marks program sessions (start time, last output) and `program_in(dir, since)`; `projects::create_fresh` shared by the UI command and the CLI; `cli.rs` `orchestration worker-start` parse (`WORKER_FLAGS`, `check_worker_start` with every refusal from CLI-035/ORCH-016/018/019), `worker_start` dispatch (task made/found under `orchestration.tasks`, worktree made or picked, `created` + `start` notify, readiness wait, receipt, `orchestration.dispatches`), `text_of` worker line, help text; front end `CliWorkspace` `start` kind → `startIn` with extra args and a pane title; 2 Rust tests (49 total; dispatch test runs the full flow with a 1 ms timeout); live in the throwaway "repo": `worker-start --spec "add a test" --agent claude --json` → `status: ready` in 1.8 s, `dispatch-1`/`task-1`, worktree hazel-otter, terminal 2; sidebar row hazel-otter + background tab "add a test" (Claude, Running) while the view stayed on main; opening the row shows one tab with Claude's trust prompt; `claude.exe --permission-mode auto "add a test"` under the app; `--worktree current --base-branch main` refused with exit 1 before anything was made; `worktree rm --worktree path:… --force` took the row, tab, process and folder away; build / clippy / 49 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-016-ready.png, evidence/T-016-one-tab.png
- 2026-10-09 · T-015 · done: `Copies` type, `defaultCopies` and `sharedWarning` in seats.ts; "Folders" radiogroup + warn note with the "Give each its own copy" fix on ChooserPane; App.tsx `startSeats` places each seat (terminal → chooser folder, agent → fresh worktree each when separate, shared folder or one fresh worktree otherwise); Rust `creatureNamesUsed` store key, `retired_names` / `remember_retired` / `fresh_name`, `workspace_create_fresh` holds the store lock; Rust test extended (48 total), 2 front-end tests added (71); live in the throwaway "repo" project: chooser from New session with 3 seats → "Separate copy for each AI" checked; "Same folder for all" → warn note + fix button, the fix re-selects separate; Claude + Claude + Terminal, Start → rows tidal-walrus and nimble-squid appeared, `git worktree list` shows both under workspaces/repo, Claude's trust prompt in nimble-squid's folder, the terminal seat in the chooser's folder; both removed through the sidebar (branches gone); one more Claude from New session → silver-narwhal; store key `creatureNamesUsed` = ["tidal-walrus","nimble-squid","silver-narwhal"]; build / clippy / 48 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-015-default.png, evidence/T-015-warning.png, evidence/T-015-started.png, evidence/T-015-retired.png
- 2026-10-09 · T-014-b · done: loopback listener + `cli.json` in the app, `kolux-dev` program with the parser, the JSON envelope and exit codes, `worktree create` (name, repo selector or the shell's folder, base branch, agent + prompt, activate) and `worktree rm` / remove / delete (selectors current, name:, branch:, path:, id:; dirty refusal; --force), the window picks the change up over a `cli-workspace` event; 3 Rust tests added (48 total), 69 front-end tests; live: with the app closed `--help` exits 0, create says "Kolux is not running; start it first" (exit 1, JSON envelope with app_unreachable), a prompt without --agent is refused (exit 1); with the app up, from the repo folder `worktree create --name "cli test" --agent claude --prompt hello --json` → envelope with the path, the row "cli test" appeared, a hidden pane "cli-test Claude Running" with claude.exe started on "hello", the shown pane untouched; `--name quiet --activate --setup skip` → "created quiet at … (from main)", row selected with a shell; `rm --worktree name:quiet` → removed; junk file in cli test → `remove` exits 1 "cli test has uncommitted changes" + the --force hint; `delete --worktree branch:cli-test --force --json` → success envelope, rows back to main + zeta, the Claude pane and process gone, worktrees and folders gone; build / clippy / 48 Rust tests / 69 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; `cli.json` gone after closing · evidence/T-014-b-created.png, evidence/T-014-b-removed.png
- 2026-10-09 · T-014-a · done: global workspaces folder + nested/flat layout behind the footer gear, per-project folder + base ref behind the project row's gear with a used-folders list, create starts from the typed ref / saved base / default branch with a fetch for remote-tracking bases and a fallback note when the saved base is gone, agent + first prompt on the create form; 2 Rust tests added (45 total), model test updated (69 front-end tests); live over the debugging port: project gear → folder `…\t014\ws` + base `origin/feature` saved; after the remote branch was deleted, Mod+N "fallback test" → preview `…\t014\ws\repo\fallback-test`, created from main with the warn note "the saved base origin/feature no longer exists in repo; this workspace started from main instead", row selected with a shell; "pinned" + start from = a full commit id → worktree HEAD on that commit, no fetch; "agent run" + claude + prompt "hello" → one pane "agent-run Claude Running", claude.exe started with the prompt, no shell; layout flat → "flat one" at `…\t014\ws\flat-one`; all four removed through × / Remove (the agent process gone), settings reset; build / clippy / 45 Rust tests / 69 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-014-a-settings.png, evidence/T-014-a-fallback.png, evidence/T-014-a-form.png, evidence/T-014-a-agent.png, evidence/T-014-a-flat.png
- 2026-10-09 · T-013 · done: add-project resolves to the main checkout and opens it with a shell, scratch worktrees hidden, Mod+N / header plus open the name field with a branch + folder preview, stand-in row while Git works, taken names numbered (local and remote), typed name shown on the row and kept in the store; 2 Rust tests changed / added (43 total), model test updated (69 front-end tests); live over the debugging port: Mod+N with no project → "Add a project first.", Create disabled; gear form + a linked worktree's path → project "repo" at the main checkout, rows main + zeta (scratch hidden), main selected with a shell "repo main"; Mod+N + "Fix login 🔥" → preview "branch fix-login-fire · folder …\workspaces\repo\fix-login-fire", stand-in row at once, then the row selected with its own shell and the note "created Fix login 🔥 in …"; a second "fix login fire" while clicking back to main → `fix-login-fire-2` created, main stayed selected, no focus pull; "???" → "That name leaves nothing usable for a branch; use some letters or digits", Create disabled; both rows removed through × / Remove; build / clippy / 43 Rust tests / 69 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-013-noproject.png, evidence/T-013-added.png, evidence/T-013-pending.png, evidence/T-013-created.png, evidence/T-013-background.png, evidence/T-013-refused.png
- 2026-10-09 · T-012-b · done: the bar resolves sites, local hosts, file paths and searches (Google), refuses other schemes with a notice; back / forward / reload / stop toolbar with dimming and a loading spinner; Ctrl+L, Alt+Left / Right, Ctrl+R wired in the browser key scope; 1 Rust test, 4 front-end tests; live over the web view's debugging port: Ctrl+Shift+B opened the tab, "example.com" + Enter loaded https://example.com/ (tab "Example Domain", back lit), Ctrl+L selected the bar, "rust ownership" + Enter loaded Google results, Stop + spinner showed 116 ms into a reload and cleared at 1.3 s, "javascript:alert(1)" gave the red notice and left the page, Back returned to example.com with forward lit, Forward returned to the results; build / clippy / 42 Rust tests / 69 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-012-b-fresh.png, evidence/T-012-b-site.png, evidence/T-012-b-search.png, evidence/T-012-b-invalid.png, evidence/T-012-b-back.png, evidence/T-012-b-forward.png
- 2026-10-09 · T-012-a · done: Browser item in the New tab menu (Ctrl+Shift+B) opens a "New Tab" pane with an address bar focused over a blank page, the page is a child web view moved with the pane body and hidden while its tab / screen is away, tab named after the page title; 1 Rust test, 1 front-end test; live: "typed-in-bar" landed in the bar with no click, a local form page loaded from the bar and "kept-text" typed into its field survived a switch to Terminal 1 and back, a page calling `window.close()` left the tab in place, the Board showed no page; build / clippy / 41 Rust tests / 65 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-012-a-newtab.png, evidence/T-012-a-form.png, evidence/T-012-a-back.png, evidence/T-012-a-close.png
- 2026-10-09 · T-011 · done: Board screen lists every pane as a card (same cells as the grid, `.board` styling), expand shows the live terminal inside the card and collapses again, panes stay mounted across Agents / Board / Terminals; 1 grid test; live: `echo t011-ok` typed in the grid pane, Board showed the card collapsed, expand showed the same scrollback and `echo expanded-ok` typed into the card ran there, collapse + Terminals showed both lines in the grid pane in its old slot with the shell still at its prompt; build / clippy / 40 Rust tests / 64 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-011-grid.png, evidence/T-011-board.png, evidence/T-011-expanded.png, evidence/T-011-back.png
- 2026-10-09 · T-010 · done: grid cells hold tabs (`group` on panes, `cellsOf` / `neighbourTab` / `insertBefore` in grid.ts), "New tab" menu in the layout strip with Terminal + every installed agent and their chords, Ctrl+T / `tab.newAgent` / `tab.newAgent.<id>` / `tab.close` wired, a tab strip above cells with two or more tabs, `start_dir` for a requested start folder (relative, absolute, missing → workspace), paste through the pane's own text area with the chords left to the browser and queued behind an owed opening prompt; 3 grid tests + 1 strip test + 1 Rust test; live: New tab → Terminal opened "Terminal 3" as a second tab in the t010-repo cell at `PS G:\Temp\t010-repo>`, New tab → Claude Code opened a "Claude" tab with Claude running in that folder, closing "Terminal 2" from its x left the other two tabs with Claude in front; paste and Ctrl+T not provable from the harness (see decision); build / clippy / 40 Rust tests / 63 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-010-tabs.png, evidence/T-010-agent.png, evidence/T-010-close-tab.png
- 2026-10-09 · T-009 · done: pane grid 1..12 with balanced rows (`src/terminal/grid.ts`: clamp, columns / rows, resize plan, split index, insert), layout strip sets the count with the current count pressed, split button in every pane header, Ctrl+W / Ctrl+Shift+D / Alt+Shift+D wired through the keymap, close removes any pane including the last; 6 grid tests + strip test updated; live: "4" gave Terminal 1 plus three chooser panes 2x2, the split button opened Terminal 5 beside Terminal 1 in the same folder (3+2), "1" dropped the three unstarted panes and the second press showed the "started sessions" toast, the header close removed Terminal 5 and Terminal 1 took the full width; chords not provable from the harness (see decision); build / clippy / 39 Rust tests / 60 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-009-four.png, evidence/T-009-split.png, evidence/T-009-shrink.png, evidence/T-009-close.png
- 2026-10-09 · T-008-b · done: per-agent start-line builder with every SESS-051 prompt route (trailing, `--`, `--prompt`, `--prompt-interactive`, `-i`, Hermes query, typed), blank prompt = none, Hermes limit refused, foreground matcher with second names / Codex-Grok prefixes / interpreter entry scripts, "Opening prompt (optional)" box per AI seat, typed prompts sent after the pane goes quiet; 8 Rust tests + 1 chooser test; live: seat 1 Claude + Haiku with a prompt, Start opened worktree `silver-narwhal`, after the trust question Claude ran the prompt and answered "pong" with the session still open; build / clippy / 39 Rust tests / 54 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-008-b-prompt.png, evidence/T-008-b-launched.png
- 2026-10-09 · T-008-a · done: blank-seat caption, Same for all (greyed until a seat is finished), job-title field per seat, missing agents cleared not swapped, "Starting N sessions" toast, one pane per seat titled by its job, failed panes dropped with a toast; 2 seats tests + 1 chooser test; live: 3 seats blank with Start disabled, seat 1 Claude + Haiku then Same for all filled seats 2-3 and enabled Start 3, "Review" typed as seat 2's title, Start showed the toast and three Claude panes in worktree `velvet-seal` re-tiled 2+1 with the second titled Review; build / clippy / 31 Rust tests / 53 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-008-a-blank.png, evidence/T-008-a-same.png, evidence/T-008-a-toast.png, evidence/T-008-a-launched.png
- 2026-10-09 · T-007-b · done: chooser pane with per-seat AI and model radio groups, Start gated on every seat, count row 1/2/3/4/6/8 + free field, Start replaces the chooser with one pane per seat (`--model` appended, terminals in the same folder), close button hidden when it is the only pane; 4 seats tests + 3 chooser tests + 1 plus-menu test; live: menu item opened the chooser, Claude without a model kept Start disabled, Haiku enabled it, 3 → 2 kept seat 1, typing 15 + Enter gave fifteen seats with seats 1-2 untouched, 2 + Terminal + Start opened worktree `dusky-shrimp` with Claude (trust prompt) beside a PowerShell pane, a lone chooser had no close button; build / clippy / 31 Rust tests / 50 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-007-b.png, evidence/T-007-b-disabled.png, evidence/T-007-b-enabled.png, evidence/T-007-b-15.png, evidence/T-007-b-started.png
- 2026-10-09 · T-007-a · done: 34-agent catalogue with install detection on the PATH and the usual install folders (runnable files only), plus menu lists only installed agents with the default first and a "default" button on the others, `defaultAgent` saved in settings.json, `tab.newAgent` shortcut starts the default agent, `.cmd` shims start through cmd.exe; 4 Rust tests (find_in, catalogue order and start lines, newest nvm version, cmd shim start line) and 3 new front-end tests (menu ordering, default-agent setting, default-first rendering); live: menu showed only Claude Code and Codex of the 34 with Claude first and its Ctrl+Shift+K chip, "default" on Codex moved Codex to the top with the chip and wrote settings.json, clicking Codex opened worktree `ivory-crab` with Codex running through its npm `.cmd` shim; build / clippy / 31 Rust tests / 42 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-007-a.png, evidence/T-007-a-default.png, evidence/T-007-a-codex.png
- 2026-10-09 · T-006 · done: workspace switching (sidebar row click shows that workspace, panes of the others kept hidden, remove drops every pane inside the folder, empty-workspace placeholder) with 4 new front-end tests on the pure helpers; live: worktrees alpha and beta each got a shell, `echo alpha-one` / `echo beta-one`, switching back to alpha showed its earlier output unchanged with the row selected, removing beta dropped its pane (terminal count 3 to 2) and left alpha as it was; build / clippy / 28 Rust tests / 39 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-006.png, evidence/T-006-removed.png
- 2026-10-08 · T-006 · cut short by the usage limit before the live check: workspace switching code (pure helpers + 4 tests, hidden panes, sidebar selection, remove hook) passed tsc and 39 front-end tests but the live proof and the Rust gates had not run, so the work was reverted and the task stays unticked; the diff and the two new files are kept in the session scratchpad (t006-saved/) to re-apply next pass

- 2026-10-07 · Phase 2: write PLAN.md · done: 338 tasks covering 1,030 cards (228 P0, 564 P1, 199 P2, 27 H marked build, 12 X), no dropped card · `node scripts/plan-check.mjs` prints OK
- 2026-10-07 · T-001 · done: Tauri 2 window opens, SQLite state store and JSON settings under the profile folder, cargo-deny and JS license gates green, build/clippy/test/vitest green · evidence/T-001.png
- 2026-10-08 · T-002 · done: one PowerShell pane through a Rust PTY, drawn by xterm.js on the GPU with a plain fallback; typing, resize (shell reports 166x54 after the window grew) and Close all proven live; no shell left behind after Close or after closing the window; 4 Rust tests and 9 front-end tests green · evidence/T-002.png
- 2026-10-08 · T-003 · done: projects sidebar; a throwaway repository added as a project, "Fix login" created as branch `fix-login` in its own folder (confirmed with `git worktree list`), the pane opened inside it, then removed with a confirm step and both branch and folder gone on disk; 15 Rust tests (git runner round trip, name cleaner, project store) and 13 front-end tests green · evidence/T-003.png, evidence/T-003-removed.png
- 2026-10-08 · T-003b · done: frameless window with its own top bar, switcher, search box, usage pill and window controls; floating sidebar card; layout strip; rounded pane card with the design's header; status bar with live memory; palette from DESIGN.md as CSS custom properties; measured against the reference at 1920x1032: top bar 36 px, sidebar x 8..296, pane card from y 84, status bar from y 1008, all six background hexes exact, corners 1 px tighter; 16 Rust tests and 18 front-end tests green · evidence/T-003b.png, evidence/T-003b-compare.png
- 2026-10-08 · T-003b follow-up · done: chrome render test added (21 front-end tests green), hand-redrawn OpenAI knot removed in favour of a neutral glyph, cargo-deny installed and run ("licenses ok"), build / clippy / 16 Rust tests / tsc / JS licence check / plan check green; fresh maximized capture and side-by-side · evidence/T-003b.png, evidence/T-003b-compare.png
- 2026-10-08 · T-005 · done: shortcuts file read from the home folder (created empty when missing), 127 command ids with the COMPAT.md defaults per platform, overrides / null / win32 section / older top-level form / bad chords / unknown ids / conflicts all covered by 9 front-end tests and 4 Rust tests; live: chips show Ctrl+Shift+J and Ctrl+J from the map, an override in the win32 section showed Ctrl+Alt+P and "Unassigned" at the next start, a broken file showed the red notice with the defaults in use and was left untouched; Txais's own icon and mark carried over (src-tauri/icons regenerated); build / clippy / 28 Rust tests / 35 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-005.png, evidence/T-005-override.png, evidence/T-005-broken.png
- 2026-10-08 · T-004 · done: plus menu (sidebar and pane header) lists Claude Code and Codex with a PATH check, one click made worktree `jade-seahorse` off main and a pane running `claude --permission-mode auto` with mark, creature name, branch chip, "Claude", "Running"; closing the pane killed claude.exe; no orphan after closing the app; build / clippy / 24 Rust tests / 24 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-004-menu.png, evidence/T-004.png

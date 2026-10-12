# STATE
Status: RUNNING            (RUNNING | PAUSED | BLOCKED: reason)
Phase: 3                   (Phase 1 was done by the dirty-room team on 2026-10-06; Phase 2, the plan, on 2026-10-07)
Budget: 6 passes per day   (today: 25, date: 2026-10-09)
Next task: T-013-c · The two rules of the create-workspace card that T-013 left out (a creation overtaken by a newer one is cancelled and its half-made checkout removed; a stand-in tab while Git works)
Done: 138 / 419 tasks  ·  P0 parity: 0/228 cards

How to read this: `PLAN.md` holds the 419 tasks in build order; each names the spec cards it must
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
a card that waits for permission, and the live terminal inside an expanded card. Agents still
shows only its name (T-050). The Inbox lists what needs you, what is running and what finished
today. Agents report their own state through hooks Kolux installs for Claude Code and Codex
(permission, question, working, done, blocked, interrupted; subagents under their lead), with
one status vocabulary for every dot, chip and label, desktop notifications on finish and
permission, a quiet-terminal alert, tab and workspace unread marks, and a pane header with the
agent mark, name, branch, program, status word and gauge.

The sidebar lists projects (Git repositories, added by typing or browsing; nothing else is pulled
in) with their main checkout and workspaces (worktrees), grouped by project, status or pull
request and smart-sorted; each row carries the strongest live agent state. Mod+N or the plus
opens the name field with a live preview of the branch and folder; Create makes the worktree and
opens it with a shell; Remove asks first and deletes folder and branch. Clicking a row switches
workspaces instantly, each keeping its panes as they were. The plus menu lists only agents that
are really installed and starts one in a fresh pre-trusted worktree or as a tab; empty panes ask
what to run. Where workspaces live, how a new one starts (nested or flat, base branch) and the
shortcuts (`~\.kolux\keybindings.json`, 127 command ids) are the user's own and remembered. A
Source Control panel stages, commits, pushes and pulls. `kolux-dev worktree create / rm` and
`kolux-dev orchestration worker-start` (flag checking only) drive it from a terminal. Settings has
AI connections: Claude keys and managed accounts, Codex sign-in, sealed secrets, lapsed sign-ins
flagged in the main window. A 24 px status bar shows On, memory use, shell and plug counts.

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
twice; picking a linked worktree of a repository already added selects that project, and otherwise
adds the worktree folder itself). Each project lists its main checkout and its workspaces (Git
worktrees). Type a name such as "Fix login" and the sidebar shows the branch and folder it will get
(`txais-xiong/fix-login` by default: the branch begins with the Git user name, or custom text, or
nothing, picked in the sidebar gear's Git & worktrees part, which shows the next branch name as you
type and says when Git refuses the prefix or it is only slashes, so new branches get none, T-116-a;
there too Default compare base picks the repository default or the branch upstream for the branch
summary; the folder is `fix-login` under the workspaces folder, inside a
folder named after the project); Create makes the branch and folder and copies the ignored files
`.worktreeinclude` lists, within about 2 GB and 50,000 entries, naming what it left out. The new
workspace composer picks the project from a search list (Recent first, matching letters marked, a
path hint for projects sharing a name, Add project at the end), suggests the project's branches in the
name field (a name that is an existing branch opens that branch), turns shortcodes such as `:bug:` into
emoji, and calls a name with nothing usable `workspace`; it has a parent picker (No parent by default),
an Advanced part (branch name, reuse an existing branch, start from) and Create more, which keeps it
open for the next one. Shell restarts the terminal pane
inside that folder. Remove asks first, then deletes the folder and the branch (a branch that existed
before stays), closing any pane still sitting in that folder. Worktrees made outside Kolux (plain
`git worktree add`, another tool, the CLI) show up within about 5 seconds as one count line, for
example "3 new worktrees", which opens a review to hide or show each; any worktree row has a hide
button, and the project gear lists the hidden ones (10 a page, paths relative to the project) to show
again. A scan that fails (git missing, slow or the repository broken) removes nothing: the
worktrees already known stay listed under a yellow "Could not list the worktrees of <project>, so the
last known list stays" line (T-113-a). Worktrees Kolux made count as its own wherever they sit; the rest carry an "external" tag and
follow a show/hide choice per source (made by Claude Code, elsewhere on disk, up to 32 extra folders
the user lists): a global default in the sidebar gear (hidden for new projects) and a per-project
choice in the project gear that names the global value and resets to it. Projects added before this
keep showing them. The workspaces folder can be changed and
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
it in the same folder; Ctrl+Shift+D (split right), Alt+Shift+D (split down: the cell below; from a
single pane the pair is stacked, one column of two rows, until a split right makes it side by
side again, T-009-fix-a) and Ctrl+W (close the focused pane) go through the shortcuts file. Closing a pane ends its program and
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
folder the name becomes, a name with no usable letters becomes `workspace` (T-109-a), and a taken
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
panes and removes it (with `--force` the branch stays; T-160). `--json` prints the envelope (request id, success, result or error with
code, message and data, runtime id); exit 0 worked, 1 any error; help works with the app closed,
and a closed app answers "Kolux is not running; start it first".
T-117-a adds the lookups (CLI-009, CLI-015..017): `repo list`, `repo add --path` (relative to the
shell's folder; the sidebar shows it at once), `repo show`, `repo set-base-ref --ref` (checked
against Git first; new worktrees then start there), `repo search-refs [--query] [--limit]`
(branches, remotes and tags, case-insensitive), `project list` (the sidebar's projects in its
order), and `worktree list | ps | show | current`: each row carries its selector
`id:<repo-id>::<path>`, repo, branch, parent and children, lists say which hosts they covered
(local; none left out) and whether `--limit` cut them short, and `ps` shows only worktrees with an
open terminal, with each terminal's handle and program. Selectors: `--repo id:|name:|path:`;
`--worktree active|current` (the innermost worktree around the shell's folder; outside one it
says how to name one), `id:` or `identity:` `<repo-id>::<path>`, `name:`, `branch:`, `issue:`
(the issue it was made for) or `path:`; a bare value such as `42` is refused with the accepted
forms, two matches are refused as ambiguous, and `folder:` says folder workspaces are not built.
T-118 adds `worktree changes` and `worktree overlap` (CLI-021), both read-only and for the
worktree of the shell's folder unless `--worktree` names one. changes lists every file that
differs from the base (the repo's saved base, else its default branch; nothing is fetched),
committed and uncommitted together, untracked files as U. overlap names each sibling worktree of
the same repo, hidden ones included, that touches the same files, and predicts from the
committed tips whether they would conflict (and in which files); when Git cannot check the
merge (unrelated histories, an old Git) it says unverifiable, never clean. A sibling whose
changes cannot be read (its folder is gone) is listed apart, and the text then says the scan was
incomplete instead of claiming no overlap.
T-129-a makes `worktree ps` an orchestration summary (ORCH-040): one row per worktree that has an
open terminal or an unfinished worker, each worker with its dispatch, task, status and terminal,
and a scope line (repos, worktrees scanned, how many have work, this computer only). When a repo
cannot be scanned (its .git moved, git failing) or the scan takes over 3 seconds, its last known
worktrees are still listed, marked `[last known]`, and the scope line says why; a scan result,
failed or empty included, is reused for 1.5 seconds so polling does not start git each time. A
terminal polling with `--json` gets the whole snapshot once, then `{"unchanged": true}` while
nothing changes; text output is always the full list.

[core] T-134-a adds `kolux-dev terminal read | send | wait` (CLI-024, CLI-025). The reader thread keeps an `OutputLog` per session in `terminal.rs` (last 2000 lines, each numbered with a cursor, escapes stripped, a split UTF-8 character joined across chunks, a redrawn progress line kept in its last state); `read --cursor n --limit k` pages forward and warns when kept lines were dropped or more follow; `--screen` asks the window for the pane's xterm rows (`terminal-screen-request` event, `terminal_screen_reply` command, 1.5 s wait) and falls back to the stream with a warning. The stream is output with escapes removed, not a rendering: a line editor's redraws can leave traces in it. `send` writes `--text` (bracketed paste into an agent pane), `--enter`, `--interrupt` (Ctrl-C and the status cancel); a prompt (text + Enter to an agent) is watched for `--wait-submit` seconds through the status hooks' history and answers `turn_began`, `queued` or `unknown`; `--retry-request` replays a receipt kept in memory. `wait --for exit|tui-idle --timeout-ms` polls from the CLI side; a pane without hook reports counts as idle after 3 s without output, with a warning; permission, waiting and blocked end the wait non-zero. On this PC a pane's PowerShell start sets CLAUDE_CONFIG_DIR back to the user's real folder whatever the app was started with, so the Claude hook proof used a hand-posted report; a real pane's hooks firing is T-025-d's.

[core] T-139-b ties a Codex pane to the account it started on (ACCT-023, ACCT-064). `terminal_spawn` takes `account` (null for Codex's own sign-in, absent for a fresh pane) and answers the id it used; a pane restarted with its account waits up to 2 s for that account's home (`codex_accounts::wait_home`) and refuses with a try-again message when the account is no longer listed. `src/terminal/accountChange.ts` decides the prompt: only a running pane whose program is credited as Codex and that knows its account is asked; an active account other than the pane's shows the centred keep/restart prompt (`PaneNotice` in TerminalPane, `.pane-ask` overlay, primary button focused only when the pane is focused and visible); keeping remembers that account for that pane, a further change asks again, going back to the pane's own account clears the prompt; an account that was removed shows the needs-a-new-account prompt with Restart (or Open Settings when no account is active). Restart remounts the pane with a new key on the active account. Not built: the setup-change version of the prompt, re-asking after a Kolux restart (no pane restore yet), pane-output scanning for Codex sign-in errors (T-139-d); a failed restart is a failed launch (DT-C19).

[core] T-145-b makes a program's colour and light/dark questions work through the Windows console layer (TERM-098). Measured in `pty.rs` tests: the palette question (OSC 4 "?"), the light/dark question (CSI ? 996 n) and the subscription (CSI ? 2031 h) reach the pane; the foreground/background questions (OSC 10/11 "?") never leave the console layer (DT-C20, T-145-c). What was lost was the reply: written as plain bytes the console drops it, so `PtySession::write` sends a reply (anything starting with OSC, or CSI ? 997 ;) as win32-input-mode key events, a key-down and a key-up per character (down only makes the console coalesce repeated characters: `dddd` read back as `ddddd`). Live: a PowerShell pane asking `CSI ? 996 n` and `OSC 4;1;?` got `CSI ? 997 ; 2 n` (light mode) and the Tango red back. The output event now carries the pane key, and the pane matches output by key until the spawn call has answered with its terminal id, so the program's first frame and its cursor question are no longer dropped; a fresh tab shows only the prompt.

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
`write_whole` shared by both). Cursor and Copilot get nothing (DT-C17, T-017-c, [core]):
neither documents where its trust decision lives, so their own prompt stays with the user.

T-130 (orchestration lane) adds the Runs dashboard (AUTO-015): Runs in the Automations toolbar
opens one table of every automation's runs, newest first (automation, run number, how it started,
when, status), with a search box, a status filter (in progress, successful, failed, skipped),
tiles counting successes and failures over the last 24 hours and 7 days (runs dated in the future
count in neither) and Refresh. Rows arrive 100 at a time as the table is scrolled to its end and
only the rows on screen are drawn; an event-started run names its event on hover; with no runs
the table says so. Clicking a run opens it as a full page (automation, status, how and when it
started, workspace, detail) under a breadcrumb: Runs goes back to the dashboard as it was,
Automations to the list. Leaving to Automations and coming back starts at the newest runs. A
failed Refresh keeps the rows shown and says it failed. Saved output and usage are T-140.

T-086 (orchestration lane) adds the Automations page (AUTO-016, AUTO-019): the clock
button in the sidebar footer opens it over the content column (the pane grid stays alive
underneath; picking a workspace closes the page). A toolbar holds a search box (focused on open;
it looks at name, project, worktree, agent and the first 2,048 characters of the prompt, ignores
case and extra spaces, keeps its text across Refresh, refuses more than 200 characters), filters
(on / paused, last run's result, several agents at once), Refresh, Runs (the dashboard below,
T-130) and New Automation. The table keeps its header and first column in view,
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

T-082 (orchestration lane) gives agents a mailbox. Every Kolux terminal now carries
KOLUX_TERMINAL_HANDLE (term-<n>) and a secret KOLUX_PANE_KEY, so `kolux-dev orchestration` knows which
pane is calling. From a Kolux terminal, run-create opens a Run and ties that terminal to it;
run-current, run-list (newest first, pages with a cursor), run-show and run-use (switch) follow.
send stores typed mail for a Run (run:<id>), a worker (dispatch:<id>) or another terminal, with
kind, priority and the report extras; check hands out the oldest unacknowledged batch under one
delivery id and repeats it until --ack, with --peek, --unread, --all and --types; check --wait
blocks until mail comes or the timeout passes, writing a keepalive line every 15 seconds. A shell
Kolux did not start is turned away instead of being tied to a guess, and a retry request id makes
create, use and send safe to repeat.

T-083 (orchestration lane) lets a coordinator hand out tasks and talk back and forth with its
agents (ORCH-006, ORCH-010, ORCH-011, ORCH-013). `kolux orchestration task-create` adds a task to the
Run; a task that waits on others (`--deps '["task-1"]'`) stays pending until they finish, and a
task that names an unknown task, has bad JSON or is bigger than 4 MiB is refused with nothing made.
`task-list` shows the Run's tasks, `--ready` only the ones that can start, `--brief` a short form,
and a task held by an agent shows that agent's pane until the pane closes. `dispatch --task <id> --to
<pane>` hands a ready task to the agent running in another pane; `--inject` types the brief straight
into it as one paste (Claude Code received a multi-line brief whole), `--dry-run` shows the plan and
changes nothing, and fixed refusals cover a waiting or taken task, the coordinator's own pane, a pane
with no agent and a busy agent. `dispatch-show` gives the task's latest hand-off. Every delivered
message now carries the command that answers it: `reply --id <msg>` sends the answer back to the
sender on the same thread, and `inbox` shows the newest mail, bodies cut to 120 characters unless
`--full`.

T-084 (orchestration lane) gives every worker a real brief and picks its model by tier from
the coordinator's own agent (ORCH-014, ORCH-018). Whether a worker is started with `worker-start` or
handed a task with `dispatch`, it now reads, ahead of its task: the exact one-line commands to report
done (succeeded or failed), to send a heartbeat about every five minutes, and to ask the coordinator
a question, each carrying its task, dispatch and Run; to look for mail between steps; and to wait
at its prompt after reporting. When its worktree is behind its base, a "Base drift" line says by
how many commits. The task text always comes last, under a divider. `dispatch-show --preamble`
prints that brief. `worker-start --tier light` from a Claude coordinator's pane starts a Claude
worker on Haiku with no effort setting; naming a different agent with a tier, or a tier with a
model, is turned away. The commands say `kolux-dev` in development builds and `kolux` in releases.

T-088 (orchestration lane) makes the command line work in every terminal Kolux opens, with no
setup (CLI-007). Each new pane, shell or agent, has Kolux's own program folder first on its search
path, so typing `kolux-dev` (or `kolux` in a release) runs the copy that ships with this app even
when an older one is installed system-wide, and the pane is told which running app to talk to, so a
development or side-by-side build answers its own panes. Sends are now checked before anything else:
a heartbeat or done report addressed to a group (`@all`, `@worktree:`) is turned away, and so is a
message that gives its details both as flags (`--task-id` and the like) and as `--payload` JSON
(CLI-031). Runs, sends, replies, check and inbox (CLI-030, CLI-032) were already in place from T-082
and T-083.

T-089-a (orchestration lane) lets a coordinator hand a task to an agent tab that is already open
(CLI-035): `worker-start --task <id> --terminal <handle> --worktree current` types the worker brief
into that tab, provided it runs in the named worktree and runs the coordinator's own agent, and the
receipt says it reused the tab. A fresh worker's receipt now says which way it was launched and where
to find its background tab in the sidebar. `dispatch --task <id> --dry-run` needs no recipient and
prints the opening text without handing anything on (CLI-034). Task dependency lists still arrive
when PowerShell strips their quotes, `task-create` from outside any Kolux terminal is turned away
and every task records the terminal that made it, and a terminal whose handle has gone stale is
recognised again from its pane key. The reply hint on delivered mail names this build's own command.

[orchestration] T-155-a keeps workers and Runs in bounds (ORCH-023, ORCH-032, ORCH-033).
`kolux-dev orchestration worker-abandon --dispatch <id>` fences a dispatch off: from then on its
worker's done report and heartbeat are turned away ("dispatch-1 was abandoned: Kolux takes no more
reports on it"), its task is ready to hand on again, and its terminal keeps running with the pane
open; this works the same for a low-level `dispatch`. A worker that runs `worker-start` (or hands a
task to another tab) is turned away and told to do the task itself, unless the coordinator gave
more room: `--max-depth 2` on worker-start or dispatch (or `orchestrationMaxDepth` in settings.json)
lets its workers start one more level, and the level after that is turned away. A worker can never
raise its own cap, and its brief mentions sub-workers only while it has a level left. Two
coordinators on one machine each see only their own Run: the other Run's tasks, dispatches,
messages and terminals read as not found, exactly like ids that do not exist; `task-list --run
<other>` still shows the other Run's list, but changing it or reading its mail needs the
terminal to be in that Run. A worker acts in its coordinator's Run without being tied to it.

[orchestration] T-160 catches typos and settles who is calling (CLI-003, CLI-020, CLI-039).
A wrong command word or flag is named with the nearest valid one, before the app is looked for:
`kolux-dev worktre list` asks "did you mean worktree list?", `worktree rmm` offers rm but
`worktree lst` offers list (rm, remove and delete are offered only from one edit away), and
`worktree show --worktre` offers `--worktree` and lists the flags that command takes. A typo
ahead of the command words (`--jso worktree --json list`) is reported against worktree list;
on `orchestration check`, `--from` points to `--terminal`. With `--json` the error data carries
the unknown word, the command, suggestions, a ready next-step command line and the flags; exit 1.
`worktree rm --force` removes a checkout with uncommitted changes and keeps its branch; a plain rm
(or remove, or delete) still takes the branch it made. `--from` may now only name the calling
terminal itself: naming another terminal is refused ("this command runs in term-1, so it cannot
act as term-2"), and so is any `--from` from a shell Kolux did not start. A done report or
heartbeat on a dispatch is taken only from that dispatch's worker terminal, so another pane can
never report someone else's task finished.

[orchestration] T-186-a changes a workspace's parent from the sidebar (PROJ-040, PROJ-048). Each
workspace row other than main has a Change parent button (an arrow) that opens a "Move under"
list under the row. The list never offers the workspace itself, its current parent, anything
nested under it or the main checkout; "No parent" (top level) is offered when it has one.
Picking one moves the row and everything under it there. The list closes first, so when a move
is refused (the chosen parent was removed meanwhile) the reason shows below the list in yellow.
The new-workspace composer checks its picked parent when it creates: a parent removed while the
composer was open is dropped, the new workspace sits at the top level, and the yellow note says
why. Board-card drops and `worktree set` wait on T-186-b.

[orchestration] T-187-a saves a lineup to use again (SESS-020). The chooser's Shape row has a
"Save as team" button, greyed until every seat has its AI and model (or Terminal). It opens a name
field; Save adds the team after the built-in shapes, keeping each seat's AI, model, role, job title
and opening prompt, the Folders choice and the shared task. Picking it fills the seats back in; a
seat whose AI is no longer installed comes back blank. A name already used (any letter case) gets
a number ("Review crew 2"). The dots button beside a team renames it (a blank name changes
nothing) or deletes it, and a delete leaves "Deleted Review crew. Undo" for eight seconds. Limits:
40 teams, 60-character names, 12 seats, 4000-character prompts. Teams are kept in settings.json
under `savedShapes`. Carrying a conversation to another agent and starting an agent from failing
checks or an issue wait on T-187-b.

[orchestration] T-189-a adds the Automations title-bar button and asks an agent to resolve
merge conflicts (VIEW-011, VIEW-069). Settings > Appearance has a Title bar card whose
"Automations button" switch is off by default; turned on, a clock button sits left of the Source
Control toggle and opens or closes the Automations page (from Agents or Board it switches to
Terminals first). Whichever page was open at quit (Automations or model routing) is shown again
at the next start (`openPage` in settings.json). When the workspace in front has merge conflicts,
Source Control shows "Resolve conflicts with an agent…", which opens a small dialog in the panel:
the agent (installed ones only), the prompt naming every conflicted file (editable), and "Start
this agent without asking next time". Start opens the agent in a new tab in that workspace with the
prompt. With a remembered agent the button reads "Resolve conflicts with <agent>" and starts it at
once, once per click even when clicked twice; "Ask each time" forgets the choice (`scmAgent`). A
start that cannot be set up shows why in the panel; a program that cannot be run, or one that ends
before a typed-in opening prompt was handed over, is reported as a session that did not start. The
Skills button and continuing a session with another agent wait on T-189-b.

[orchestration] T-190-a adds group mail, the mail banner and worker models by name (ORCH-004,
ORCH-009, ORCH-019). `send --to` takes @all, @idle, @worktree:<id> (the worktree list id or its
folder), @claude, @codex, @cursor and @droid: one copy goes to each matching agent terminal, all
on one thread (the given `--thread-id` or a new one), and the receipt lists only the messages made.
The sender never gets its own copy; shells and agents of unknown kind are left out; the agent is
the program Kolux started, never the pane title. @idle means an agent that has written nothing for
3 seconds. An unknown group, a group that matches nobody, or a question to a group is an error and
nothing is sent. `check` and `inbox` print each message as a banner: a HIGH or URGENT tag, the kind
and id, the sender's agent and handle, subject, body, payload, the reply command, then a divider.
`worker-start --model <name>` alone is enough to start a worker: with no tier it runs on the
coordinator's own agent (or `--agent`, or the default agent), and a model Kolux knows belongs to
another provider is turned away before anything starts ("sonnet is a Claude Code model, not a
Codex one"); `--effort` still needs `--model`.

[orchestration] T-190-b adds decision gates and the ask command (ORCH-028, ORCH-029).
`gate-create --task <id> --question <text> [--options <json list>]` turns a pending or ready task of
the caller's Run blocked; choices written as a plain comma list are turned away as not a JSON list,
a task with a supervised worker still at work or one that has finished cannot be held, and a refused
gate leaves nothing behind. `gate-resolve --id <gate> --resolution <text>` settles it and the task
goes back to ready once no open gate holds it; resolving twice, or a gate of another Run, is refused
(the other Run's gate reads as not found). `gate-list [--task] [--status pending|resolved|timeout]
[--run]` reads the caller's Run or a named one. `ask --question <text> [--options a,b] [--to <who>]`
puts one question to one recipient (the caller's Run unless `--to` names another; a group address is
turned away and nothing is made) and waits for the first reply, five minutes by default or
`--timeout-ms`; when the time is up the question stays open and the command prints the `ask --resume
<message>` line that waits on it again; mixing `--question` and `--resume` is refused. No gate times
out yet, since gate-create takes no deadline.

[orchestration] T-191-a adds reset by scope, JSON on every orchestration command and the
claude-teams command (ORCH-031, ORCH-065, ORCH-041). `orchestration reset` takes exactly one of
`--tasks` (clears tasks, workers and gates; Runs and mail are kept), `--messages` (clears the mail;
Runs, tasks and delivery positions are kept, so nothing is handed out again) or `--all`; none or two
are refused. Every orchestration command has its line in `kolux-dev --help` and, with `--json`,
prints one envelope: the result, or an error with a code and a message. `kolux-dev claude-teams
[claude arguments]` refuses on Windows ("not supported on Windows yet", exit 1) and outside a Kolux
terminal; elsewhere it starts Claude Code with Agent Teams turned on and teammates in-process,
passing every argument through. The picker entry, the Agent Teams mode preference and the new-tab
keybinding command wait on T-191-b.

[orchestration] T-192-a adds the automation dialog's clock boxes, a Custom line that checks itself
and starter templates (AUTO-003, AUTO-002, AUTO-006). The time is an hour box, a minute box and AM
or PM, kept as 24-hour time (1:30 PM saves as 13:30); a new automation starts at 09:00, a box that
loses focus snaps into range (75 minutes becomes 59) and an empty one takes its smallest value, the
Up and Down arrows nudge it, and Every hour keeps only the minute box. Choosing Custom fills the line
with the cron line of the timetable chosen before (weekly, Tuesday, 10:30 gives `30 10 * * 2`), and
going to a preset and back brings back what was typed; five chips name the fields and a status line
reads Valid with the line in words or Invalid with the reason, and Save stays off while it is
invalid. The chips, the weekday names and the line's day and month names follow the window's
language. With no automations yet the page shows four templates (weekday repo audit, weekly release
check, daily review, hourly upkeep) and a blank choice, and the dialog's Templates button shows them
again; a template only fills the form. The templates' grace windows, the precheck command and session
reuse wait on T-192-b.

[orchestration] T-193-a adds keyboard control and the Overview tab to the Automations page
(AUTO-017, AUTO-018). Up and Down move the selection from the search box or a focused row, Enter (or
Space on a row, or a double click) opens the automation as its own page under an "Automations ›
name" breadcrumb, Left and Right switch Overview and Runs, and Escape goes back to the list and,
from the list, closes the page; an open dialog, menu or confirm keeps Escape for itself. Deleting
the selected row moves the selection and focus to the row now in its place. Overview lists the
timetable or trigger, upcoming run, worktree, agent, run count and usage ("Not recorded yet"), and a
long prompt is folded behind "Show the whole prompt". When the run history cannot be read, the
automations still load and the run count reads "unknown" with a warning. The command group and
Hermes and OpenClaw jobs wait on T-193-b.

[orchestration] T-194 finishes GIT-068 on top of T-118's `worktree changes` and `worktree overlap`:
the clash forecast reads clean, "would conflict in <paths>", or unverifiable, and with a Git older
than 2.38 (the version read once at startup) it is unverifiable with that reason and the merge
check is never tried, so an unsupported Git is not probed again.

[orchestration] T-197-a adds `kolux automations list | show | runs | create | edit | remove | run`
on the command line. They read and change the same store as the Automations page, so a row made
from a terminal shows on the page at once. Bad flags are refused before the app is asked (time as
HH:MM, day 0 to 6, workspace mode, not-both pairs, and a trigger with any timetable edit); every row
carries its project and host, `--json` gives the full rows, and `run` logs a manual run.

[orchestration] T-198-a: `kolux agent-context` describes every command (schema 1, a count, one
entry each with aliases, flags, usage and whether its arguments are passed through raw), and
`kolux skills list` and `skills get <topic>` print the four bundled guides (kolux-cli,
orchestration, koluxsecurity, koluxward) short, with `--full`, or one `--reference`. All three
answer with the app closed. `orchestration gate-create` with no Run attached now fails and
creates nothing.

**Source Control (T-018-a, GIT-002 / GIT-004).** Mod+Shift+G, Mod+L or the top bar's right panel
button opens a 320 px card right of the content with the workspace in front's changes under
Conflicts, Staged, Changes and Untracked, each with its count and a stage-all / unstage-all
control, plus or minus on every row (renames show `from → to`; names such as `docs/c d.md` and
`a[1].txt` stay whole), and a commit box. Commit, and Ctrl+Enter anywhere in the card, is live
only with staged work, a non-blank message and no conflict; it commits the message exactly as
typed, shows `Committed <short id>` and refreshes. A failed commit shows `Commit failed`, or
`Commit blocked by a hook` when a pre-commit / prepare-commit-msg / commit-msg /
pre-merge-commit hook exists, with git's and the hook's own output behind a disclosure and a
`Fix with AI` button that starts the default agent in that workspace with the output as its
prompt. The draft message is kept per worktree for the window's life, through closing the card
and switching workspaces. Back end `scm.rs`: `scm_status` (porcelain v2, `--untracked-files=all`,
NUL-separated), `scm_stage` (one `git add` / `git restore --staged` fed NUL-separated paths on
stdin with `--literal-pathspecs`, paths checked to stay inside the worktree, 2 000 files in one
call), `scm_commit` (`-F -`). The list refreshes after each action and every 4 s while the card
is open; the watcher is GIT-001's (T-033) and folder rows are T-033's tree view. Rows select on
click (Ctrl adds, Shift spans, Esc clears) and a bulk bar above the list reads N selected · Stage k
· Unstage m, each button feeding the whole selection to one `scm_stage` call ([core], T-018-c).
A branch summary sits on top (T-111-a, VIEW-068): the branch, commits ahead and
behind the base, and the lines its commits added and removed since they parted from it, in full
with grouped digits (+11,012); opened, it splits them into Source, Tests and Generated rows that add
up (Non-generated when no test file changed; no Generated row when there is none), and a screen
reader hears the split even while it is closed. It is measured again when HEAD moves and every 30 s,
the last one staying up meanwhile. "Compare with the upstream" (off by default, the settings key
`scmSummaryUpstream`) measures against the branch's upstream instead; a base pinned for the project
still wins. A folded Handoff note sits at the foot of the card (T-115-a, EDIT-040): one note per
workspace folder, saved 0.7 s after typing stops and when focus leaves, its state shown as Saving…,
Saved, Not saved: <why> (over 256 KB) or Changed N min ago; it survives a restart, a damaged one
reads as empty, and removing the workspace forgets it. Hand to agent… starts the chosen installed
agent (the default first) in a new pane of that workspace with the note as its first prompt and adds
"— Handed to <agent> on <date time>" to the note.

**Main button and remote menu (T-018-b, GIT-006 / GIT-007).** The large button under the commit
box always names the next step: Stage all while edits wait with nothing staged; Commit once
something is staged (held with "Write a message first" or "Resolve the conflicts first"); Publish
branch for a branch with no upstream (held with "HEAD is detached"); Force push with lease when
the upstream holds only patches the branch already has, as after a rebase; Sync ↓behind ↑ahead,
Pull n or Push n by the counts; Create pull request on a clean, pushed branch (the composer is
GIT-021, T-228, and the button says so). The Remote menu lists push, pull, sync, fetch,
fast-forward, force push with lease, publish branch and rebase from base, labels carrying counts
("Push 2 commits", "Sync ↓1 ↑2", "Rebase from origin/main"), every disabled item showing its
reason (no branch checked out, branch unpublished, nothing to push / pull, already current, local
commits are in the way, already published, this is the base branch). Actions run against the
branch's own remote only (publish pushes to origin and sets it as upstream; force always carries a
lease; rebase fetches first); a failure shows git's words with Fix with AI. Status never touches
the network: ahead / behind come from the refs git has, so an unpublished branch is never checked
against the remote; only an explicit menu action does. Back end: `scm_remote` in `scm.rs`,
`Status.rewritten` (`git cherry HEAD @{upstream}` all `-`) and `Status.base`.

**Worktree create, move and remove on the Git side (T-019, GIT-067).** A new workspace brings
along what the repository says: git-ignored files named in `.worktreeinclude` at the repo root
(one literal path per line, `#` comments; wildcard and negation lines are skipped with a warning)
are copied from the main checkout, and git-ignored folders under `worktree.sharedDirectories` in
`kolux.yaml` are linked (a junction on Windows, so no privilege is needed and git sees a folder),
so every workspace shares one `node_modules`. Entries are tidied before anything on disk changes:
absolute paths, paths with `..`, paths into `.git`, duplicates and trailing slashes; a folder that
is not ignored, a file missing from the main checkout or a link that could not be made comes back
as a warning in the sidebar's "created …" note, never as a failed create. A tracked file is never
copied over. Creations in one repository take turns (a failed one hands the turn on). Removing a
workspace with uncommitted work (submodule work included) is refused; the sidebar form then asks
again with "Discard and remove", and nothing is lost until that click. The shared-folder links are
taken out first, so removal never touches the folders behind them. The branch is deleted only
when no other worktree has it checked out; otherwise the commit it stood at is recorded so
`Git::delete_branch_if_at` can delete it later only while unmoved (the form's keep-branch choice
is T-218). `Git::worktree_move` goes through `git worktree move`. A base ref that could read as a
git option or range (leading dash, blanks, `..`) is refused before any git command runs. Back end:
`include.rs` (new), `git.rs`, `projects.rs`; `workspace_remove` takes `force`.

**The workspaces folder (T-020, SET-032, PROJ-026).** The sidebar's Workspaces-folder field saves
on Enter, puts the saved folder back on Escape, and does nothing while an input method is still
composing; leaving the field sends the typed folder again whenever it differs from the saved one,
so a save that failed is retried by moving on. An absolute folder is made at save time, and one
that cannot be made (a path under a file, say) is a failed save that keeps the typed text in the
field. Browse… picks the folder with the native dialog and saves it at once. Folders used before
are offered from the field's list. `KOLUX_WORKSPACES_DIR` (trimmed, blank counts as unset)
replaces the default folder without opening Settings; a saved folder still wins over it, and the
field's label says "(from KOLUX_WORKSPACES_DIR)" while the variable is what supplies the folder.
Back end: `projects::resolve_workspaces_dir`, `PlaceInfo.fromEnv`, `set_place`.

**Worktree create from the command line, with lineage (T-021, CLI-018).** On top of T-014-b,
`kolux-dev worktree create` records how the workspace came to be: made by the CLI, the folder the
call was made in, the parent worktree (the one the call was made from, the main checkout
included; `--parent-worktree <selector>` names another in the same project, `--no-parent` records
none, and a call from outside every worktree has none), `--issue <number>` and `--comment
<text>`. The record lives in the store under `workspaceOrigins` (`projects::set_origin` /
`origin`), is echoed in the result and goes when the worktree is removed from either the CLI or
the sidebar. Refused before the app is asked: `--parent-workspace` (retired; the message names
`--parent-worktree`), a parent flag with no or an empty value, `--issue` that is not a positive
whole number, and the earlier refusals (prompt without agent, empty agent/prompt/setup,
disagreeing parent flags, `--run-hooks` with `--setup skip`). A parent selector that matches
nothing fails before anything is created. The sidebar does not draw lineage yet (PROJ-047,
T-077).

T-022 (PROJ-045, PROJ-050, PROJ-063): each sidebar row shows the strongest live state among the
panes open in its folder as a coloured dot (amber for what needs you, green working, teal done,
grey idle; a permission request outranks everything), and the main checkout's row gets the same
dot. A state change in a workspace that is not in front marks its row unread (bold name and an
amber mark); showing it clears the mark, and the bell button on any row, the shown one included,
flips the mark by hand. The shown row carries a thin accent bar. The Sliders button in the
Projects header opens Group by (Project, None, Status, Pull request) and Sort (Smart, Name); both
are settings keys (`workspaceGroupBy`, `workspaceSort`) remembered across launches, and an old
"recent" sort is moved to Smart once. Smart puts what needs you first, then done, then working,
then idle, newest change first inside each class; an interrupted agent is never among the done.
Status and Pull request grouping draw folding headers with counts; None is one flat list with
the project name at the right of each row. A branch switched inside a workspace folder shows on
its row within five seconds (a poll while the window is visible; watching is PROJ-041, T-107).
Today the only live states are working, done and idle, read from whether an agent's program is
up; the hook-fed states and the pull-request feed are named on T-025 and T-229.

T-023 (TERM-020, TERM-021, TERM-023, TERM-030; STAT-051, VIEW-047): the pane header's status
word is tinted by `status.ts`: an agent reads Starting then Working (cyan), Done (green) once
its program ends well, "Ended (code)" neutral when it stopped otherwise, Failed (amber) when it
could not start; a plain shell reads Starting, Ready and Ended in the neutral tone; the status
dot keeps its spoken label. A Done agent shows its age next to the word ("just now", then "1m
ago", refreshed each minute), and a pane whose agent finished while another pane was focused
carries a static green glow until it is focused. Ctrl+J (Cmd+Shift+J on macOS;
`terminals.focusNextNeedsYou`) cycles through the panes waiting on the user in grid order
across workspaces and leaves focus alone when none waits; today no pane waits, since what an
agent needs arrives with the status hooks (T-025), so the two-waiting cycle is proved in tests.

T-024 (TERM-055, TERM-118): a cell with two or more tabs shows one badge beside each tab's agent
icon: a spinner while the agent works, a question mark while it waits on the user (fed by the
status hooks, T-025), a bell for a finish or a terminal bell not yet looked at, a green check for
a finish that was; an idle shell tab shows only its icon. An agent that finishes, or any program
that rings the bell, while its pane is not in view (a hidden tab, a hidden split pane, another
workspace in front, or the window in the background) marks the tab, the pane (green glow) and
the workspace row unread and shows a passing note in the window ("Claude finished", "Terminal 3
rang the bell"); looking at the pane in a focused window clears all three. A finish in the pane
being looked at adds no mark. A late event for a pane that is gone or already marked is dropped.
The desktop notification itself is T-026; the choices it will follow are on Settings >
Notifications (T-133, below).

[orchestration] Settings > Notifications is built (T-133, SET-034): switches for which alerts to
send (a task finished: on, a terminal bell: off, an agent stopped: on, usage nearing its limit:
on), "Stay quiet about the worktree you are looking at" (on), the sound (System default, or one
of Kolux's own tones Chime, Ping, Pulse) and a volume slider, with 0 shown as Silent. "Send a
test notification" shows a real Windows notification with the chosen sound, and only that one
sound (a Kolux tone plays with a silent notification); at volume 0 it appears in silence. When
Windows has app notifications switched off the page says so instead of sending, and a link
opens the system's own notification settings. Nothing sends notifications on these choices yet:
that is T-026.

[core] T-025-a (STAT-001, STAT-007): agents report their own state through hooks. At start Kolux
opens a loopback listener (port and token in `agent-hooks-endpoint.txt` in the profile folder,
removed at exit), writes `~/.kolux-rs/agent-hooks/claude.cmd` and puts one Kolux RS entry under
each of Claude Code's twelve hook events in the user's Claude settings file (`settings.json`
beside `.claude.json`, `CLAUDE_CONFIG_DIR` honoured; every other entry stays, a file that is
not JSON is left alone, the file keeps its indent). Every pane's programs see
`KOLUX_AGENT_HOOK_PORT`, `KOLUX_AGENT_HOOK_TOKEN`, `KOLUX_PANE_KEY`, `KOLUX_TERMINAL_HANDLE`,
`KOLUX_HOOK_ENDPOINT` and `KOLUX_HOOK_IDENTITY`. The script guards on those, reads the endpoint
file, posts the event with the system curl inside 1.5 s and always exits 0. The listener maps
Claude's events (SessionStart from startup, resume or clear and a manual PostCompact: done with
a boundary; UserPromptSubmit and PostToolUse: working; PreToolUse: working with the tool, or
waiting for AskUserQuestion and ExitPlanMode; PermissionRequest: permission; Stop: done;
StopFailure: blocked; a sub-agent's events are ignored) and raises `agent-status` to the
window. The pane header shows Needs you, Blocked, Interrupted or Done (with its age) while the
program still runs, the tab badge shows the check when the turn is over, the workspace row's
dot takes the hook state over the guess, Ctrl+J visits every pane the hooks say is waiting, and
a turn ending out of view is noticed like an exit. The hooks are always on (the switch is
T-120); Codex and the sub-agent roster are T-025-b and T-025-c. Proved with events sent
through the real script; a real Claude Code session is T-025-d.

[core] T-025-b (STAT-008): Codex reports through the same listener. Kolux writes
`~/.kolux-rs/agent-hooks/codex.cmd` (the Claude script posting to Codex's path) and, at start,
puts one Kolux RS group under each of Codex's eight hook events in the user's `hooks.json`
(`CODEX_HOME` or `~/.codex`), after the user's own groups, replacing a stale one where it
stands; a file that is not JSON is left alone. The trust entries come from Codex itself (DT-C3):
Kolux starts `codex app-server` hidden on that home, asks `hooks/list`, and writes each of its
own entries' key and hash to `[hooks.state."<key>"] trusted_hash` in that home's `config.toml`;
the user's own entries are never marked. An unchanged file whose entries are all in the table
costs nothing on later launches; when Codex is missing or does not answer, `hooks.json` goes
back exactly as it was (or away, when Kolux created it) and stderr says so. A managed Codex
account's home gets the same install when its pane spawns. Events: SessionStart working with a
boundary, UserPromptSubmit working with the prompt, PreToolUse working with the tool (waiting
for `request_user_input`), PermissionRequest permission (no decision returned), PostToolUse
working, Stop done; a sub-agent's events are ignored until the roster (T-025-c). Proved with
Codex 0.156.1's own listing on a scratch home (`evidence/T-025-b-trust.txt`: Kolux's eight
entries trusted, the user's own Stop hook left untrusted) and events sent through the real
script to a Codex pane (`T-025-b-needs.png`, `-done.png`). Open: Codex's source clears the
hook's environment on Windows before running it; whether the pane's variables survive is
unverified, and if they do not the script exits silently (a real Codex session is T-025-e). The
Devin-variable skip is not built (DT-C4).

[core] T-025-c (STAT-026 and the rest of the stored status): `src-tauri/src/status.rs` keeps a
session per pane between hook events: the lead's own state, the tool it waits on a permission
for, the roster of sub-agents and teammates (id, role, model, state, start time; 32 at most), whether
Claude's background tasks were still in flight at the last Stop, the interrupted flag, the last
reply and the last twenty states with their prompt and start time (`agent_history` command). The
state the window sees is resolved from all of it: a child waiting on Txais comes first (needs you
on the lead), then the lead's own needs, then working while the lead, any child or background
work is busy, else the lead's last state. Sub-agent events (an `agent_id` on them, or
SubagentStart/SubagentStop/TeammateIdle) move the child only; a child's permission clears when
that same tool resumes in the child, when the teammate goes idle or when it stops, never on the
lead's unrelated progress; a child already gone never comes back; a child's Stop carries its own
reply and name so it can be announced on its own. The lead's permission clears only when the same
tool carries on, a new prompt arrives or the turn ends. Ctrl+C or Escape typed into the pane while
the lead itself works (no child or background work live) marks the coming Stop interrupted, and
late tool events cannot bring the turn back to working until the next prompt. The prompt Claude
re-submits after an automatic compact is not a turn. The pane header shows "N agents, M waiting"
beside the status word with the roster as hover text. Proved with events through the real script
on a Claude pane: lead Stop with a child live stays Working with "1 agent", a child's permission
reads Needs you "1 agent, 1 waiting" and survives the lead's unrelated tool step, the teammate
going idle clears it, Escape then Stop reads Interrupted and a late PostToolUse leaves it there
(`evidence/T-025-c-lead-working.png`, `-child-needs.png`, `-done.png`, `-interrupted.png`). Not
built: the queued state (not a hook state, DT-C5), the partial mark on a cut-short background list
(DT-C6), and the interrupted conclusion when the agent sends no Stop at all (a timer; the rest of
that card).

[core] T-026-a (STAT-041 desktop notification, STAT-045 quiet alert): the window's finish-and-bell
note (`noticed` in `App.tsx`) now also raises a Windows notification through `tauri-plugin-
notification` (a `notify` command) whenever the pane is out of view or the window is not focused,
unless the 'Agent Task Complete' switch is off; the unread mark and the in-window toast keep
T-024's one-mark-until-viewed rule, the desktop notification does not (every finish, permission
request, block, interrupt and sub-agent turn is one of its own). `src/terminal/notify.ts` words
the note: "Claude finished" with a one-line preview of the reply, "needs permission", "is
blocked", "was interrupted", "code-reviewer finished" for a sub-agent's turn (the roster now
announces the child's role, not its id), and "repo · Claude finished" when more than one
repository has agents running; session boundaries and replayed events say nothing. The quiet
alert is judged in Rust by the terminal's own output (`Terminals::silence`, from the output marks
programs already carry), every 15 s, against the `quietMinutes` setting (10 by default, 0 off):
a working pane past the threshold fires one `agent-quiet` event per silent spell
(`Session::quiet`, re-armed by fresh output or by leaving the working state); the window shows
the toast and a desktop notification for it regardless of view or switch, since the minutes are
its own switch. Settings gained a Notifications page (the switch and the minutes, saved over a
fresh read). Proved on the lane app with events through the real script: a permission request,
a finish with its reply preview and the one-minute quiet alert each raised a Windows toast
(`evidence/T-026-a-permission-toast.png`, `-finished-toast.png`, `-quiet-toast.png`), the quiet
alert also as the in-window toast (`-quiet-window.png`), and the alert fired once in eight
minutes of further silence; the settings page in `-settings.png`. In a dev build Windows names
the sender "Windows PowerShell" (the plugin's debug app id); an installed build carries Kolux's
own identifier. Not built: the "quiet 12m" tag on agent-dashboard drawer rows (the drawer is a
later view; `Terminals::silence` is what it will read), and nothing is sent for Cursor Agent
shell steps or Grok prompts because neither agent is wired yet. The status vocabulary and the
Inbox are split off as T-026-b and T-026-c.

[core] T-026-b (STAT-052 one status vocabulary): `VOCAB` in `src/terminal/status.ts` is the one
table every status surface reads: a word, a glyph, a tone and a hover explanation for working,
background, blocked, waiting, permission, interrupted, failed, done, idle, no recent update
(`stale`), plus the Agents view's starting, cannot-reach (`unreachable`) and stopped
(`stoppedLabel(cause)` says what caused it) and Kolux's queued. Blocked and waiting borrow the
permission look (the question-mark glyph TERM-055 already gave the tab badge, amber). The pane
header (`headerOf` now returns the vocabulary entry plus `state`), the tab badge (`TabBadge`) and
the sidebar dot (`ProjectsPanel`) all draw from it; `StatusGlyph` in `icons.tsx` is the glyph set
(spinner, spinner with a centre dot for background, question mark, circle with a bar for
interrupted, circle with a cross for failed, check, hollow circle for idle, dotted circle for no
recent update). A shell keeps its neutral words (Ready, Ended (code)) over the idle and stopped
entries (TERM-020). Every `Spinner` turns 12 frames a second (`.spin`, `steps(12)`) and joins the
document's clock at time zero on mount, so all spinners on screen step together; under
`prefers-reduced-motion: reduce` the stylesheet stops it and the glyph still reads as working.
`src/chrome/Tip.tsx` is one tooltip for the window: any element with `data-tip` explains itself
about 200 ms after the pointer settles, kept inside the window edge; the status glyph, the status
word, the tab badge and the sidebar dot carry it. Proved on the lane app with hook events through
the real script: the header glyph, the tab badge and the sidebar dot each showed their explanation
on hover (`evidence/T-026-b-working.png`, `-tab-badge.png`, `-sidebar-dot.png`); the pane moved
working → needs you → done with the glyph and text changing each time (`-needs-you.png`,
`-done.png`); both spinners on screen reported `startTime 0`, `steps(12)`, `1s`; with reduced
motion emulated over the debugging port the animation read `none` and the word stayed Working
(`-reduced-motion.png`). Not lit yet: the `background` entry (the hooks fold background work into
working until T-123 reports it), `stale` (needs a surface that knows the last update time: the
Inbox, T-026-c, or the Agents view) and the Agents view's own labels (that view is later; it reads
the same table).

[core] T-026-c (STAT-050 Inbox): the bell in the top bar (labelled Notifications) and the
`view.inbox` shortcut (unbound, as COMPAT says) open the Inbox, a top-level screen of its own
beside the Agents / Board / Terminals switcher. `src/inbox/inbox.ts` builds it from the panes the
window already tracks (each pane's hook state, whether its program is up, and a stamp of when its
state last moved, now kept in `App.tsx`): needs you holds permissions ("Permission"), questions
("Question", a waiting state) and blocked agents, newest first; waiting on agent holds running
sessions; done today holds finishes of the last 30 minutes, newest first, 20 at most, never an
interrupted turn. Up and Down walk the three groups in order (nothing selected: Down picks the
first row, Up the last; both ends stop; a vanished selection falls back to the first row), Enter
or the detail's button opens the pane in Terminals with its workspace selected; the all-clear
line shows when nothing needs you. The detail shows the agent, branch, workspace, the worktree's
changed-file count (through `scm_status`) and the turn's prompt (through `agent_history`).
Proved on the lane app: three Claude panes with no events gave the all-clear line over three
Running rows (`evidence/T-026-c-all-clear.png`); a permission request, an AskUserQuestion and a
finished turn through the real hook script gave two needs-you rows and one done-today row
(`-groups.png`); Down selected the first row and showed its detail (`-detail.png`); Up at the
top stayed, five Downs stopped at the last row, and Enter left the Inbox with that pane focused
(`-opened.png`). The 40-minute, 20-row and interrupted rules are unit-tested (`inbox.test.ts`).
Not built: line counts in the detail (no numstat command yet; the change count stands in), the
host line (every session is local today), stale rows under waiting on agent (no last-update time
yet, see T-026-b), and the Code view the card's buttons name (DT-C8: Open / Answer go to the
terminal pane until that view exists).

[core] T-027 (STAT-053 Thought rows): deferred, not built. The rows live in a transcript on the
Agents screen; the repo has no transcript reader (T-325), no chat rendering of reasoning
(T-326, whose card says its folded reasoning rows are these Thought rows) and no Agents screen
(T-050). Building the fold on its own would be a component nothing renders, so the rules moved
onto the T-326 line and T-027 stays unticked with a note.

[core] T-028-a (VIEW-016 one line per session, VIEW-023 Board lanes and chips, VIEW-025 approve
or deny from a card): `src/board/chip.ts` is the pure model: from a pane's hook state, whether
its program is up, the STAT-045 quiet flag, the last turn's tool / detail / reply / newest file
written and the stamp of when the state last moved, it gives a lane, a word and one line (a
permission reads Needs you with "Tool: detail" and offers the answer; a question reads Needs
you; working reads Working with how long and the step; a quiet working pane reads No recent
update, never Working; a limit or sign-in stop reads Stopped with the cause, never Done; a finish
reads Done with the first line of the last message and the newest file written; an ended
program reads Stopped / Exited; no process yet reads Starting; a plain shell has no chip; with no
evidence the line is empty). The Board is now a CSS grid whose columns are the lanes that have a
card (Needs you, Working, Done, Stopped, Idle, in that order), each card carries a chip row under
its header, and the file link shows the file's name with the full path as its tooltip. Approve
and Deny call the new `agent_answer` command, which types the agent's own answer keys into its
terminal (Claude: Enter for the highlighted Yes, Esc for No; Codex: y / n from its public keymap)
and clears the pending permission, so the card leaves needs you at once. `PostToolUse` for
Claude's Write / Edit / MultiEdit / NotebookEdit now carries the file path (`Change.wrote`).
Proved on the lane app with the real hook script: a permission ask, two edits plus a finish, and
a failed stop gave four lanes with "Needs you · Write: C:/x/hello.txt · Approve Deny", "Done ·
All three tests pass. · b.ts" (full path in the tooltip) and "Stopped · rate limit reached"
(`evidence/T-028-a-board.png`); Approve moved the first card to Working with no buttons
(`-approved.png`); a Bash ask on the done pane came back as Needs you (`-deny-ask.png`) and Deny
moved it to Working (`-denied.png`); after the one-minute scratch quiet window the approved pane
read "No recent update · 2m without output". Unit tests in `chip.test.ts` cover the word and lane
rules, `status.rs` the answer keys and the cleared permission, `hooks.rs` the written file.
Not built: the Setup needed (chooser) and Can't reach (remote) chips, a real file opener (text
with the full path until the editor lands), Codex write-tool names for the file link (only
Claude's are known), and the Agents-screen words of T-028-b. The Claude answer keys are not yet
proved against a live prompt (no Claude prompt is typed in a build pass); the real-session proof
is for Txais, like the hook installs.

[core] T-029 (VIEW-040 palette row marks and ages) and T-030 (ORCH-007 mail pointer, ORCH-015
done reports and heartbeats, ORCH-020 worker-show, ORCH-021 worker-read): deferred, not built.
The palette (T-098) does not exist, and the orchestration store (Runs, mail, dispatches: T-082,
T-083, T-089 on the orchestration lane) and the transcript reader (T-325) do not exist in this
checkout; `cli.rs` only checks worker-start's flags. Both lines stay unticked with a note on
what they wait for.

[accounts] Secrets are sealed on disk (T-038): the Claude 1-year key and the xAI key live in
settings.json only as Windows-sealed values (DPAPI, this user only), the window never receives
them and cannot overwrite them, and a vault folder in the profile holds one sealed file per
managed sign-in. About two seconds after the first window, a one-off pass seals anything still in
the clear from an older profile (it never delays the launch, leaves a value as it was if sealing
fails, and moves an unopenable sealed file aside instead of deleting it) and limits the profile
folder to the current user; it writes to `logs\kolux.log` in the profile. No screen sets a key
yet; the Connect cards come with T-043.

[accounts] The Codex half of the top-bar usage pill is real (T-042-a): shortly after the window
opens, and every 10 minutes, Kolux checks for a Codex sign-in (the account's own Codex home, then
`CODEX_HOME`, then `~\.codex`), starts nothing when there is none, and otherwise asks Codex's
background app server, in a hidden process that only reads and is closed afterwards, for the
plan figures. The pill reads "Codex 100% left" (weekly figure); hovering lists the 5-hour and
weekly figures each with its own reset time, the limit-reset credits and the plan. A sign-in
Codex no longer accepts turns it into a yellow "Codex · sign in again" with no figures. The
Claude half reads "Claude N% left" from Claude Code's own status-line reports once a Claude
pane has produced one (T-039-b, [core]); until then it reads "unknown". Board cards carry a
compact meter (context bar in tokens plus the agent's 5-hour and weekly plan percentages), agent
tabs a tiny context ring, and the pane header's gauge fills and turns yellow at 70% and red past
90% (T-040-a, [core]). Claude and Codex panes start held to a 200k context window unless
Settings > Agents switches the cap off, and the top-right pill is a read-only weekly figure per
provider, tinted by use, hidden until a weekly figure is known (T-041-a, [core]). With the
Claude card's resume switch on, a Claude pane stopped on a usage limit gets a continue prompt
typed in a minute after the limit resets (T-041-b, [core]). Codex's figures come from the
background app-server read only; the usage service and the hidden `/status` screen are not
built (DT-C15, T-042-b, [core]).

[accounts] Settings exists with its first page, AI connections (T-043-a): click the usage pill in
the top bar or press Ctrl+Comma; Esc or the × closes it, and the panes underneath stay as they
were. The Claude card connects on a key that lasts a year: Connect runs Claude Code's own
long-lived-key setup out of sight (no console window, never through the command prompt), shows
"Finish in the browser" with Cancel while Claude's page is open, picks the key out of the
setup's output, keeps it sealed with the date it was made, and turns the card to "Connected ·
1-year key, Renew in <month year>". From 30 days before the year is up the card warns with the
days left and offers Renew; past it, it reads "ran out". A second Connect while one is running is
turned down, the setup gives up after 10 minutes, and a launcher Kolux cannot start directly puts
the card in needs attention. Every new Claude pane is handed the key through
CLAUDE_CODE_OAUTH_TOKEN while key mode is on (its /status reads "Auth token:
CLAUDE_CODE_OAUTH_TOKEN"). Disconnect forgets the key. Managed Claude accounts and the Codex
sign-ins come with T-043-b / T-043-c.

[accounts] Settings > AI connections lists managed Claude accounts (T-043-b): Add Account, or "Use
my Claude account instead" on the Claude card, runs Claude Code's own browser sign-in out of sight
into a private Claude folder for that account and shows "Finish signing in in the browser." with
Cancel. When the sign-in is done the account is listed with its email and organisation (read from
Claude Code's own status), and its sign-in is kept sealed in the vault as well. Cancel, or a
sign-in that quits early, keeps nothing partial; "Sign in again" that fails puts the earlier
sign-in back and says why in yellow. Make active picks the account new Claude panes run on (they
get that folder as CLAUDE_CONFIG_DIR); while the 1-year key is connected the key still wins, and
the section says so. Kolux does not renew these sign-ins itself: Claude Code keeps them fresh in
its own panes (the ACCT-006 default under OD-01). The section's "Leave sign-in upkeep to Claude
Code" switch (T-043-d, [core]) is on by default; off, Kolux asks Claude Code at once whether the
active account is still signed in and flags a lapsed one with a Needs sign-in chip and the
main-window notice, on hides both. Kolux never renews a sign-in itself (DT-C16); the macOS
keychain rules are T-043-e.

[accounts] The Codex card on Settings > AI connections connects Codex (T-043-c): Connect runs
Codex's own browser sign-in out of sight, and "Sign in with a code" shows a link and a one-time
code to enter on this or any other device (the view waits until it has both). Each account Kolux
adds lives in a private Codex home of its own (\codex-accounts\<id> in the profile), so the
user's own \.codex folder is never touched (checked file by file). The newest account becomes the
active one; others can be made active, and new Codex panes and the top-bar Codex figures run on
the active account. With no managed account the card reports Codex's own login as it is: a ChatGPT
sign-in, an API key, an API key with a custom provider, or not connected. Cancel or a failed
sign-in adds nothing and removes the half-made home, but never a home that already holds a
working sign-in; the reason shows with links and codes removed.

[accounts] A lapsed sign-in now shows in the main window, not only in Settings (T-044): a bar
across the top says "Claude account sam@example.com is no longer signed in." (or the Codex
account) with Sign in again, which runs the same hidden sign-in as Settings and clears the bar
when it works. Kolux asks Claude Code once at start whether the active account is still signed
in, but only while Kolux, not Claude Code, looks after sign-ins; under the default (Claude Code
looks after them) the Claude half never shows. A Codex account is flagged when its usage read
says to sign in again. Every needs-attention card in Settings now names one reason and offers
the one fix that fits: Try again (browser blocked, sign-in refused), Check again (plan not
covered, Claude not found), Open install page (Windows blocked it, no installer here), Renew
(key running out or expired), Try installing again (install failed), and no button for a usage
limit, which says when it can be used again. Nothing yet produces the install-failed and
SmartScreen reasons; the install flows will.

[accounts] Settings > AI connections now says whether each sign-in is ready (T-045). With no
1-year key and no managed Claude account, the Claude card reports Claude Code's own sign-in on
this PC ("New Claude panes use Claude Code's own sign-in on this PC (email)"), and warns in
yellow when Claude Code is signed out, so a sign-out from Claude's own command line shows the
next time Settings opens. Managed Claude accounts that lapsed and Codex accounts with a sign-in
error say "Needs sign-in"; a Codex account whose settings file was changed away from what Kolux
wrote says "Settings changed" with Sign in again, which puts Kolux's settings back. A Codex that
refuses the command Kolux starts it with is reported as such ("update Codex"), never as a sign-in
problem. The Claude card has a "Carry on by itself once a usage limit resets" switch: off unless
turned on, kept across restarts; it only stores the choice until the resume itself (T-041) lands.

[accounts] Settings has an Appearance page (T-053): Classic plus 16 coloured themes, with tint,
saturation and depth sliders (greyed out on Classic) and a small preview, and a Terminal colours
picker with "Match app theme". Every change shows on the whole window at once and is kept. The
window now starts hidden and appears only once it already wears the saved theme, so the white
flash before the interface loads is gone too.

[accounts] Settings now has its ten pages (General, Appearance, Accounts & keys, Agents, Terminal &
sessions, Git & worktrees, Safety, Notifications, Shortcuts, Usage) plus one small page per
repository, and opens on the page used last (T-054). Appearance has a Mode switch: System (the
default, follows Windows while the app runs), Light or Dark, and terminals turn light with the
app unless that is switched off. General has the Classic or New look and the screen that opens
first; under Classic the Agents / Board / Terminals switcher is gone and the window stays on
Terminals. Pages with nothing built yet say so.

[accounts] Closing a tab whose program is still running now asks first (T-057): "Close
“Terminal 1”? A program is still running in it.", with Cancel and Close tab. An idle shell closes
at once. The tab's x, the pane's close button and Ctrl+W all ask the same way, and Settings >
Terminal & sessions has a switch to turn the question off.

[accounts] Deleting a workspace now looks first (T-055): the question lists the uncommitted and
untracked files that would be lost, and Remove refuses unless "Delete my changes too" is ticked.
A locked workspace, or one holding another workspace's folder, cannot be deleted from Kolux at all,
and if the workspace changed while the question was open the delete is refused and the question
shows it as it is now. Ctrl+Shift+Backspace asks to delete the workspace row under the pointer, else the workspace shown. Settings > Git &
worktrees can switch the question off for clean workspaces. After a delete the window moves to
the workspace in the same project used last, and the list keeps its scroll position.

[accounts] Settings > Agents is built (T-036). It lists the agents found on this PC, each with an
on/off switch; switched-off agents leave the New tab and New session menus. The default agent
can be set to Auto (the first one available); switching the default off leaves Auto, and a
saved default that is not installed right now keeps its name with "(saved, not found right now)".
Agent Permissions picks Yolo (agents skip their permission prompts where they have a switch for
it: Claude Code in its automatic mode, Codex without approvals) or Manual. Under "How it starts"
each agent shows the exact line it starts with and takes its own command, default arguments and
environment variables; Refresh looks for agents again.

[accounts] The Resource Manager is built (T-037). Clicking the memory figure in the status bar
opens it: the computer's free memory, Kolux itself (the app and its WebView), and every terminal
session with its memory and CPU, grouped under the workspace it runs in, with terminals outside
any workspace under "No worktree" and a session no pane shows named as such. End asks in the row
first and stops only that session. Figures refresh every two seconds while it is open.

T-090 brings updates (APP-024..027). An installed copy checks the TxaisX/kolux-rs-releases
feed quietly at start-up (only if the last check is over 30 minutes old, else it waits out the
rest) and every 30 minutes after, merges focus checks, retries a failed check after an hour
doubling to six, stays silent offline and checks 5 s after the connection returns, checks after
the PC wakes, and drops a check that stalls. A found update downloads by itself and must carry a
valid signature; a small "Kolux RS <version> is ready" pop-up with Restart to update then shows
bottom-left once per version per launch, and if ignored the update installs when the app quits.
The sidebar footer's "Check for updates" opens the update card: checking, up to date (fades),
available, downloading with a progress bar, ready, or a plain-worded error with a next step;
Escape collapses it, Enter runs its main action, a dismissed version stays away, the release
notes (from the manifest, headings removed, six lines at most) stay through every phase, and a
first-time tip says terminal sessions keep running. Dev copies only update with the two
`KOLUX_RS_UPDATE_*` variables set; a real release needs T-091's signing key in RELEASE_PUBKEY.

T-091 brings shipping and releases (APP-058..060). `pnpm ship` commits a worktree's changes with a
one-line message written by `claude -p` (haiku unless `--model` says otherwise, or the user's own
`--message`), merges the remote in (never a rebase; a conflict undoes the merge and stops with
nothing pushed), pushes, and with `--main` lands the branch on main and starts the release job in
the background, printing its log path; `--no-release`, `--merge <branch>` and `--dry-run` work.
`pnpm release` builds in its own checkout (`~/.kolux-rs/release-checkout`), one build at a time with
one queued rebuild from the newest main, version one patch above the project or the newest
release, signed NSIS installer + `.sig` + `latest.json` + notes (30 subjects and a hidden source
marker, so a released main is skipped), smoke-tested so installer, manifest and
`kolux-dev --version` agree. CI (`.github/workflows/ci.yml`) runs four shards and one result job;
`release.yml` waits up to 30 minutes for green CI on that commit and writes any refusal to the
job summary; `node scripts/workflow-check.mjs` validates both. Nothing is published until Txais
makes the real signing key and the TxaisX/kolux-rs-releases repository (see Decisions below).

T-093-a brings the editor (EDIT-001). New tab > File... picks a file and opens it as a tab beside the
focused pane, in CodeMirror 6 with its language's colours; typing puts an unsaved dot on the tab and
header, Mod+S writes it (atomically, keeping the file's own line ends) while the terminals screen is
up, and a failed save says why in a toast. Two cells showing one file edit one text. T-093-b..d
(markdown, diff tab, All Changes) are still open.

T-093-b brings markdown (EDIT-012). A .md file opens in a rich, document-style view with a Rich | Source
switch; typing in either view edits one text, so Mod+S and the unsaved dot work the same. Mod+Shift+V
opens a read-only Preview tab, Mod+Shift+O picks one of the worktree's markdown files, and
Mod+Shift+M starts untitled.md. Big files (over 600 KB) and files with tables, images or HTML open in
source with a banner that says why.

T-093-c brings the diff tab (EDIT-027). New tab > Changed file diff... lists the worktree's changed
files; picking one opens its diff inline, with a switch to side by side, F7 / Shift+F7 to step
through changes, and a ... menu for whitespace changes and wrapping. An unstaged diff can be edited
and saved; the diff follows edits made in a terminal within two seconds.

T-093-d brings All Changes (EDIT-029). New tab > All Changes shows every changed file of the
workspace in one scroll, loading each as it comes into view. The Files button opens a side list to
filter, jump and tick files off as viewed; large files wait for a click, images show before and after.

T-094-a brings the explorer (EDIT-033). Ctrl+Shift+E, or the right-panel button in the top bar,
opens the worktree's files on the right; walk it with the arrow keys or the mouse and open a file with
Enter or a click. Creating, renaming and deleting files from it come next (T-094-b).

T-094-b adds file operations to the explorer (EDIT-034, part 1). The + and folder buttons in its header
make a file or folder, F2 renames, Delete moves the selection to the Recycle Bin after one question, and
Ctrl+Z / Ctrl+Y undo and redo those steps. Alt+Shift+C copies a file's path. Copy, drag to move and
dropping files in from the desktop come next (T-094-b2).

T-094-b2 finishes the explorer's file operations (EDIT-034). Ctrl+C then Ctrl+V copies files into the
highlighted folder without overwriting anything, dragging rows moves them into another folder (the tree
scrolls when you hold near its top or bottom), and files or folders dragged in from the desktop are copied
where you let go. Ctrl+Z undoes each of these.

T-094-c adds Quick Open (EDIT-036). Ctrl+P lists the worktree's files, best name matches first; hovering a
result shows its full path beside the pointer, and Enter opens it. It needs ripgrep (winget install
BurntSushi.ripgrep.MSVC); without it the dialog says so and falls back to git's file list.

T-095-a adds the Artifacts page (SKILL-036, VIEW-012). The sidebar's Artifacts button opens a searchable list of
saved web pages beside a viewer. Add artifact copies a page and its pictures into Kolux so it opens offline;
links inside a page open in the system browser. Automatic capture of pages Claude publishes is T-095-b.

T-095-b fills the Artifacts page by itself (SKILL-035). Every page a Claude Code session publishes with
the Artifact tool lands there within a couple of seconds, labelled with its project and session, and opens
offline, scripts from the usual CDNs included. Publishing the same page again updates its one entry.

T-097 adds `kolux-dev open` (CLI-011, APP-056): it starts Kolux, or brings its window to the front if it is
already open or minimised, and returns once the app takes commands, so scripts can run `open` and then
any other command. If the app never answers it gives up after 60 s with an error.
[accounts] Two look bugs are fixed (T-037-fix-look). The top bar's Agents / Board / Terminals
switcher no longer covers the search box at the default window size: it stays centred while
both sides fit and moves aside when the right-hand group is wider; below 1100 px the search box
keeps only its icon so the window controls stay on screen down to the 900 px minimum. In a
small pane (the 4- and 6-pane layouts) a chooser's Start button now sits in a footer below the
scrolling choices, so after picking Terminal the button is in view; before, it was below the
pane's edge and the pick looked like it did nothing.

[accounts] The launch screen warns before starting on a nearly spent account (T-135). When a
provider the chosen seats use has used 80 % or more of its usage window, a line above Start says
so: "Claude has used 85% of its 5-hour window, resets today 9:05 PM. These 3 Claude sessions
may stop early." One line per provider, the agent named for one seat and a count for several;
Start stays usable. Codex figures come from the top-bar pill's own reading; Claude has none
until T-041 reads them, so no Claude line shows yet.

[accounts] Usage alerts (T-136-a). When an account reaches 80 % of a usage window, and again at
95 %, Windows shows a notification: "Codex · usage alert. Codex has used 82% of its 5-hour
window (the 80% alert), resets today 11:03 PM." Each alert comes once per window and again only
after that window resets, and a restart does not repeat it. Settings > Notifications has the
switch (on by default). Codex figures drive it today; Claude's arrive with T-041.

[accounts] Accounts lists (T-138). Settings > Accounts & keys shows a System default row first in both the Claude accounts and the Codex lists, then each managed account with its email (and organisation for Claude) and when it last signed in. Clicking a row makes it the account new panes use; panes already running keep theirs. Stale rows say Needs re-auth; a Codex account whose sign-in file has been gone for 30 seconds says Needs sign-in. Remove asks first in the row itself, deletes the account's own folder (retrying while Windows holds it) and hands back to the system default when it was the active one. Adding a Claude account that is already listed (same email in any letter case and the same organisation) adds nothing and says so; one email in two organisations is two rows. Adding a ChatGPT Codex account is refused while the user's own Codex settings name a custom model provider. The Codex System default row says Signed in with ChatGPT / Running on an API key / ... with a custom provider / Signed out, re-read whenever Kolux gets focus.

[accounts] Model step (T-139-a). The session chooser offers a model list only for Claude, Codex, Grok, Gemini and Cursor (each with Program default as an explicit pick); any other agent, like Aider, skips the model step and its seat is ready as soon as the AI is chosen.

[accounts] Account commands (T-141). `kolux-dev account add` runs Claude Code's own login (or, with `--agent codex`, Codex's device-code login) right in the terminal and the account then shows in Settings > Accounts; `kolux-dev account list` prints the Claude and Codex accounts with the one new panes use marked (`--json` for both). Nothing starts when Kolux is not running; Ctrl+C part-way through leaves no credentials behind.

[accounts] Terminals now use a proper light colour scheme in light mode (T-145-a): the Tango
palette on white, while dark mode keeps Kolux's own dark colours, and Match app theme still
follows the app. The terminal pane also knows how to answer programs that ask for its colours
or for light/dark mode, and tells subscribed programs when the mode flips, but on Windows those
questions are swallowed before they reach the pane, so that part is not live yet (T-145-b).

[accounts] The status bar can be trimmed (T-147): right-click it to tick or untick Agent status,
Resource Manager, Terminals running and Agents running, or to hide the whole bar; the choice is kept
across restarts, and Settings > Appearance > Show status bar brings a hidden bar back. A right-click
inside the Resource Manager popover stays with the popover.

[accounts] Terminal colour schemes (T-148-a): Settings > Appearance > Terminal colours now has a
search box and two scheme lists, one for dark mode and one for light mode, each row showing the
scheme's ground and four colours. Eleven well-known schemes ship (Tango, Campbell, Solarized,
Dracula, Nord, Gruvbox, One Half), and a scheme copied out of Windows Terminal can be pasted in;
a bad paste says why. Removing a scheme that is in use falls back to the default.

[accounts] Appearance in three foldable sections, with font pickers (T-148-b): Settings > Appearance
now has Interface, Terminal and Window & Sidebar, all open at first; a folded one shows a one-line
summary (for Terminal: the font and the dark / light schemes). A link to a setting in a folded section
opens just that section. Interface gains App font and Editor font fields that suggest the fonts
installed on this PC as you type; a font that is not installed still draws text in the default.

[accounts] Window & Sidebar switches (T-148-c): Settings > Appearance > Window & Sidebar can show the
app name beside the mark, and hide the sidebar's Tasks row, its Automations button, the status bar,
or single status bar items. Changes show at once; the status bar's right-click menu and the
Settings ticks always agree. The app name starts off and Automations starts on (DT-A6).

[accounts] Pane dividers and dim (T-148-d): Settings > Appearance > Terminal > Panes sets the gap
between panes (2 to 12 px), a divider colour for dark mode and one for light mode, and how far panes
not in focus fade. Moving focus fades the pane left behind over about 140 ms. Defaults keep the
measured look: 6 px, no colour, no dim (DT-A7).

[accounts] Agent dropdown (T-143): the New session menu, from the sidebar or a pane's plus, leads
with Claude Code, Codex and Grok; other installed agents fold behind "Show more agents", folded
again each time it opens. A search box reaches any installed agent (aid finds Aider), typing shell
or terminal offers a blank terminal, Enter takes the top row, and "Manage agents" opens Settings > Agents.

[accounts] Settings > Shortcuts now lists all 127 commands grouped by area (General, Tabs, Terminal,
Browser, Editor, File explorer, Settings) with their keys and Modified, Unassigned, Disabled and
Conflicts badges (T-096-a). Filters for all, modified, unassigned and conflicting sit beside a search
box that finds titles, areas, ids, extra words (cls finds Clear active pane) and keys however they
are written (Mod+K, Ctrl + K, Cmd+K). When two commands share a chord, both rows say so and name the
other command; switched-off agents' new-tab commands never count. Recording keys is T-096-b.

[accounts] Shortcuts can now be changed from Settings > Shortcuts (T-096-b): click a command's keys
and press new ones, Add a second shortcut, remove one with x, Disable or Reset. Esc stops recording
and keeps what was there; Shift alone or a bare key is refused with a note. Each change is written
straight into the Windows section of ~/.kolux/keybindings.json, leaving the rest of the file as it
was, and every open window picks it up. A shortcut that clashes shows Conflicts on both rows with a
Reset button on the one that caused it. Double-tapping a modifier and the app menu refresh are later (T-246, T-248).

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

- 2026-10-09 · [release] T-090 · Updates use Kolux RS's own feed (OD-20) with Tauri's signed JSON manifest; release notes ride in the manifest; the updater uses the system TLS stack (native-tls) because the default rustls build pulls a CDLA-Permissive-2.0 certificate bundle cargo-deny rejects; card and pop-up sit bottom-left above "Next that needs you"; timings and the dismissed-version rule as DECISIONS.md DT-R01..DT-R06.
- 2026-10-09 · [release] T-091 · Releases carry installer, .sig and latest.json (no block map); ship messages come from claude -p with haiku by default; the version is set only in the release checkout, never committed; --main lands by a fast-forward push of HEAD to main; the GitHub publish runs only for a GitHub origin or inside Actions, rehearsals publish to a folder; CI shard split as DECISIONS.md DT-R07..DT-R12. For Txais, once, before the first real release: run pnpm tauri signer generate -w ~/.kolux-rs/release-signing/kolux-rs.key and back the key up, create the public TxaisX/kolux-rs-releases repository, and add the secrets KOLUX_RELEASE_KEY, KOLUX_RELEASE_PUBKEY, KOLUX_RELEASE_KEY_PASSWORD and KOLUX_RELEASES_TOKEN to the main repository.
- 2026-10-09 · [release] T-093-a · Until the explorer (T-094) exists, files open from a File... item in the New tab menu through Windows' Open dialog; the editor is CodeMirror 6 (MIT), not Monaco, because it is small and its packages are MIT; a file that is not UTF-8 text does not open (the reason and Retry show) rather than being guessed at; the read-permission acceptance check moves to T-094 because Windows' dialog refuses an unreadable file itself (DT-R13).
- 2026-10-09 · [release] T-093-b · The rich markdown view is Lexical (MIT) using its own markdown import and export, not ProseMirror with markdown-it (markdown-it needs argparse, whose Python-2.0 licence the build brief does not allow); the first edit in rich view rewrites the file in Lexical's markdown spelling (for example a blank line between a bullet list and a task list) while every word is kept; files with tables, images, HTML, front matter, reference links, footnotes, horizontal rules or underlined headings stay in source with the reason, because Lexical's markdown support has no place for them; the preview is rendered with marked and cleaned with DOMPurify, and its links do nothing when clicked; Mod+Shift+M already creates the untitled notes, while naming a note on its first save stays with T-237 (DT-R14).
- 2026-10-09 · [release] T-093-c · In a diff tab, Show whitespace changes off (the default) hides changes made only of spaces, tabs or line breaks rather than drawing space marks; the diff refreshes by reading git every 2 s while its tab is in front, since there is no git status watcher yet; until Source Control and kolux file diff exist, diffs open from a Changed file diff... item in the New tab menu (DT-R15).
- 2026-10-09 · [release] T-093-d · In All Changes a section over 2000 changed lines waits for a click, text sections stop at 560 px, changes are read every 2 s while the tab is in front, and a viewed tick clears when that file changes again; the tab opens from New tab > All Changes until Source Control and kolux file exist (DT-R16).
- 2026-10-09 · [release] T-094-a · The explorer is a 280 px card on the right of the Terminals screen, closed at start, folders first then plain alphabetical order; Ctrl+Shift+E opens it into the tree and pressed in the tree hides it (DT-R17).
- 2026-10-09 · [release] T-094-b · New file and New folder sit in the explorer header, F2 renames inline, Delete asks once inside the explorer; undo of a create sends it to the trash; undo history lives only while the app runs; copy path writes the clipboard from the app side (DT-R18).
- 2026-10-09 · [release] T-094-b2 · Mod+C / Mod+V copy into the highlighted folder, with no cut; a taken name becomes "name copy"; drags and desktop drops land in the folder under the pointer, a file row meaning its folder and empty space the root; drags use pointer events (DT-R19).
- 2026-10-09 · [release] T-094-c · Quick Open ranks name-prefix, name, letters-in-name, folder, letters-in-path; 50 results, list capped at 200,000; the markdown and changed-file pickers rank and show paths the same way (DT-R20).
- 2026-10-09 · [release] T-095-a · Artifacts are stored per page path under the app data folder with capped assets from the page's own folder; the viewer is a sandboxed frame on a kolux-artifact scheme limited to the entry's files; outside links go to the system browser (DT-R21).
- 2026-10-09 · [release] T-095-b · Claude publishes are read from session transcripts only, from each file's end at start, with publishes over 60 s older than start ignored as replay; one entry per URL, newest wins; CDN scripts from Claude's own allow-list are stored offline; paths this machine cannot read are remote (DT-R22).
- 2026-10-09 · [release] T-097 · kolux open asks a running app to come forward first and starts the app beside the command only when none answers, then waits up to 60 s; KOLUX_USER_DATA_PATH and KOLUX_APP_EXECUTABLE override where it looks and what it starts (DT-R23).
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
- 2026-10-09 · T-024: the notification is an in-window note until T-026 brings the desktop one
  and the settings that gate it. A plain shell's exit does not mark anything (only an agent's
  finish and any terminal bell do). The workspace row's unread mark now lives in the window
  (`App.tsx`) with the pane marks, so viewing the marked pane clears the row too; the sidebar's
  own state-change rule and the hand toggle (T-022) feed the same set. "In view" means the tab
  on top of a cell in the workspace in front (every pane on the Board); a visible split pane that
  is not focused counts as viewed, so it only glows (T-023) and is not marked.
- 2026-10-09 · T-023: a stopped agent ("Ended (code)", non-zero exit) is not Done and does not
  glow; only a clean exit reads Done with its age. The pane's finish time is its own clock read
  at the exit event (the sidebar's `changed` is read at the same event in the window; the two
  differ by milliseconds), so no shared store is kept until the Board needs one. A failed start
  counts as "needs you" in `status.ts`, but the window already drops a failed pane with a
  toast, so the next-that-needs-you cycle has nothing to visit until the hooks feed it.
- 2026-10-09 · T-022: with no status hooks yet (STAT-001, T-025) a row's state is read from
  the pane's program: a shell is idle, an agent is working until its program ends, then done;
  permission, blocked, waiting, interrupted and queued are typed and ranked now so the hooks only
  have to fill them in. The pull-request state is typed (`pr` on each row, null today) and the
  grouping is proved in tests only until GIT-025 (T-229) feeds it. The "Recent" sort is not kept
  as a choice: an old `workspaceSort: "recent"` is saved back as "smart" on first load, as the
  card asks. Unread marks live in the window only (not saved); a restart clears them.
- 2026-10-09 · T-021: the parent is recorded as the worktree's path (the store key the names use),
  not an id, since worktrees have no id of their own yet; the main checkout counts as a parent
  when the call is made from it (the card says "the worktree the command was called from" and
  the sidebar already groups the rest under main), and a call from outside every worktree (a
  plain shell with `--repo`) records no parent rather than failing. `--parent-worktree` must be
  in the same project; another project's worktree is refused. The calling terminal is recorded
  as its folder for now: the terminal handle and pane key the CLI will read from its environment
  are CLI-007's (T-088, in the orchestration lane; its line now names the hand-off), and the
  folder-workspace parent is PROJ-086's (T-218). `--issue` is validated as a number only; the
  lookup is PROJ-037's (T-107). `--setup` values are still only echoed (PROJ-033, T-107).
- 2026-10-09 · T-020: the saved folder wins over `KOLUX_WORKSPACES_DIR`, which only moves the
  default (PROJ-026's acceptance says "no folder setting"); so with a folder saved the variable
  does nothing, and the field says where its value comes from only while the variable supplies it.
  A save makes the folder right away (`create_dir_all`) so that a bad folder is a failure the user
  can retry rather than a later failed create; a relative folder is only saved, since it counts
  from each project root. The blur retry is "differs from the saved folder", which is the same as
  "equals the last failed attempt" because a successful save puts the saved value in the field.
  Save and Browse… keep the field's focus on mousedown, so a click never saves twice. Hidden
  worktrees by origin (made by Claude Code, GSD, elsewhere, extra roots) are not built here: they
  are PROJ-042/PROJ-044's rules and go with T-108, whose line now names them.
- 2026-10-09 · T-019: shared folders are junctions on Windows, not symlinks: a symlink needs a
  privilege most accounts lack and git treats it as a file, so a `node_modules/` ignore line
  would not match it and the new worktree would start dirty (seen in the test); a junction
  needs nothing and git sees a folder. `git worktree remove --force` leaves a junction (and so
  the folder) in place, so the links are removed first, which also keeps the shared folders
  safe. A folder-only ignore pattern is checked with a trailing slash so it matches before the
  folder exists in the main checkout. "Ignored" is `git check-ignore`, so a tracked file named
  in the include file is skipped rather than copied over. The kolux.yaml shared list is read by
  a small line scanner (block list or inline list under `worktree:`), not a YAML parser; the
  rest of the file is PROJ-034 (T-149). The pre-rename twin of kolux.yaml (COMPAT.md 5.6, HID-037)
  is not read: its name is not in the clean-room sources and HID-037 is retired, default skip;
  Txais names the file if he wants it read. The include-file copy budget and interrupted-copy
  warning are PROJ-032's (T-106). The dirty check is the removal's own refusal, so the sidebar
  form asks twice only when there is something to lose; the CLI keeps its `--force` flow and
  passes force on. The one-at-a-time rule is a per-repository mutex keyed by the main checkout's
  path; a poisoned lock is taken over, so a panic in one create never blocks the next.
- 2026-10-09 · T-018-b: "differs from its remote only by commits with identical patches" is read
  as `git cherry HEAD @{upstream}` marking every upstream-only commit `-`, checked only when the
  branch is behind, so the common path costs no extra git call. The base branch is
  `Git::default_branch` (origin's HEAD, else main / master, else the current branch); a repo
  whose origin was added by hand has no `origin/HEAD`, so its base reads as the local `main`
  until `git remote set-head origin -a`. Push, pull and sync use git's plain forms so the user's
  own pull policy applies; a diverged pull with no policy shows git's refusal (GIT-008, T-313).
  No push target is ever taken from the UI, so "a target that differs from the configured remote
  is rejected" holds by construction, as does "git only reaches remotes the user set up". The
  ten-minute "no repeating remote checks" acceptance holds by construction (status is local) and
  is proven in the Rust test with origin pointing nowhere: three status calls in well under a
  second, only an explicit fetch reports the trouble. The sync label shows the ↓ ↑ pair even when
  one side is 0. Create pull request, the wait while the PR check loads and the "PR already
  merged" reason go to T-228 (named in PLAN.md). Fix with AI's prompt now covers any failed
  action, not only a commit (GIT-009's push hand-off proper stays on T-227).
- 2026-10-09 · T-018-a: the stage card's batching rule is met by one git process fed
  NUL-separated paths on stdin (`--pathspec-from-file=- --pathspec-file-nul`, any count) rather
  than several argv batches; `--literal-pathspecs` so `[`, `*` and `?` in names match only
  themselves; untracked files are listed one by one (`--untracked-files=all`) so a new folder's
  files each get a row. "Blocked" means the commit failed while a pre-commit, prepare-commit-msg,
  commit-msg or pre-merge-commit hook file exists in the repo's hooks dir; anything else reads
  "failed". The right sidebar is a bare 320 px card holding only Source Control until
  VIEW-056/057 (T-146); Mod+L toggles it too. Ctrl+Enter also accepts Cmd. Section letters:
  U untracked, X unmerged. The multi-row bulk bar is built (T-018-c, [core]); the folder rows
  (stage everything beneath) went to T-033's tree view, named in PLAN.md. Status is polled every 4 s
  while the card is open until GIT-001's watcher. The draft lives in the window per worktree,
  not on disk. Evidence note: another lane's dev app was open during this pass, so `keys.ps1`
  (first window titled "Kolux RS") captured the wrong app once; the shots were retaken with a
  copy bound to this app's window handle. A `SendKeys` experiment typed "Add the docs folder"
  into whatever window was in front (Txais's Chrome, a YouTube tab) because `AppActivate` did
  not bring the app forward: never use `SendKeys`; `cdp.mjs type` / `key <name> <mods>` are the
  only typing paths.
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
  Shrinking never removes a started session: TERM-003's "ask first" is T-151 (the one owner,
  named in `grid.ts` and `App.tsx`), so for now a toast names the newest started session in the
  way (T-009-fix-b). Closing a pane whose program is still running ends it without asking; the
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

- [orchestration] T-082: terminal handles are `term-<n>` (the pane number); the pane key is a 128-bit secret made at spawn and forgotten when the pane closes. `--from <handle>` is accepted for any open Kolux terminal (the CLI token already limits callers to this machine and user); per-Run authority over another pane or Run (`check --terminal`, `--run`) is ORCH-033 (T-155). A terminal handle is its own mailbox (term:<handle>), read by that pane on check next to its Run and its active dispatch, so a handle can never be ambiguous between Runs. check --wait polls the app every half second from the command line (the app answers one request at a time) and defaults to 5 minutes without --timeout-ms; a timed-out wait is a success with `timedOut: true` (exit 0). `check --ack <id>` acknowledges and then returns the next batch. Group addresses (@all and the rest, ORCH-004) are refused as unsupported until T-190 (done reports and heartbeats are refused for groups outright, as the card says); the pointer typed into an idle pane is ORCH-007 (T-030). worker-start now stamps the calling Run on its dispatch so a worker that names no recipient writes to its Run; tasks scoped to a Run (task-list per Run, ORCH-011) come with T-083.

- [orchestration] T-083: dispatch refusals use fixed codes (not_found, task_waiting, task_taken, task_not_ready, own_pane, not_an_agent, busy) so scripts can match them. Kolux counts a pane as an agent only when Kolux started that agent program there and it has written output and then been quiet for 1 s; an agent typed into a plain shell is not counted. `--inject` types the brief as one bracketed paste followed by Enter. `inbox` is newest first, 20 by default, 200 at most, bodies cut at 120 characters. `--deps` must name tasks that already exist. Task text is capped at 4 MiB. Each hand-off is stamped with the running app's process so a pane number reused after a restart is not mistaken for the old worker. Handing a task to the coordinator's own pane inside the nesting budget waits for T-155 (ORCH-032). Marking a task finished from a live agent waits for task-update (ORCH-012, T-071); promotion of waiting tasks is covered by unit tests.

- [orchestration] T-084: brief commands carry no `--from`; the worker's own pane variables tie them to it. Without a Run, reports go to the coordinator's pane. Questions go out as `send --type question` plus `check --wait` until the ask command lands (ORCH-029, T-190); the dispatch pass joins the commands with ORCH-067 (T-155); the sub-worker section waits for the nesting budget (ORCH-032, T-155); the bare-shell "exit after reporting" line waits for terminal reuse in worker-start (T-089), since no worker today can be a bare shell. WSL workers do not exist yet, so the command is never a WSL path. Base drift is counted against the project's saved base, else its default branch, with no fetch. With a tier and no `--agent`, the worker runs on the agent Kolux started in the coordinator's pane, else the default agent; `--agent` with a tier is refused only when it differs from a known coordinator agent (a call from outside any agent pane may still name one). Seen live: a worker in a dev build ran the installed `kolux` because `kolux-dev` is not on PATH inside Kolux terminals; that is CLI-007 (T-088), and until it lands workers' reports from dev builds go nowhere useful.

- [orchestration] T-088: every terminal gets `KOLUX_APP_DIR` (a new name, next to the kept `KOLUX_TERMINAL_HANDLE` and `KOLUX_PANE_KEY`) naming the data folder of the app that opened it; the CLI prefers it over the installed app's folder, which is what lets a dev or lane build's workers reach their own app (the T-084 finding is fixed). The folder put first on PATH is the running app's own executable folder; in a development build that folder holds `kolux-dev.exe`, and the release launcher (`kolux.cmd`/`kolux.exe`, CLI-006) and the Linux `kolux` launcher folder come with T-185. `kolux status` (CLI-012, T-076) and `--version` (CLI-001, T-250) do not exist yet, so the live proof used `Get-Command kolux-dev` and `run-create`/`run-current` instead. Group addresses still wait for ORCH-004 (T-190) and `--dispatch-capability` for ORCH-067 (T-155); multi-line bodies on Windows need the native launcher (CLI-006, T-185).

- [orchestration] T-089 split: T-089-a (CLI-034, CLI-035) done; T-089-b (CLI-033 ask, CLI-036 worker list/show/read/stop/abandon/release/retain) waits for the ask flow (T-190), live worker state and transcripts (T-030), stop (T-071) and abandon (T-155). `task-update` waits for the task-state guards (ORCH-012, T-071). A reused terminal must already run an agent Kolux recognises, in the worktree named with `--worktree` (new worktrees are refused with `--terminal`); if the caller's pane runs a different agent, or `--agent` names one, it is refused. When `--spec` made a task and the hand-off then fails, the error names the task and the dispatch command that finishes it. Because a reused terminal must run the coordinator's agent and dispatch turns shells away, no worker can be a bare shell, so ORCH-014's "exit after reporting" line is not written anywhere. The pane key alone now identifies the caller (the handle in the environment is only a label). Structured chat sessions and older app versions (CLI-035's refusal and quiet-drop rules) do not exist in this build.

- [orchestration] T-106-a: new branches begin with the Git user name by default (`txais-xiong/fix-login`), as PROJ-022 says; earlier passes made the bare name. Setting fields `branchPrefix` ("user" when absent, "custom", "none") and `branchPrefixCustom`. A custom prefix Git refuses is a warning on create and the bare name is used (DT-O1, PROJ-022 amended). The control sits in the sidebar gear form until T-116 builds the Git & worktrees page.

- [orchestration] T-106-a: a workspace opened on an existing branch is marked `existingBranch` in its origin record and keeps that branch when removed, from the app and from `kolux worktree rm`; the remove confirmation now says the branch goes unless it already existed. The copy budget counts every file and folder under a listed path; over-budget entries are skipped whole.

- [orchestration] T-107-a: new worktrees are found by the sidebar's 5 s poll of Git's worktree list (DT-O2, PROJ-041 amended), not a folder watcher. The first look at a project takes everything already there as seen, so adding a project never shows a notice; a worktree removed and made again counts as new. Hidden worktrees are remembered per folder in the setting `worktreesHidden`; T-108-a adds the per-source defaults.

- [orchestration] T-108-a: "existing projects keep their earlier behaviour" (PROJ-042) is read as: the first time the visibility choices are used, every project already in Kolux gets its own choice "elsewhere on disk: shown" (what it showed before), and projects added afterwards follow the global default, which starts hidden for every source. Changing a global default then never touches a project that has its own choice; Reset puts a project back on the global one. Claude Code's `.claude/worktrees` folder is a source of its own (hidden by default, as before); other dot-folders inside the main checkout stay unlisted scratch, unless the workspaces folder the user chose is there.

- [orchestration] T-108-a: a worktree counts as Kolux's own when Kolux has a record of making it (app, CLI or open-existing-branch); workspaces made by earlier builds before this record existed show as external. Its only visible effect today is the "external" tag and the visibility rules; the global defaults sit in the sidebar gear form until T-116 builds the Git & worktrees page. The failed-to-save error ("could not save the visibility choice: ...") was not forced live.

- [orchestration] T-108-b for Txais: GSD's worktree folder is not in any public doc I could find, so worktrees GSD makes count as "elsewhere on disk" until someone names the folder.

- [orchestration] T-109-a: "Recent" in the composer's project list is read as the projects the composer last made a workspace in (up to 5, this computer only); before any, every project is under Projects in the sidebar's order. A name typed in the name field that equals one of the project's branches opens that branch as it is (the preview says so) instead of making a numbered new one. The optional note is the agent's first prompt. The Advanced branch name replaces the name the branch is made from but still gets the branch prefix. The main checkout cannot be a parent. With Create more ticked the new workspace does not take the front (an agent with a prompt still starts there), so the next name can be typed at once.

- [orchestration] T-111-a: the branch summary counts what the branch's commits changed since they parted from the base (`base...HEAD`), not uncommitted edits, so "commit 10 lines, +10" holds and the base's own new commits show only as behind. "Without a test count" is read as no test file changed: the one row is then Non-generated. Tests are files under a test / tests / __tests__ / spec / specs folder or named *.test.*, *.spec.*, *_test.*, test_*; generated are lock files, minified files, source maps, snapshots and anything under a generated folder (not yet .gitattributes). The upstream setting is a checkbox inside the opened summary until the Settings pages (T-116) can hold it. "A base pinned for the worktree" has nothing to read yet; the project's saved base is the pinned one.
- [orchestration] T-115-a: the Handoff note is the last section of the Source Control card, the right sidebar's only card so far. No setting disables an agent yet, so the agent list is every agent found on this computer with the default first; hosts are local only, so the note is keyed by folder path alone (a folder workspace and a worktree have different folders, so they never share one). "A new tab" is read as a new pane in the workspace's grid, the way New tab adds one. Removing a workspace forgets its note.
- [orchestration] T-116-a: the Git & worktrees settings are a titled part of the sidebar gear form until the Settings page (T-054) exists, as the gear already held the prefix. The sample uses the global Git user name (a repository can set its own; its branches then follow that one). The custom prefix is saved when the field loses focus or Enter is pressed, the sample follows each keystroke. Default compare base and the summary's checkbox are one setting, so either changes both.
- [orchestration] T-117-a: worktrees carry no identity record of their own yet, so `identity:` takes the same `<repo-id>::<path>` form as `id:`; `active` means the same as `current` (the command line has no focused-worktree notion); `folder:` is refused until folder workspaces exist (PROJ-086, T-218). `project list` is the registered repos in sidebar order (a project is a repo today). The row's board status is left for CLI-019 (T-117-b). Hosts are local only, so every list says covered: local, left out: none. `worktree ps` counts a terminal under the innermost worktree its starting folder is in.
- [orchestration] T-118: the base for changes and overlap is the repo's saved base while it exists, else its default branch, with no fetch (both commands only read); `repo show` now reports the same base without fetching. Untracked files count as changes. A sibling with no history in common with the base counts its changes from the base itself, so it can still be compared; its merge check then reports unverifiable. Only siblings that share a file are listed; their clash check uses the committed tips, as the card says, so shared uncommitted edits can show next to a clean prediction. The "plain folder workspace is not supported" rule has nothing to act on until folder workspaces exist (PROJ-086, T-218); `folder:` selectors are already refused.
- [orchestration] T-111-b: the pointer is read when the shortcut fires, so a row that has just gone away never counts; the main checkout row has no delete, so hovering it does not count. The Mod+R half of VIEW-048 waits for the tab-rename field (TERM-048, T-119); on Windows `tab.rename` keeps no default key until then, since Ctrl+R is the shell's history search.
- [orchestration] T-129-a: `worktree ps` keeps CLI-017's rule of listing worktrees with something running, now counting an unfinished worker dispatch as something running; the scope line counts every worktree scanned. "Repeated polls get tiny no-change answers" is per terminal (its pane key) and only for `--json`, since a person reading text wants the list each time; a call from outside a Kolux terminal always gets the whole snapshot. A scan is reused for 1.5 s and counted slow after 3 s (the card names no numbers). Remote host columns stay with area 18; the scope says this computer only.
- [orchestration] T-130: the runs already reach the page in one list (automations_list, at most 100 kept per automation by AUTO-021), so the batches of 100 are drawn from that list as the table is scrolled to its end rather than fetched page by page; nothing is fetched to load more, so it cannot fail part-way, and a failed Refresh keeps the rows shown with a note. Changing the search or the filter starts again at the first 100. Back from a run's page via Runs keeps the dashboard as it was (search, filter, rows loaded); only leaving to Automations resets it. Tiles count completed runs as successes and failed-to-start runs as failures; skipped and in-progress runs count in neither.
- [orchestration] T-133: the alert kinds and their defaults follow STAT-042 (task finished on, bell off, agent stopped on, usage on); its master switch, quiet minutes and confirmation stay with T-124. The sounds are three tones Kolux plays itself (Chime, Ping, Pulse) plus the system default; STAT-043's nine tones and a custom sound file stay with T-309. The system default sound plays at the system's own volume (Windows gives an app no volume for it); the slider sets Kolux's tones and 0 silences both. "Notifications are blocked" is read from Windows' ToastEnabled switch (Get notifications from apps); the per-app switch is not read yet; in a dev build the toasts arrive under the PowerShell app id, as for any unpackaged Tauri app. The notification plugin is called from Rust only, so no JS package or capability was added.
- [orchestration] T-155-a: the nesting cap's config value is `orchestrationMaxDepth` in settings.json (whole numbers of 1 or more; no Settings page, per SET-055); `--max-depth` on worker-start and dispatch sets it for that coordinator's workers, and a worker can only lower what it was given. A context-only dispatch to the caller's own pane is allowed while it has a level left (ORCH-013's own_pane refusal stays for injection and at the cap). Run scoping covers the commands built so far; sending mail to another Run is still allowed, since posting is neither seeing nor changing it. A worker acts in the Run of its dispatch without being tied to it, so its tasks and sub-workers land in its coordinator's Run. The sender label `--from` is still accepted as identity; refusing it is CLI-039 on T-160. Abandon frees the task (back to ready) so it can be handed on, as the card's 'fenced' implies; worker-list's 'abandoned' filter waits for T-089-b.
- [orchestration] T-160: `--from` now names only the calling terminal itself (it was any open terminal under T-082): another handle is refused as `caller_mismatch` and any `--from` from a shell Kolux did not start fails closed as `unbound_caller`, since the card has no place where acting as another pane is permitted. A done report or heartbeat naming a dispatch must come from that dispatch's worker terminal (`not_your_dispatch`), and one from a terminal of an earlier Kolux start is refused as unprovable; that is how 'a worker-done from a different pane does not complete the task' holds before T-030 builds completion. CLI-039's structured-chat and older-protocol rules belong to ORCH-049 and ORCH-048, both skipped in DECISIONS.md, so nothing is built for them; reporting an unsettled dispatch as an unknown outcome belongs to the settle step on T-030 (a report on a finished dispatch already fails). The renamed caller flag is check's `--terminal`. `--force` on worktree rm keeps the branch (CLI-020); the sidebar's Remove is unchanged. Typo suggestions name one nearest word (the first on a tie) and a flag typo lists the command's flags plus `--json`.
- [orchestration] T-186-a: PROJ-040's "dropped because it was archived" is read as "removed", since no archive card exists; the warning names the reason and the workspace sits at the top level. Falling back to the active folder workspace waits for folder workspaces (T-218), so T-186-b keeps it. The change-parent picker lives on the sidebar row (an arrow button), as the Board-card drop needs the Board (T-025..T-030); the main checkout is never a parent or a child. The CLI's `worktree create --parent-worktree` path is unchanged: it already resolves the parent before creating.
- [orchestration] T-187-a: SESS-020's "each seat has an AI" is read as the chooser's own readiness, so a Terminal seat counts as picked and can be saved. A team also keeps each seat's job title and opening prompt and the shared task (the card's optional prompt); the per-seat "options" the card names do not exist in the chooser yet, so there is nothing more to keep. Picking a team sets the Shape row to Custom with the saved roles on the seats, so the team button itself is not shown as pressed. The rename and delete menu is an inline row under the Shape row, and the undo offer is a note in the chooser rather than a window toast, because the app's toast carries no button. A blank name on save keeps Save greyed. Teams live in settings.json (`savedShapes`); the importer half of the compat note waits for the importer.
- [orchestration] T-189-a: VIEW-011's "View > Appearance" toggle lives in Settings > Appearance (a Title bar card), since the app has no View menu yet. The restored page is whichever page was open (Automations or model routing), as pages only show on Terminals. VIEW-069's dialog is a small form inside the Source Control panel rather than a window-wide dialog, and "the saved launch choice" is read as a remembered agent for Source Control's agent actions (`scmAgent`), set from the dialog's "without asking next time" switch and cleared by "Ask each time"; a remembered agent that is no longer installed brings the dialog back. "The prompt cannot be handed over" is read as: the start line or trust cannot be set up (shown in the panel), the program cannot be run, or it ends before a typed-in prompt was typed (both reported as a session that did not start, and the pane is dropped as SESS-024 does). Only resolve-conflicts is offered; other agent actions come with their surfaces.
- [orchestration] T-190-a: "idle" for @idle is read as an agent that has written nothing for 3 seconds, until the status cards' idle detector lands. @worktree:<id> takes the worktree list id (<project id>::<path>) or the bare folder, compared as text (slashes, a trailing slash and letter case aside). ORCH-009's read-only tag for an older install's mail has nothing to mark, since older installs' Runs are a skip (ORCH-048 in DECISIONS.md). ORCH-019's "the provider never changes" is read as: with no tier the worker runs on the coordinator's own agent unless `--agent` names one, and a model name Kolux knows for another provider is refused; a name it does not know is left to the agent, and Cursor takes any name. The coordinator's agent is now read from the program its pane was started with, without waiting for the pane to go quiet, since the coordinator is busy running the command (this also fixes a tier from a busy coordinator falling back to the default agent).
- [orchestration] T-190-b: a gate holds pending and ready tasks; one that is dispatched, completed or failed is refused, and a supervised worker still at work on the task is named in the refusal. Gates can stack on one task, and the task goes back to pending (then ready once its dependencies are done) only when the last open gate on it is resolved. No gate times out, since gate-create takes no deadline; `--status timeout` is accepted and lists nothing until one does. ORCH-029's question goes to the caller's Run by default (`--to` may name a terminal, run:<id> or dispatch:<id>), its choices ride in the payload as {"options": [...]}, and its answer is the first reply to it. The default wait is five minutes, the same as `check --wait`. CLI-033 (T-089-b) is now mostly built with it; T-089-b keeps only the packaged build's exit-status-75 hand-back.
- [orchestration] T-191-a: reset is not limited to the caller's Run; it clears the whole install's orchestration state, as the card describes. The tasks scope also clears decision gates, since they belong to tasks. Ids keep counting up after any reset, so a cleared message, task or gate is never named again. ORCH-031's "archived worker output" has nothing to clear yet, since no worker output is archived in this build. claude-teams always starts teammates in-process (`--teammate-mode in-process` with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, from Claude Code's public docs) until Kolux can answer Agent Teams' tmux calls (ORCH-042); WSL is not refused, since the card only keeps teammates in-process there.
- [orchestration] T-192-a: Kolux has no interface language setting yet, so "the interface language" is the window's own language (navigator.language, which follows the system); the chips' field names and the weekday and month names come from Intl in that language, while Kolux's own words (Valid, at, on) stay English until there are translations. The line in words covers five-field cron lines; an RRULE keeps the back end's sentence. The hour box runs 1 to 12, so an emptied hour box becomes 1, and the arrows stop at the ends rather than wrapping. The template prompts are Kolux's own wording. The grace window each template names (12 hours, 24 hours, 3 hours, 30 minutes) is kept with the template but not shown or saved until T-175 adds the field.
- [orchestration] T-193-a: usage reads "Not recorded yet" until usage is measured per run (T-140). The run count is the number of runs held in the history. Escape on the list closes the Automations page and returns to the terminals. The keys act only when focus is on the page or nowhere, so a terminal or the sidebar keeps its own arrows.
- [orchestration] T-194: "an unsupported Git is remembered" is met by the Git version Kolux reads once at startup: below 2.38 the merge check is skipped for the life of the app, with no probe. A version string that cannot be read is tried, and merge-tree's own failure then reads unverifiable.
- [orchestration] T-197: every automation row reads host "local" and never orphaned until remote hosts exist; `--workspace` alone means the existing-worktree mode, otherwise each run gets a new worktree; a timetable without --time runs at 09:00 and without --day on Monday, in the machine's time zone unless --timezone is given; the CLI request id is the create request id; `automations run` logs a manual run and exits 0 even when the agent fails to start, since the failed run is the recorded result.
- [orchestration] T-198: `agent-context --json` and the skills commands answer in the same envelope as every other command, with the document as its result; aliases are listed by their full words (worktree remove, worktree delete); the four bundled guides are new clean-room text written for this build, short guide = the skill file without its header, full = the guide followed by every reference; topic aliases are cli and kolux, orch, security, ward and injection; gate-create's no-Run refusal applies to gate-create only, and an explicit --from is never checked for being alive, though under ORCH-001 it still has to match the terminal the command runs in.

## Last 10 passes  (date · task · result · evidence)
- 2026-10-12 · [orchestration] T-134 · HAND TO FABLE: all three cards sit on the hard list. terminal read needs PTY internals: today the reader thread in pty.rs / terminal.rs sends output straight to the window (the output event) and keeps no history, so cursors and limits need a kept, cursor-numbered output buffer in that thread, and --screen needs a terminal grid (a VT parser on the Rust side, or a round trip to the window's xterm buffer over IPC); send's "the turn began" receipt, wait --for tui-idle and all of CLI-040 (agent hooks status, on, off, prepare-codex) need the agent status hooks, T-025, unticked. Only send without a receipt and wait --for exit would be buildable now, and neither meets an acceptance line on its own. No code was written, so nothing was reverted; left unticked
- 2026-10-12 · [orchestration] T-193-b · not built, left unticked. Hermes and OpenClaw cron jobs can only be read and proven with those tools installed, and neither is on this PC; the command group part of this line was built on T-197-a
- 2026-10-12 · [orchestration] T-192-b · not built, left unticked. The precheck needs no other task, but proving it needs a timed or event-started run and its `--precheck` and `--precheck-timeout` flags sit on T-197-b, so the two belong in one pass; keeping one agent session across runs needs each run's agent session id and resume (with session transcripts, T-169); the grace window in the templates waits on T-175
- 2026-10-12 · [orchestration] T-191-b · not built, left unticked. The Agent Teams picker entry, the teams mode preference and the new-teams-tab command only show off Windows and WSL, and claude-teams itself refuses on Windows (T-191-a), so on this PC every one of them could only be proven hidden. Better built with the tmux stand-in on T-197-b by a pass with a macOS or Linux machine to prove it on
- 2026-10-12 · [orchestration] T-189-b · not built, left unticked. The Skills title-bar button and page restore need the Skills page (T-243), and continuing a past session needs session transcripts (T-169); both unticked
- 2026-10-12 · [orchestration] T-187-b · not built, left unticked. Carrying a conversation to another agent needs session transcripts (T-169), the failing-checks start needs the checks panel (T-127), and the issue and pull-request starts need their checkouts (T-106-b, T-107-c, T-109-b); all are unticked
- 2026-10-12 · [orchestration] T-186-b · not built, left unticked. Every part waits on work this lane has not got: the Board-card middle drop needs the Board (T-025..T-030, all unticked), `worktree set` with its parent flags is T-117-b, and falling back to the active folder workspace needs folder workspaces (T-218). Nothing here can be proven before those land
- 2026-10-12 · [orchestration] T-198-a · done (split: T-198-b holds skills install and update and the kolux-cli browser reference): the no-Run rule in `gate_create` (`orchestration.rs`, the gate test extended; red first), `local_cli.rs` (new, a child of `cli.rs`: agent-context, skills list and get, 2 new cargo tests written with the code) and the bundled guides in `src-tauri/skills/` (163 cargo tests in all) · evidence/T-198-agent-context-app-closed.png (with the CLI pointed at an empty app folder, worktree list says Kolux is not running while agent-context gives 45 commands, its JSON count equals its entries, schema 1, worktree rm lists remove and delete; skills list; skills get nope exits 1 listing the topics), T-198-skills-get.png (the short orchestration guide, short against full line counts, a reference by its path through show, --topic and an alias, and --full with --references refused), T-198-gates.png (gate-create with no Run attached refused with exit 1 and gate-list still empty; the --options line there failed only on PowerShell's quoting of JSON to a native program), T-198-gate-resolved.png (in Run run-8, gate-9 pending holds task-2 as blocked, gate-resolve yes, gate-list shows it resolved, task-2 ready). Typed in a plain PowerShell pane of the dev app; orchestration state reset afterwards; no agent was started
- 2026-10-12 · [orchestration] T-197-a · done (split: T-197-b holds prechecks, session reuse, grace minutes, owner conflicts, skipped and orphaned rows, status/account/open advice, the other exit codes and the tmux stand-in): `automations_cli.rs` (new, a child of `cli.rs`) plus parse, dispatch, help and notify routing in `cli.rs` (2 new cargo tests; 161 in all) · evidence/T-197-create-refusals.png (create daily 09:00, --day 7 and a --time edit without --trigger refused with exit 1, list and show), T-197-cli-made-shows-on-page.png (the CLI-made row on the Automations page), T-197-run-runs-show.png (a paused Gemini automation run by hand logs #1 manual failed, since Gemini is not installed; runs and show), T-197-json-and-remove.png (list --json, remove both, a second remove refused, empty list). Typed in a plain PowerShell pane of the dev app; no agent was started; every automation made was removed and the run history cleared. T-193-b now holds only Hermes and OpenClaw. The tests and code were written together and passed on the first run, so no red run was seen
- 2026-10-12 · [orchestration] T-194 · done (changes and overlap were built on T-118; this pass adds the Git 2.38 rule): `Git::predicts_merges` in `git.rs`, used by `overlap` in `cli.rs` (1 new cargo test and the T-118 overlap test extended with a Git 2.37 case; 159 in all) · evidence/T-194-overlap.png (README.md edited in helper and lead: overlap from each lists the other with README.md, committed work merges cleanly), T-194-conflict-changes-json.png (once both commit README.md, overlap reads "would conflict in README.md"; changes --json lists README.md M and notes.txt U against main). Typed in a plain PowerShell pane of the dev app; the sandbox worktrees were reset afterwards; no agent was started. The Git older than 2.38 case is proven by the cargo test only, since this PC has Git 2.55
- 2026-10-12 · [orchestration] T-193-a · done (T-193 split; T-193-b keeps AUTO-020's command group and AUTO-025's Hermes and OpenClaw jobs): `pageKey` and `keepSelection` in `automations/model.ts`, the opened page, tabs, facts and folded prompt in `AutomationsPage.tsx`, `list` returning runsError in `automations.rs` (cargo test extended, 158 in all; 5 new vitest tests, 206 in all) · evidence/T-193-down-from-search.png (two Downs from the search box select the third row), T-193-enter-opens-folded.png (Enter opens Bravo review under the breadcrumb with its long prompt folded), T-193-right-runs-tab.png, T-193-prompt-unfolded.png, T-193-escape-back-to-list.png, T-193-dialog-escape-only.png (Escape closes New Automation and leaves the page), T-193-delete-keeps-neighbour.png (deleting Charlie selects Delta), T-193-history-unknown.png (corrupted history: Runs unknown and a warning), T-193-escape-closes-page.png. Four paused stand-in automations, all deleted afterwards; no agent was started
- 2026-10-12 · [orchestration] T-192-a · done (T-192 split; T-192-b keeps AUTO-008's precheck, AUTO-009's session reuse and the templates' grace windows): `timetable.ts` (preset cron lines, Custom's typed line, 12-hour conversion, snapping and nudging, field chips, weekday names and the line in words through Intl, the four templates), the clock boxes, chips, status line and Templates button in `AutomationDialog.tsx`, and the template cards on the empty `AutomationsPage.tsx` (9 new vitest tests, 201 in all) · evidence/T-192-templates-empty.png (no automations: four template cards and Start from blank), T-192-hourly-template.png (hourly upkeep fills name, prompt and Every hour at minute 15, with only the minute box), T-192-header-templates.png (the dialog's Templates button, and a new automation at 9:00 AM), T-192-custom-from-weekly.png (weekly, Tuesday, 10:30 then Custom gives `30 10 * * 2`, five chips, Valid: at 10:30 on Tuesday), T-192-custom-invalid.png (gibberish reads Invalid with the reason and Save is off), T-192-minute-snap.png (75 in the minute box snaps to 59; two Up arrows take the hour from 10 to 12), T-192-custom-restored.png (back to Custom brings back the typed line), T-192-saved-1330.png (1:30 PM saved as Every day at 13:30), T-192-french-weekly.png and T-192-french-custom.png (the app started with the French interface language: mardi in the day list, the chips minute, heure, jour, mois, jour de la semaine). After a template was chosen and the dialog cancelled the list still held no automation; the one saved for the proof was deleted, and no agent was started
- 2026-10-12 · [orchestration] T-191-a · done (T-191 split; T-191-b keeps ORCH-041's picker entry, mode preference and keybinding command): `Mail::reset` in `orchestration.rs`; the reset command (exactly one scope), `claude_teams` and `teams_allowed`, and the help lines in `cli.rs` (1 new cargo test and new parse checks, one of which holds every orchestration command to a help line; 158 in all) · evidence/T-191-reset-tasks.png (no scope and two scopes refused, exit 1; reset --tasks empties task-list while run-list and the inbox are unchanged), T-191-json-teams-messages.png (a refused reset and a missing gate as JSON errors with code and message; claude-teams on Windows refused with exit 1; reset --messages leaves no mail and the Runs in place), T-191-json-reset-all.png (run-current --json as one JSON object; reset --all leaves no Runs). Typed in a plain PowerShell pane of the dev app; no agent was started
- 2026-10-12 · [orchestration] T-190-b · done: `Gate`, `gate_create`, `gate_resolve`, `gate_list` and `ask` in `orchestration.rs`; the ask, gate-create, gate-resolve and gate-list commands, their checks and text, and the ask wait (sharing `check --wait`'s loop) in `cli.rs`; pane_agent's doc comment put back above it (2 new cargo tests, 157 in all) · evidence/T-190-gate-open.png (plain comma choices refused, a JSON list opens gate-3 and task-1 shows blocked), T-190-ask-open.png (from another Run gate-3 reads as not found while gate-list --run run-2 can read it; a one-second ask returns still open with the resume command; a question to @all and --question with --resume refused), T-190-gate-resolved.png (the coordinator's question banner with the choices, the reply, gate-3 resolved and task-1 ready, resolving again refused, the inbox holding only the one question), T-190-ask-answered.png (resume returns the answer; a 40-second ask returns as soon as the coordinator replies). Stand-ins (node copied as claude.exe) in place of real agents; no real agent was started
- 2026-10-12 · [orchestration] T-190-a · done (T-190 split; T-190-b keeps ORCH-028 decision gates and ORCH-029 ask): `Peer`, `same_path` and `Mail::post` (group fan-out on one thread, refused whole) in `orchestration.rs`, `model_fits` in `routing.rs`, the banner `mail_lines`, `peers`, `own_agent` (the caller's agent without waiting for its pane to go quiet), the coordinator's agent and the model check in worker-start, and `--model` as who runs it in `cli.rs` (4 new cargo tests) · evidence/T-190-group-send.png (from a Claude stand-in: @all gives two copies on thread-7, @claude one copy, @nobody named in the error, a question to @all refused), T-190-banner.png (the Codex pane titled claude: the @all copy and an URGENT escalation banner with payload and reply command, and no @claude copy), T-190-shared-thread.png (the other Claude pane holds the same thread-7 copy and the @claude one), T-190-worker-model.png (Codex coordinator: --effort without --model refused, --model sonnet refused as not a Codex model, --model gpt-6-sol starts a Codex worker), T-190-worker-args.png (the worker got --model gpt-6-sol and model_reasoning_effort=high), T-190-idle-worktree.png (@idle reaches the two quiet agents, @worktree:<id> only alpha, @droid matches nobody). Stand-ins (node copied as claude.exe and codex.exe) in place of real agents; no real agent was started
- 2026-10-12 · [orchestration] T-189-a · done (T-189 split; T-189-b keeps VIEW-011's Skills half, waiting on T-243, and VIEW-087, waiting on T-169): `titleBarButton` and `openPageAt` in `general.ts`, the Title bar card in `AppearancePage.tsx`, the Automations button in `TopBar.tsx`, page restore and save plus the throwing `openIn` start in `App.tsx`, `conflictPrompt`, `savedFixAgent` and `SCM_AGENT_KEY` in `scm/model.ts`, the resolve-conflicts action and dialog in `SourceControlPanel.tsx`, an early-exit launch failure in `TerminalPane.tsx` (3 new vitests) · evidence/T-189-setting-off.png (Title bar card, switch off, no button), T-189-setting-on.png (switched on, clock button in the title bar), T-189-titlebar-opens.png (the button pressed, Automations open), T-189-restored.png (after a restart, Automations shown), T-189-resolve-dialog.png (two conflicted files, the dialog with agent, prompt and remember switch), T-189-agent-started.png (a stand-in node program in place of Claude got the prompt in the repo folder), T-189-saved-choice.png (remembered agent, button clicked twice, no dialog, exactly one more tab), T-189-launch-failed.png (agent pointed at a missing program: A session did not start). No real agent was started
- 2026-10-12 · [orchestration] T-187-a · done (T-187 split; T-187-b keeps SESS-031 conversation carry-over, SESS-033 fix failing checks and SESS-034 start from an issue, each waiting on a missing surface): `SavedShape`, `saveShape`, `renameShape` and `restoreShape` in `seats.ts` (the limits, case-blind name numbering, blank-seat restore), the Save as team field, saved-shape buttons with a rename/delete menu and the Undo note in `ChooserPane.tsx`, `savedShapes` setting wiring in `App.tsx` (1 new vitest in seats.test.ts, 1 in ChooserPane.test.ts) · evidence/T-187-naming.png (a Pair of Claude Sonnet and Codex with a job title and task, the team name field), T-187-restored.png (a fresh one-seat chooser after picking Review crew: both seats, roles, job title, task and Folders back), T-187-deleted.png (the renamed Pair review deleted, Deleted Pair review. Undo), T-187-undone.png (Undo brings it back). Nothing was started
- 2026-10-12 · [orchestration] T-186-a · done (T-186 split; T-186-b keeps the Board drop, `worktree set` and the folder-workspace fall back): `reparent`, `nest_under` and the `workspace_set_parent` command in `projects.rs` (refuse self, a descendant, the main checkout and a vanished workspace; the composer's create and open-branch paths drop a vanished parent with a warning), `parentChoices` in `model.ts`, and the row's Change parent picker in `ProjectsPanel.tsx` (1 new cargo test, 1 new vitest) · evidence/T-186-picker.png (a's list offers only No parent and b: not a, its parent p, or kid and grand under it), T-186-moved.png (a moved under b with kid and grand), T-186-refused.png (p's move onto grand, removed while the list was open, refused after the list closed), T-186-dropped-parent.png (a workspace created with kid as parent after kid was removed: top level, yellow note)
- 2026-10-11 · [orchestration] T-160 · done: `commands()`, `near`, `nearest`, `command_typo` and `flag_typo` in `cli.rs` (parse names the nearest group, verb or flag, destructive verbs only from one edit away, flags no command takes no longer swallow a word), `--force` keeps the branch on worktree rm, `caller_of` refuses `--from` for any terminal but the caller's own and from unproven shells, and `send` takes a dispatch's done report or heartbeat only from its worker terminal (2 new cargo tests, 2 extended) · evidence/T-160-typos.png (the four typo cases and the `--jso` JSON error in a pane), T-160-rm.png (rm refused on uncommitted changes, `remove --force` keeps txais-xiong/scratch-c, `delete` behaves like rm), T-160-identity.png (term-1's done report on term-2's dispatch and `--from term-2` refused, the worker's own report accepted), T-160-live.txt (the same with the app closed first, and a plain shell's check and `--from` refused). The worker was the stand-in `claude.exe`
- 2026-10-11 · [orchestration] T-155-a · done (T-155 split: ORCH-036 takeover and ORCH-067 dispatch pass are T-155-b, waiting on T-030, T-071, T-089-b, T-190 and T-134): `nest`, `task_in`, `abandon`, `Mail::run_of` and the finished-dispatch fence in `orchestration.rs` (3 new cargo tests), `worker-abandon` and `--max-depth` in `cli.rs` with Run scoping on check, inbox, reply, task-create, dispatch and dispatch-show, depth and cap stored on every dispatch · evidence/T-155-a-workers.png (three stand-in worker panes: level 1 turned away at cap 1, level 2 turned away at cap 2, the abandoned worker's done report and heartbeat turned away), T-155-a-runs.png (Run B: Run A's task, dispatch, mail and terminal read as not found, its task list shown read-only), T-155-a-live.txt (the full transcript, including the low-level dispatch abandoned twice with its pane still answering). The workers were a stand-in `claude.exe` (prints a line, then runs cmd) set as the Claude command on the Agents page, so no real agent ran
- 2026-10-11 · [orchestration] T-149 · not built, left unticked. PROJ-034's trust question is asked before a create runs the shared setup script, and nothing runs a setup script on create yet (PROJ-033 on T-107-b, the trust prompt shared with T-156 / T-150); the default tabs need terminals opened per new worktree from the create, and the shared issue command needs issue starts (T-107-c). Only `worktree.sharedDirectories` is read today (T-113-a). PROJ-082 removes what the cleanup dialog selected, and that dialog and its removal are T-162. Nothing changed · no evidence
- 2026-10-11 · [orchestration] T-133 · done: new `src-tauri/src/notifications.rs` (`notification_test`, a silent toast unless the system sound is chosen, refused when Windows' ToastEnabled switch is 0; `open_notification_settings` to a fixed ms-settings address; 1 cargo test), tauri-plugin-notification 2 (MIT/Apache-2.0) registered in `lib.rs`; new `src/settings/notifications.ts` (kinds and defaults, read-back, the test plan, three WebAudio tones) and `NotificationsPage.tsx`; `SettingsPage.tsx` serves it; styles; 4 new vitest cases · evidence/T-133-tone-test.png (Ping at 60%: Test sent), T-133-system-sound-test.png (System default at 80%), T-133-silent-test.png (Chime at 0: Silent, Test sent in silence), T-133-toast-history.txt (Windows' own notification history read through ToastNotificationManager: the tone and 0% toasts are silent, the System default one carries the system sound; the tones were recorded from the page's AudioContext: 880+1320 Hz and 1568 Hz at peak 0.3 for 60%, none at 0 or for System default). The System notification settings link was not clicked live, since it opens Windows Settings on Txais's screen
- 2026-10-11 · [orchestration] T-132 · not built, left unticked. EDIT-007 (copy a selection with its path and lines) and EDIT-020 (review notes in a margin rail, sent to an agent) both act on the file editor, and there is no editor yet: it is T-093 (EDIT-001 and EDIT-012, a file in a tab and markdown in a rich editor), on the release lane's batch now. EDIT-020's Send menu also wants each agent's time since it changed state, which comes with the status hooks (T-025) · no evidence (nothing built)
- 2026-10-11 · [orchestration] T-131 · not built, left unticked. SAFE-005, SAFE-006 and SAFE-007 refine the plan review sheet, and the sheet does not exist yet: it is T-032 (SAFE-001..004, the pane header's review button and the sheet itself), which needs the agent status hooks (T-025) to learn that Claude is waiting on a plan and what the plan text is. Drafts per pane and plan text, the 16,000-character trim and the read-only check all hang off that pending-plan state · no evidence (nothing built)
- 2026-10-11 · [orchestration] T-130 · done: new `src/automations/RunsDashboard.tsx` (the dashboard, a windowed table, `RunPage` with its breadcrumb); `model.ts` `dashboardRows` / `runTiles` / `onScreen` / `startedBy` / `RUN_BATCH`; `AutomationsPage.tsx` Runs button live, the dashboard and run page in place of the list, a Refresh that keeps rows on failure; styles; 4 new model cases, 3 new page cases · evidence/T-130-dashboard.png (5 real runs from two automations, tiles 0 / 3), T-130-failed.png (status Failed: only the 3 failed runs), T-130-run-page.png (Nightly checks #3 as a full page with Automations › Runs › Nightly checks #3), T-130-back-to-runs.png (breadcrumb Runs: the dashboard, still filtered to failed), T-130-back-to-automations.png (breadcrumb Automations: the list; the seeded project reads Project gone only because it was added behind the sidebar's back)
- 2026-10-11 · [orchestration] T-129-a · done (T-129 split; T-129-b keeps ORCH-026, ORCH-037, ORCH-056 and ORCH-066, which need settled and released dispatches (T-089-b), status hooks (T-025), live worker state (T-030), a terminal screen scan and the Agents view rows): `cli.rs` `ps` (its own branch, apart from `worktree list`), `scan` (a per-repo `git worktree list` cache with the last good list, a 3 s slow cut-off on a background thread), per-terminal JSON snapshots; `orchestration.rs` `workers_in`; `projects.rs` `decorate` split out of `list_workspaces`; the client marks a `--json` ps; 1 new cargo test · evidence/T-129-a-ps.png (`--limit 1`: one row, more-rows note, scope line; then both rows with their terminals), T-129-a-poll.png (second JSON poll: unchanged with the same snapshot), T-129-a-degraded.png (the repo's .git moved aside: both rows still listed, [last known], the scope line gives git's error, the repeat poll says cached)
- 2026-10-11 · [orchestration] T-111-b · done (T-111-b split; T-111-c keeps VIEW-038 / VIEW-041 / VIEW-042, which need the worktree palette on T-098; VIEW-048's Mod+R tab rename moves to T-119, which builds the tab-rename field): `deleting.ts` `deleteTarget` (hovered wins over shown); `ProjectsPanel.tsx` reads the row under the pointer (`[data-path]:hover`) when the shortcut fires; `scripts/evidence/cdp.mjs` gains `hover` and the Backspace key; 1 new vitest case · evidence/T-111-b-hovered-delete.png (login shown, pointer on signup, Ctrl+Shift+Backspace: the remove question is for signup), T-111-b-active-delete.png (pointer off the sidebar: the question is for login)
- 2026-10-09 · [accounts] T-038 · How secrets are sealed: Windows DPAPI (current-user scope)
  through `windows-sys` 0.61 (MIT/Apache-2.0, already in the lock through Tauri); the profile folder
  is limited to the user with `icacls /inheritance:r /grant:r <user>:(OI)(CI)F`, so every file
  inside inherits it. On macOS/Linux this build only scrambles and logs that once. The settings
  fields are `claudeOauthToken` and `xaiApiKey`; managed sign-ins go in `<profile>\vault\`. The one-off
  pass waits 2 s after setup so it never delays the window. Recorded as DT-A1 in DECISIONS.md.

- 2026-10-09 · [accounts] T-042-a · Split: the background app-server route (Codex 0.156's
  `account/read` + `account/rateLimits/read`, shapes from `codex app-server generate-json-schema`)
  is built first; Codex's own usage service (tried first by the card) and the hidden status-screen
  route are T-042-b. A window of 24 hours or less counts as the 5-hour one, anything longer as
  weekly; with no length given, primary is the 5-hour one. The pill shows the weekly figure (the
  pill is the weekly pill, USAGE-008) and reads again every 10 minutes until USAGE-023's timer
  lands. The live proof read Txais's own Codex figures (read only, no session opened).

- 2026-10-09 · [accounts] T-043-a · Settings opens from a click on the top-bar usage pill and
  from Ctrl+Comma (`app.settings`), laid over the window body; it has only the AI connections page
  until T-092 brings the full Connect cards (ACCT-001..003). The profile fields are
  `claudeOauthToken` (sealed, from T-038), `claudeConnectionMode` = "key" and `claudeKeyCreatedAt`
  (milliseconds). Twelve months = 365 days; the warning starts at 30 days left or fewer; the
  renewal month shown is the month the key runs out. The setup runs in a hidden terminal (ConPTY,
  400 columns) that answers Claude Code's cursor-position question, because without that answer
  its output stalls; a launcher ending .cmd/.bat/.ps1 is refused rather than run through cmd. The
  key is taken only from an `sk-ant-oat…` run of at least 40 characters; a subscription line counts
  as final only when no key follows. Split: T-043-b (managed accounts, renewal opt-out), T-043-c
  (Codex sign-ins).
- 2026-10-09 · [accounts] T-043-b · Managed Claude accounts live in the profile: kv
  `claudeAccounts` (id, email, organisation, folder, last sign-in) and `claudeActiveAccount`;
  each account's folder is `<profile>\claude-accounts\<id>` holding Claude Code's own
  `.credentials.json`, with a sealed copy at `<profile>\vault\claude-<id>.json`. Adding an account
  does not make it active; the first one is not made active either, so nothing changes under a
  running setup until the user picks it. The 1-year key wins over the active account for new
  panes. An account pane drops any CLAUDE_CODE_OAUTH_TOKEN Kolux itself inherited, because Claude
  Code prefers that variable over the folder (found live). The email and organisation field names
  in `claude auth status --json` are not documented; several spellings are tried and a row shows
  "Claude account" when none match. Settings field `claudeSignInUpkeepByClaudeCode` (absent = on,
  DT-A2) holds the ACCT-006 opt-out; there is no switch for it until T-043-d.
- 2026-10-09 · [accounts] T-043-c · Codex accounts live in kv `codexAccounts` (id, email, home,
  last sign-in) and `codexActiveAccount`; each home is `<profile>\codex-accounts\<id>` with a
  `config.toml` holding only `cli_auth_credentials_store = "file"` (Codex's public auth docs), so
  the sign-in lands in that home's `auth.json` and not in the system keyring; a sealed copy goes to
  `<profile>\vault\codex-<id>.json`. Consequence: a pane on a managed Codex account does not
  see the user's own Codex settings (MCP servers, model choices); it starts from Codex's defaults.
  Unlike Claude accounts, a newly connected Codex account becomes active at once: Connect on the
  Codex card means "use this". The email comes from the `email` claim of the sign-in's identity
  token (not documented); the device code is taken as dash-joined groups of 4 or more capitals
  or digits, checked only against a stand-in so far. The usage pill reads the active account's home
  first. `claude_key::strip_ansi` now turns a cursor jump into a line break and a cursor-forward
  into a space, because the hidden console places lines that way (found live: the link and the next
  line ran together).

- 2026-10-09 · [accounts] T-044 · The reason list and its fixes live in `src/settings/Attention.tsx`
  (the back end names the reason, the page owns the button words). Choices: plan not covered
  offers Check again; a refused Claude account sign-in offers "Use a 1-year key instead"; an
  unknown reason shows for information only and keeps the card's own Connect. The startup check
  runs `claude auth status` once for the active managed Claude account and marks it stale when
  no identity comes back; it is skipped in key mode and when Claude Code looks after sign-ins
  (OD-01's default), so by default only Codex can raise the bar. Codex accounts are flagged from
  the usage read, only when the account home holds a sign-in. The usage-limit reset time is read
  from kv `claudeUsageLimitResetsAt`, which T-039 is to write. "Sign in again" on a Codex
  account updates that account in place and does not change which account is active.

- 2026-10-09 · [accounts] T-045 · Claude Code's own sign-in is read with a hidden `claude auth
  status --json` (no folder override, the 1-year key variable removed) each time Settings opens,
  and only when it is what new Claude panes use (no key mode, no active managed account); no
  answer within 20 s shows nothing rather than a false "signed out". Codex drift means the
  account home's config.toml no longer has `cli_auth_credentials_store = "file"` at the top level
  or now names another model provider; the user's own `~\.codex` is never checked (Kolux expects
  nothing of it). A Codex refusing its command line is spotted by its parser's usual wording
  ("unexpected argument", "For more information, try '--help'") and shown as "update Codex"
  with no fix button. The resume switch is settings field `claudeResumeAfterLimit`. The main
  window's copy of the settings now reloads after every save, so one writer no longer drops
  another's field.

- 2026-10-09 · [accounts] T-053 · Settings fields: `appTheme` (lower-case name, anything else is
  Classic), `themeTint`, `themeSaturation`, `themeDepth`, `terminalScheme` (`default` or `match`).
  A hued theme recolours only the grey tokens (backgrounds and lines at 30 % saturation times the
  slider, text at a third of that; depth moves backgrounds 1.2 % lightness per step) and leaves the
  status colours as they are. The window starts hidden (`visible: false`); main.tsx applies the
  saved look, renders, and shows the window two frames later, with a 5 s backstop in Rust. The
  last run's look is also kept in the page's local storage (`kolux.look`) for when the settings
  answer slowly; it is not relied on, since a killed app may not have written it. There are no
  pop-out windows yet; any later window loads the same page and gets the same look.

- 2026-10-09 · [accounts] T-054 · Settings fields: `appearanceMode` (`system` | `light` | `dark`,
  anything else is System), `terminalLightScheme` (true unless false), `uiLook` (`classic` | `new`),
  `firstScreen` (`agents` | `board` | `terminals`). A profile whose settings already hold anything
  but have no `uiLook` is Classic; an empty one is New; main.tsx writes the answer down on the
  first start so it does not change later. NOTE for the merge: every existing dev profile
  (main checkout included) therefore opens Classic, without the screen switcher, until New is
  picked in Settings > General. Light mode turns the grey tokens over (backgrounds 1 - 0.7 x
  lightness, text 1 - lightness) and darkens status colours by a quarter; warn / danger literals
  became tokens for light mode only (dark keeps the measured values). The window sets
  `data-mode` and `color-scheme` on the root. Settings links: `openSettings(page, section)` in
  `src/settings/pages.ts`; sections carry `data-section`. The shortcut-policy setting itself
  does not exist yet; the link is proved on Shortcuts > Commands and keys, and the keymap
  notice's "Shortcuts settings" button opens the Shortcuts file section. The terminal picker's
  "Kolux dark" is now called "Kolux", since it turns light in light mode.

- 2026-10-09 · [accounts] T-057 · Settings field `confirmCloseRunning` (true unless false). A pane
  started with a program (an agent) counts as live while it runs; a shell counts as live while a
  process has it as its parent (Windows process snapshot, `pgrep -P` elsewhere, `src-tauri/src/procs.rs`).
  A failed check closes without asking. The confirm focuses Close tab, so Ctrl+W then Enter closes;
  Escape or a click outside keeps the tab. Panes in this build split into separate cells, never into
  one tab, so the one-question-per-split-tab rule is in place (`closeTab` takes every pane key of a
  tab) but has nothing to act on yet; the rest is named on T-102. Settings pages now share
  `src/settings/useSettings.ts`.

- 2026-10-09 · [accounts] T-055 · Settings field `confirmWorkspaceDelete` (false skips the question
  for a clean workspace only). `workspace_remove` now takes `force` and `stamp` and re-checks before
  deleting; the stamp is HEAD plus the porcelain lines, so any new, changed or committed file
  refuses a delete asked about earlier. The CLI's remove (cli.rs) still deletes as before, forced.
  Nested means another worktree of the same repository inside the folder; other projects'
  folders inside it are not looked for (ponytail note in projects.rs). No delete animation exists,
  so reduced motion has nothing to turn off. The move-to-sibling only picks a sibling that still
  has panes, so the window never lands on an empty workspace.

- 2026-10-09 · [accounts] T-036 · Settings fields: `disabledAgents` (ids switched off),
  `agentOptions` ({id: {command, args, env}}, args split on spaces with double quotes keeping a
  part together, env one NAME=value per line), `agentPermissions` ("manual", anything else is
  Yolo), `defaultAgent` "" now means no default (Auto). An agent's own default arguments replace
  the built-in ones and the permission mode leaves them alone. Kolux's account variable wins over
  a user variable of the same name. No new no-prompt switch was added for other agents (that
  stays with T-056). Reading these fields from an old Kolux profile waits for the compat import task.

- 2026-10-09 · [accounts] T-037 · CPU is a share of the whole machine (every core), 0 to 100, so
  one busy core on this PC reads about 5 %. The status bar figure is still the main process's
  working set alone, while the Kolux row adds the WebView processes (about 500 MB against 38 MB
  here). Console host processes belong to the app's tree on Windows, so they count under Kolux,
  not under a session. A session's tree is found by parent ids (ponytail note in resources.rs).

- 2026-10-11 · [accounts] T-135 · the window checked is each provider's shortest one with a figure
  (5-hour, else weekly, else monthly), as USAGE-010 words it; a busy week behind a quiet 5 hours
  gives no line. The warning sits in the chooser's footer above Start. Dev builds expose
  `window.__koluxUsage(provider, figures)` so the live check can set 85 % and 90 %; release builds
  do not have it.

- 2026-10-11 · [accounts] T-136-a · T-136 split: -a is the usage alerts (USAGE-009) and the launch
  warning (USAGE-010, already built in T-135); -b keeps the Stats & Usage page, the analytics
  overview and the token-tracking switches (USAGE-011..013). Alerts are sent from the Rust side
  through the Tauri notification plugin (MIT/Apache-2.0). In dev builds Windows files them under
  PowerShell's name; an installed build shows Kolux RS. The master notifications switch is T-026's
  and the tray dot T-324's (noted on those lines).

- 2026-10-11 · [accounts] T-138 · DT-A3: no save-aside or mirrored copies of the system login (ACCT-017, ACCT-020 amended); managed accounts live in their own folders and a switch is one locked write, so a launch can never see a half-made change.
- 2026-10-11 · [accounts] T-138 · ACCT-018's "place the account runs": Kolux RS runs every account on this Windows install, so email + organisation decide sameness; a second runtime (WSL) would add itself to `same_account`.
- 2026-10-11 · [accounts] T-138 · the Codex personal-vs-business label goes to T-138-b: the workspace kind is only in undocumented token claims; for now each row shows its own last sign-in time.
- 2026-10-11 · [accounts] T-138 · Codex warnings: a missing sign-in file (after 30 s) is Needs sign-in, a failed sign-in check is Needs re-auth (the T-092 card said Needs sign-in for the latter; ACCT-019 names both).

- 2026-10-11 · [accounts] T-139 split: -a is ACCT-032's built-in model step (built), -b is ACCT-023 + ACCT-064 (pane account memory and the restart prompt, PTY foreground checks: HAND TO FABLE), -c is ACCT-027 (Grok's session file and credit figures need a public source); ACCT-031 moved to T-141, which builds the same `kolux account` commands (CLI-014).
- 2026-10-11 · [accounts] T-139-a · ACCT-032 over the earlier seats test: an agent with no built-in list now has no model step at all (it used to show only Program default).

- 2026-10-11 · [accounts] T-141 · DT-A4: account commands refuse every flag they do not take (environments, pairing codes and remote targets alike) instead of ignoring remote targets as CLI-014 said; spec/20-cli.md amended.
- 2026-10-11 · [accounts] T-141 · A Claude account added from the command line is not made active (as with Add Account in Settings); a Codex one is (as Settings does). The macOS Keychain restore is in T-043-d.

- [accounts] T-145-a · Tango light uses its bright yellow (#fce94f) as is, so yellow text is pale on white; a darker yellow would read better but stops being Tango. Kept the card's palette.
- [accounts] T-145-a · the terminal's light/dark answers follow the app's mode (System, Light, Dark), not the terminal background, so Match app theme and Kolux dark answer the same way.

- [accounts] T-147 · with no menu bar yet, a status bar hidden from its right-click menu comes back from Settings > Appearance > Show status bar; the View menu item waits for the menu bar (T-248).
- [accounts] T-147 · DT-A5: the bar has no agent items left to hide when an agent CLI is missing (the usage chips were retired), and its copy stays English until language packs; saved item lists drop ids this version does not have.

- [accounts] T-148-a · catalogue palettes are the schemes' own published values, unchanged; Solarized Light's bright white equals its background, so some PowerShell input colours read faint there, as they do in other terminals.
- [accounts] T-148-a · pasted schemes must be one Windows Terminal scheme object with a name and hex colours (purple/brightPurple/cursorColor accepted); a name already in the list is refused rather than replaced.

- [accounts] T-148-b · the font fields apply when a suggestion is picked, on Enter or on leaving the field, not on every keystroke (a half-typed name would flash the whole window into the fallback font).
- [accounts] T-148-b · App font and Editor font sit in the Interface section; the Editor font has no editor to draw yet (T-323), so for now it is only saved.

- [accounts] T-148-c · DT-A6: the title bar app name is off by default (DESIGN.md draws it nowhere) and the Automations button is on by default until the command palette exists; SET-020's card says shown and hidden. Confirm or flip.

- [accounts] T-148-d · DT-A7: the divider starts at 6 px with no colour and panes not in focus start undimmed; SET-023's card says 3 px and dimmed. Confirm or flip.

- [accounts] T-143: a default agent outside Claude Code, Codex and Grok also leads the dropdown (SESS-004 keeps the default first), so up to four rows show before the fold; the search box shows only when more than three agents are installed; Grok and the rest draw the plain shell glyph until T-335 brings vendor marks.

- [accounts] T-096-a: the shortcut search matches keys as a substring of the written or drawn chord with spaces and plus signs removed, so Cmd+D also finds Cmd+Down; no command sits behind a feature flag yet, so SET-008's flag rule has nothing to leave out today.

- [accounts] T-096-b: Reset takes the command out of this platform's section; when the all-platforms section still overrides it, the shipped default is written into this platform's section instead so the default really returns. Removing a command's last chord leaves it disabled (null in the file), the same as Disable. A recorded chord that clashes is still saved; the resolver drops it as SET-010 says, and the row keeps a Reset button because the file still holds the override.

- 2026-10-09 · [core] T-025-a: Kolux RS keeps its hook scripts in `~/.kolux-rs/agent-hooks` and
  adds its own entries beside the old app's in Claude's settings (DT-C1), so both apps can run
  on this PC until the old one retires; the identity header is built by Kolux into
  `KOLUX_HOOK_IDENTITY` (DT-C2). The hooks install unconditionally at every start (STAT-002's
  switch is T-120). The installer has NOT yet run against Txais's own
  `G:\Dev\claude-config\settings.json`: the auto-mode classifier refused the builder a copy of
  that file (self-modification), so the live proof used a scratch `CLAUDE_CONFIG_DIR`; the first
  launch of Kolux RS on this PC will add twelve `.kolux-rs` entries to that file (T-025-d).

- 2026-10-09 · [core] T-025-b: the Codex trust fingerprints are taken from Codex's own
  `hooks/list` answer rather than recomputed (DT-C3); the Devin skip in the Claude script is not
  built because no public source names the variable (DT-C4). The installer has NOT run against
  Txais's own `~/.codex`: the classifier refused the builder that write, so the proof used a
  scratch `CODEX_HOME`; the first launch of Kolux RS on this PC will add eight `.kolux-rs` groups
  to `~/.codex/hooks.json` and eight trust entries to `~/.codex/config.toml` (T-025-e for the
  real-session proof). A Kolux RS started from a shell that carries `CODEX_HOME` (a pane of the
  old app does) installs into that home instead, as COMPAT 3.4 says.

- 2026-10-09 · [core] T-025-c: "queued" is never produced by a hook event; it is the session queue's
  state (DT-C5). Claude's background-task list carries no truncation mark in its public shape, so
  the "partial" rule of the roster card is not built (DT-C6). The rust test
  `projects::tests::saving_a_folder_that_cannot_be_made_fails_and_keeps_the_old_one` failed once in
  three full runs (its `remove_dir_all` of the temp profile, a Windows file-lock race) and passed
  alone and on the reruns; not touched, it is not this lane's file.

- 2026-10-11 · [core] T-026-a: the notification settings live under Kolux RS's own keys,
  `notifyOnFinish` (true by default) and `quietMinutes` (10 by default); the importer task maps the
  old app's saved choices onto them (DT-C7). The desktop notification is not gated by the unread
  mark, only the toast and the mark are (one notification per event, as the card asks).

- 2026-10-11 · [core] T-026-b: the permission look is TERM-055's question mark (the card names no
  glyph), shared by blocked and waiting; a shell's header keeps Ready / Ended (code) as its words
  for the idle and stopped entries (TERM-020), the hover text says "Stopped: exit code N". No card
  or COMPAT rule contradicted, so no DECISIONS row.

- 2026-10-11 · [core] T-026-c: the Inbox's buttons read Open and Answer and open the terminal
  pane, since the Code view they are named after does not exist yet (DT-C8); a blocked agent is
  listed under needs you beside permissions and questions; the done-today stamp is the moment the
  window saw the state move, so a finish that happened before the window was open is not listed.

- 2026-10-11 · [core] T-027: deferred to T-326 (ordering, not a contradiction; no DECISIONS row).
  The Thought-row rules were copied onto the T-326 PLAN line so they are not lost.

- 2026-10-11 · [core] T-028-a: a blocked agent's chip reads Stopped (the card's word) while the
  pane header keeps the vocabulary word Blocked; STAT-022's cause text is T-039. The answer keys
  are Enter / Esc for Claude Code's dialog and y / n for Codex's approval modal, typed into the
  pane through the terminal, not a protocol; the card's file link is the file's name with the
  full path in its tooltip until an editor exists. The duration on a chip counts from the moment
  the window saw the state move. No card or COMPAT rule contradicted, so no DECISIONS row.

- 2026-10-11 · [core] T-029 and T-030: deferred to their feeders (T-098; T-082 / T-083 / T-089 /
  T-325). Ordering, not a contradiction; no DECISIONS row.

- 2026-10-11 · [core] T-003b-fix-a: the top bar is a three-column grid (left group, switcher,
  right group) instead of an absolutely centred switcher. The switcher is centred on the window
  while the right group fits in its half (at 1920 it sits at 855..1065, DESIGN.md's figure); below
  about 1540 px the right group keeps its width and the switcher moves left (70 px at the 1400
  default) instead of covering the search box. DESIGN.md section 4 notes the rule; no DECISIONS
  row (the review named this fix).

- 2026-10-12 · [core] T-010-fix: the paste rule of the paste card is now its own module,
  `src/terminal/paste.ts` (`attachPaste(textArea, paste, held)`), so the two rules the review asked
  for have a test without a browser: a paste into pane B's text area reaches B only, and a paste
  made while the opening prompt is still owed waits and goes in after it, oldest first. The
  listener is removed when the pane unmounts. Live, with two shells open, a paste event carrying
  "echo PASTED-INTO-PANE-B" dispatched into Terminal 2 landed there and Terminal 1 stayed at its
  prompt (`evidence/T-010-fix-paste.png`). A real Ctrl+V from the keyboard is Txais's by-hand
  check: the driver cannot put text on the system clipboard. No DECISIONS row.

- 2026-10-12 · [core] T-013-fix-a: with no project yet, Mod+N and the sidebar's New workspace
  button open the add-project form instead of a name field that can only say "Add a project
  first." (`createOpens()` in `src/projects/model.ts`, tested); with a project the name field opens
  as before. Proved on a fresh state folder: Ctrl+N on the empty sidebar showed the Add project
  form (`evidence/T-013-fix-a-no-project.png`). That reads the create-workspace card's "works even
  before any project exists" as a door to adding the project, so no DECISIONS row. The two rules
  T-013 left out, the overtaken create and the stand-in tab, now have an owner, T-013-c.

- 2026-10-12 · [core] T-013-fix-b: `safe_name()` no longer drops an emoji it has no word for.
  The fourteen table emoji keep their short word; any other symbol becomes its Unicode name in
  lowercase words (crate `unicode_names2` 4.0.0, MIT / Apache-2.0 and Unicode-DFS-2016, both on
  the deny.toml allow list), so a joined emoji names each of its parts: "ship it 🧑‍💻" cleans
  to ship-it-adult-personal-computer. Joiners, variation selectors, emoji tags, skin tones and
  combining marks say nothing (`silent()`), so a thumbs-up with a skin tone is thumbs-up-sign
  and a decomposed é keeps its e. That is a Unicode name, not a shortcode, for emoji outside the
  table: DT-C9. The pane header now shows the name exactly as typed: `ProjectsPanel` hands the
  window a folder-to-typed-name map beside the owner map, `nameOf()` in `src/workspaces.ts`
  (tested) looks a pane's folder up by content, and `App.tsx` passes it as the pane's title when
  no job title is set. Proved live: typing "Ship it 🧑‍💻" previewed branch
  ship-it-adult-personal-computer (`evidence/T-013-fix-b-preview.png`), and the created
  workspace's pane header, sidebar row and branch chip read "Ship it 🧑‍💻" over that branch
  (`-header.png`). The tab strip keeps its program word (TERM-040). The projects test that
  removes its temp folder no longer panics when Windows still holds the store file for a moment
  (it flaked once in T-025-c and once here).

- 2026-10-12 · [core] T-003b-fix-b: DESIGN.md names the two additions the look got in T-003b:
  section 6 the strip's "+ New tab" button (86 x 28 at x 1302..1388 in a 1400 px window, 12 px
  from the right edge, the layout group's border and type) and section 7 the pane header's split
  button (between Expand and "+", 24 px hit target). In the tab strip a browser tab now shows the
  globe where a terminal tab shows its program's mark (`App.tsx`). The native web view cannot be
  clipped by the pane's rounded corners, so `.pane.browser .pane-body` keeps a 1 px side margin
  and a 12 px bottom margin: the ring and the bottom curve stay visible around the page
  (`styles.css`; the web view follows the body's rect as before). Proved live with a shell and a
  browser tab in one cell (`evidence/T-003b-fix-b-browser.png`: globe on the New Tab tab, the
  page 1 px inside the ring and 13 px above the pane's bottom edge). Nothing pure to unit-test;
  the capture is the check. The projects test flake has its real cause: two tests shared the
  temp folder "profile4" and wiped each other when run in parallel; the second now has its own,
  and the full suite passed three runs in a row. No DECISIONS row.

- 2026-10-12 · [core] T-007-a-fix: the installed-agent scan starts from the search path a fresh
  shell would get, not from this process's PATH. On Windows `shell_path_dirs()` in `agents.rs`
  reads the machine Path (HKLM Session Manager\Environment) then the user Path (HKCU Environment)
  with `RegGetValueW` asking for a plain string, which expands `%SystemRoot%` and the like on the
  way out; a read that fails gives nothing and the process PATH stands alone. `search_dirs()` is
  shell path, then process PATH, then the usual install folders, each folder once as before. The
  `windows-sys` crate already in the tree got its `Win32_System_Registry` feature; no new crate.
  The test reads the real machine Path and checks it holds `system32` with no `%` left, that a
  missing value reads as `None`, and that every existing shell-path folder is among the walked
  ones. On macOS and Linux the shell's path is not read (a login shell would have to be spawned):
  the process PATH plus the install folders stand for it, recorded as DT-C10.

- 2026-10-12 · [core] T-008-b-fix: the foreground half of the start-line card is closed by a
  decision, not a poll (DT-C11). An agent Kolux starts is the pane's own program (`pty.rs`
  `program_command`, no shell in between), so the pane is credited to it from `terminal_spawn`
  until `terminal-exit`: exact, free, and already what the header, tab mark and account
  variables go by. An agent typed into a shell pane is credited by its hooks when it has them
  (the shell's children inherit `KOLUX_PANE_KEY`, T-025), and not at all when it has none; a
  process-tree poll with command-line reads is what that last case would cost, and nothing
  shown today depends on it. The command-line matcher is not orphaned any more: the account and
  key variables of a new pane call it (`claude_accounts`, `claude_key`, `codex_accounts`), so
  its stale "first caller is the poll" note and dead-code attribute went. No behaviour change,
  no new test.

- 2026-10-12 · [core] T-012-b-fix: chords pressed inside a browser page reach the app. Pages get
  no Tauri capability (by design), so the channel is a navigation: `browser.rs` gives every tab
  an initialization script (main frame only) that catches Mod+L, Alt+Left / Alt+Right (Mod+[ /
  Mod+] on a Mac), Mod+R and mouse buttons 4 and 5 on the way down, stops the web view's own
  handling, and calls `location.assign("kolux-chord:<action>")`; the tab's `on_navigation`
  handler recognises the four actions, emits `browser-chord` {id, what} and cancels the
  navigation (nothing reaches the network or the OS; a cancelled navigation never starts a
  page load, so the history stays untouched). For Mod+L the back end also hands the keyboard
  to the app's web view. `App.tsx` runs the same `browserAction` for a forwarded chord as for
  one pressed in the app, for the tab that sent it, and makes that split the focused one (a
  click into a page never reaches the app, so its focus could be stale). The toolbar history
  moved to `src/browser/history.ts` (`started`, `can`): a load with nothing asked that lands on
  the neighbouring entry is the page's own back or forward and moves the cursor instead of
  adding an entry. Proved live on the lane app with example.com and iana.org: Alt+Left in the
  page went back with back and forward both lit, Alt+Right went forward, the mouse back button
  went back, Ctrl+L put the cursor in the address bar with the text selected, no dialog
  appeared (`evidence/T-012-b-fix-chords.png`). Tests: `chord_of` and the script's contents in
  Rust; `history.test.ts` for the entries. Still open: a page's `pushState` and app chords
  such as Ctrl+T / Ctrl+W pressed inside a page (not browser-scope; they stay with the page).

- 2026-10-12 · [core] T-014-b-fix: `kolux-dev worktree create` stops refusing a prompt with no
  agent named. The app picks the agent the way the first-prompt card says: the settings' default
  agent when it is installed, else the first installed one in catalogue order (`fallback_agent`
  in `cli.rs`, sharing `default_agent` with the worker start); with no agent installed the call
  fails and says so; a create with neither prompt nor agent still makes a bare worktree with no
  agent tab. The flags nobody acts on yet are named instead of swallowed: `--setup run`,
  `--run-hooks` (on create and rm) and `--comment` each add a sentence to a `warnings` list in
  the result, and `main` prints every one as `warning: ...` on stderr whether or not `--json`
  was asked, so a script that counts on setup scripts learns they did not run. `issue:` is a
  working worktree selector now (it reads the issue number recorded with the worktree's origin;
  `projects::origin` is public for it). `identity:` and `active` stay refused, with the accepted
  forms listed, by DT-C12. Tests: the parse test accepts the prompt alone; the create-and-remove
  test checks the fallback agent against the real catalogue, the three warnings, `issue:12`,
  `issue:99` not found, and the two refusals. No live proof: the CLI has no window part.

- 2026-10-12 · [core] T-039-a: a Claude Code session that halts says why. The StopFailure hook's
  `error` becomes a cause (`hooks::stop_cause`: rate_limit is `limit`; authentication_failed,
  oauth_org_not_allowed and verification_required are `signin`; everything else `error`) and
  `error_details` rides along; `status.rs` keeps a `Stop { cause, detail, resetsAt }` on the
  session while it is blocked, ignores further failure reports in the same episode (one history
  line), drops it when a turn reaches done or a session boundary passes, and reads a failure after
  a Kolux cancel as interrupted and one with no error as nothing. The Board chip's second line
  and the pane header's tooltip read `Limit reached · 5-hour limit` (`stopLine` in
  `terminal/notify.ts`, shared by `board/chip.ts` and `TerminalPane`). The stopped notification
  says `stopped: limit reached` with the reset time or the details, once per episode (the state
  does not change on the second report), behind a new 'Agent Stopped' switch (`notifyOnStopped`,
  default on) separate from 'Agent Task Complete'. A sign-in stop calls `claude_account_check`
  once so the existing main-window SignInNotice shows the lapsed account (STAT-046). `resetsAt`
  is always empty until T-039-b reads the status line. Kimi and Codex report no cause (DT-C13).
  Live: posted a rate_limit StopFailure to the lane app's hook endpoint for the Claude pane; the
  Board card read Stopped / Limit reached · 5-hour limit and the header tooltip the same
  (`evidence/T-039-a-stopped.png`). Not live-proven: the desktop notification and the sign-in
  recheck (no lapsed account to hand).

- 2026-10-12 · [core] T-039-b: Claude Code's status line feeds Kolux. At start the hook installer
  also takes the `statusLine` slot in Claude's settings (`hooks::install_claude_status`, padding
  and the rest of the object kept) with a bash command that saves the report to a temp file,
  posts it through `~/.kolux-rs/agent-hooks/claude-status.cmd` to the endpoint's new
  `/claude-status` route, then runs the status line the user had (written once to
  `claude-status-prev.sh`, run only when that file exists) from the same file, so whatever they
  had keeps drawing; a stale Kolux command from another home is replaced, not chained. The route
  checks the token (403) and the pane identity (400), reads `context_window.used_percentage`
  (else input tokens over window size) and the `rate_limits` windows (kind, percent used, reset
  as ISO stamp or seconds/ms, kept as ms), writes the windows to kv `claudeRateLimits`, and when
  a window is used up writes when it lifts to kv `claudeUsageLimitResetsAt` and raises
  `claude-key` so the Claude card re-reads. The top-bar pill (`usage/ClaudePill.tsx`) shows
  "Claude N% left" from a used-up window first, else the weekly one, else the 5-hour one, from
  the last report at start (`claude_usage`) and each `claude-usage` event after; hovering lists
  each window with its reset time. The pane header's gauge draws the pane's context fill as an
  arc with the figure. A limit stop now carries the reset time (`status::LIMIT_RESETS_AT`) when
  it is still ahead, so the tooltip, chip and notification say "resets at …". Live: posted a
  report for the Claude pane → pill "Claude 63% left", hover with both windows' reset times,
  gauge 42% (`evidence/T-039-b-usage.png`); wrong token → 403, figures unchanged; a used-up
  5-hour window plus a rate_limit StopFailure → header "Limit reached · resets at 1:48 AM", kv
  both keys written, Settings' Claude card "It can be used again at 1:48 AM". Not live-proven:
  a real Claude Code session driving the command (the pane's Claude Code read the real user
  settings, not the scratch ones, as in T-025-a), and the chained previous status line.

- 2026-10-12 · [core] T-040-a: the usage meters. The status-line route now keeps the context
  reading in tokens (`Usage.contextTokens`/`contextWindow`: the stated total, else input plus
  cache writes plus cache reads from `current_usage`, else the stated percentage applied to the
  window) and `src/usage/meter.ts` works the figures out: `contextFill` against the 200k cap
  (always on until T-041 wires the USAGE-006 switch through its argument), else the model's own
  window, past full reads 100, a zero window 0; `shortTokens` (84k, 1.3M); `planOf` gives a
  Claude pane the Claude account's 5-hour and weekly percentages and a Codex pane Codex's, nothing
  for other agents or a failed read; `meterOf`/`meterText` build the card meter and its hover
  text. The two top-bar pills publish what they read into `src/usage/plan.ts` (a tiny external
  store) so the Board needs no second read. `src/usage/Ring.tsx` is the ring: track and arc, no
  number, coloured `warn` at 70% and `danger` past 90% (new theme token `danger` #e5484d, not
  measured); the pane header's gauge uses it with the figure, and agent tabs show it at 10 px with
  the meter words as its title. On the Board a card gets `.meter` under the chip row: the bar
  (width = fill, same colours), `84k / 200k`, and `5-hour 38% · Weekly 63%`; the bar only after a
  reading, plan figures without one, no meter with neither (shells and browser tabs never get
  one). Live: posted two reports (84k of 200k with both windows; 190k of 1M through
  `current_usage`) → tab rings plain and red with hover text, header gauges 42% and 95% red, Board
  cards with bars, token counts and plan lines, the shell card bare (`evidence/T-040-a-meter.png`).
  Not built here: the Agents view rings, footer and usage line (T-040-b, needs T-050 and T-263).

- 2026-10-12 · [core] T-041-a: the 200k cap, the weekly pill, and safer Claude figures. `cap.rs`
  holds the setting (`contextCap200k`, never saved = on, switch on the new Settings > Agents page)
  and `apply`, run by `terminal_spawn` on the start line and environment it hands the PTY, so the
  pane's saved start line never carries the cap and a rerun adds it exactly once: a program
  credited as Claude gets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` unless Kolux's own environment
  already names it (any case) or `--autocompact` is on the line; one credited as Codex gets
  `-c model_context_window=200000 -c model_auto_compact_token_limit=180000` ahead of any `--`
  unless its arguments already name either key, `--profile`/`-p` or `--oss`; everything else is
  untouched and no agent's file is written. The meters (`contextFill`, `meterOf`) now take the
  switch from settings. The top-right pill follows USAGE-008/VIEW-008: a `<span>` (the click that
  opened Settings is gone; Ctrl+, does that), one part per provider with the weekly window alone,
  only while that CLI is installed and a weekly figure is known (Codex's refused sign-in still
  shows), tinted on the 70/90 scale of used, hovering `Weekly limit: N% left, resets in 2d 4h` or
  `reset time unknown` (a past reset time reads `resets now`); with nothing to show the pill is
  hidden. USAGE-021's status-line part: the status script sends `X-Kolux-Config:
  %CLAUDE_CONFIG_DIR%`, a report from a folder other than the active account's (or from a managed
  folder while the default sign-in is active) is dropped, and a report carrying one window is
  merged over the stored windows so the other stays. Live in the lane app: a Codex pane opened with
  the cap on runs `codex.cmd --dangerously-bypass-approvals-and-sandbox -c
  model_context_window=200000 -c model_auto_compact_token_limit=180000` (Win32_Process command
  line, parent the app), one opened after switching the cap off on Settings > Agents runs without
  the overrides, and the switch writes `contextCap200k` to settings.json both ways; Claude's
  variable is covered by the unit test only (a process's environment is not readable from outside).
  Posted status-line reports: weekly 85% used → pill `Claude 15% left` yellow, hover `Weekly
  limit: 15% left, resets in 2d 4h`; a five-hour-only report leaves it; one with
  `X-Kolux-Config: C:/somewhere/else` is dropped; 95% → red (`evidence/T-041-a-cap.png`). Not
  built: the provider's usage service and the hidden-terminal usage screen (DT-C14), the
  status-bar usage item switch (item list is T-148), the resume after a limit (T-041-b).

- 2026-10-12 · [core] T-041-b: resume after a limit (USAGE-007). New `resume.rs`: `pick_reset`
  takes the stop's own time, else the used-up weekly window, else the used-up 5-hour window (past
  or not-used-up ignored, a used-up weekly without a time never swapped); `Resumes` keeps one wait
  per pane, fires it once per reset time (times a minute apart count as one) a minute after the
  reset, only when the pane's foreground is the `claude` program Kolux started (`Terminals::program`
  from the spawn's credited agent), expires it when a shell or another program is in front or the
  terminal is gone, keeps waiting while the foreground cannot be told up to half an hour past the
  due time, and persists the waits under kv `claudeResumeWaiting` so a restart restores them with a
  two-minute settle and past resets skipped. `hooks.rs` schedules from every reported status whose
  stop is a limit; `terminal_write` cancels the pane's wait on the user's own keystrokes;
  `save_settings` clears on off and picks up blocked panes on on; a 15-second thread in `lib.rs`
  types the prompt (`Terminals::write`) and logs a refusal once to `logs/kolux.log`. Live in the
  lane app with a real Claude Code pane (a `/` pasted into its input first, so the typed line
  became an unknown slash command and no request went out): switch on, a posted weekly-100%
  report with a reset 75 s ahead plus a `StopFailure rate_limit` event → kv held the wait, and
  about 2.5 min after the post Claude Code showed `Unknown command: /The ... Args from unknown
  skill: usage limit has reset. Please continue where you left off.`, the wait gone; a second
  reset with a keystroke pasted into the pane after the stop → the wait dropped at once; a third
  reset with the pane closed → the wait dropped at its due time (`evidence/T-041-b-resume.png`). The rest of T-045's card (panels list only the view's
  accounts) is moot: one active Claude account per window.

- 2026-10-12 · [core] T-042-b: decision only, no code. The rest of the Codex-figures card
  (USAGE-022) named three routes; two are dropped in DECISIONS §7 DT-C15: Codex's own usage
  service (address, request and reply are not public documentation; the clean-room rule forbids
  learning them from the old app) and the status screen in a hidden terminal (Codex's interactive
  `/status` card: it needs a session open, which the card's own title rules out, its layout is
  undocumented and would have to be scraped, and it is drawn from the same rate-limit snapshots the
  app-server `account/rateLimits/read` call returns). The two rules that take the 5-hour figure or
  the reset-credit count "from the service" are therefore moot: `codex_usage.rs` already reads both
  windows and `rateLimitResetCredits.availableCount` from the background process. Card amended;
  its acceptance boxes stay as T-042-a left them. Gates re-run clean.

- 2026-10-12 · [core] T-043-d: the sign-in upkeep switch (ACCT-006). `ClaudeAccounts.tsx` shows
  "Leave sign-in upkeep to Claude Code" under the managed accounts once one exists, bound to
  settings field `claudeSignInUpkeepByClaudeCode` (absent = on, OD-01/DT-A2); switching it off
  saves the field and calls `claude_account_check` (ACCT-012, `claude auth status --json` in the
  account's folder, hidden, 20-s limit) so a lapsed account is flagged straight away; on hides the
  Needs sign-in chip and the main-window notice (the chip now follows the switch too). Kolux-side
  renewal is not built (DECISIONS §7 DT-C16): Anthropic's token service is not public
  documentation and the clean-room rule forbids learning it; Claude Code refreshes its own sign-in
  in every pane. The macOS keychain rules of the managed-account card go to T-043-e (needs a Mac).
  Live in the lane app with a stand-in account row seeded into the lane profile's kv (config
  folder that never signed in): switch on → no chip, no notice; off → settings file `false`, the
  check ran, the row went `stale`, chip "Needs sign-in" and the notice "Claude account
  fake@example.test is no longer signed in" appeared; on → both hidden, file `true`; off again →
  flagged within 12 s (`evidence/T-043-d-upkeep.png`). The very first check in a never-used
  folder did not flag the row: Claude Code's first run there took longer than the 20-s limit, so
  the account stayed as it was until the next check. Seed row, folder and setting removed after.

- 2026-10-12 · [core] T-017-c: decision only, no code beyond a comment. Pre-trust for Cursor and
  Copilot (the rest of the pre-trust card) is dropped in DECISIONS §7 DT-C17: Copilot's public
  technical reference lists `~/.copilot/config.json` as "internal state" and documents no
  trusted-folder key; Cursor's CLI reference documents `--trust` as "headless mode only" and the
  changelog says a trust decision is "saved" without saying where; Cursor's editor docs describe
  workspace trust (off by default) but not its storage. The clean-room rule forbids learning
  either shape from the old app. `trust_folders` keeps returning 0 for both agents, the launch
  proceeds, and the agent's own trust prompt, when it appears, is the user's to answer; a pasted
  starting prompt may then be swallowed, which is the card's stated risk. Gates re-run clean.

- 2026-10-12 · [core] T-018-c: the Source Control bulk bar (the rest of GIT-002). `model.ts` gained
  `rowOrder` (conflicts, staged, changes, untracked, each path once), `select` (plain click keeps
  one row and clears it when it was the only one, Ctrl/Cmd toggles, Shift spans from the anchor in
  list order, rows no longer listed drop out) and `bulk` (which of the selected rows Stage and
  Unstage each cover); the panel marks rows `aria-selected`, shows the bar above the list while
  anything is selected (`N selected`, `Stage k`, `Unstage m`, a close button; Esc clears), and
  each button sends its rows to the existing `scm_stage` in one call. Six model tests first failed
  (`select is not a function`), then passed; tsc 0. Live in the lane app on the proof worktree with
  one staged and three untracked files: click + two Ctrl-clicks read "3 selected · Stage 2 ·
  Unstage 1" (`evidence/T-018-c-bulk.png`); Stage 2 left `git status` with three `A` rows and the
  bar at Stage 0 · Unstage 3; a Shift-click spanned all four rows; Esc emptied the bar; Unstage 3
  put all four back to untracked. One fix during the proof: three clicks fired in the same tick
  each read the stale selection, so the updater now takes the previous state. Proof files removed.

## Last 10 passes  (date · task · result · evidence)
- 2026-10-12 · [core] T-145-b · done: pane replies to colour/light-dark questions reach the program as win32-input-mode key events; early output matched by pane key; OSC 10/11 questions measured as swallowed by the console (DT-C20, T-145-c); evidence/T-145-b-console.txt, T-145-b-answers.png, T-145-b-startup.png
- 2026-10-12 · [core] T-139-b · done: per-pane Codex account, restart keeps it or refuses when stale, account-change keep/restart prompt and removed-account prompt on running Codex panes only; DT-C19; evidence/T-139-b-accounts.txt, T-139-b-prompt.png, T-139-b-restarted.png, T-139-b-removed.png
- 2026-10-12 · [core] T-134-a · done: terminal read (log, cursor paging, --screen via xterm rows), send (paste, Enter, interrupt, prompt receipt, retry), wait (exit, tui-idle, blocked states, quiet fallback); T-134-b split off for the agent hooks commands; DT-C18; evidence/T-134-a-cli.txt, T-134-a-claude.png, T-134-a-app.png
- 2026-10-12 · [core] T-018-c · done: Source Control bulk bar, click/Ctrl/Shift selection, Esc clears, Stage k and Unstage m in one git call; evidence/T-018-c-bulk.png
- 2026-10-12 · [core] T-017-c · done, decision only: Cursor and Copilot pre-trust dropped (DT-C17), no documented trust file or interactive flag
- 2026-10-12 · [core] T-043-d · done: sign-in upkeep switch, lapsed warnings follow it, check on switch-off; Kolux-side renewal dropped (DT-C16); keychain rules → T-043-e; evidence/T-043-d-upkeep.png
- 2026-10-12 · [core] T-042-b · done, decision only: usage service and hidden /status screen dropped (DT-C15); background app-server read is the only Codex figures route
- 2026-10-12 · [core] T-041-b · done: resume after a limit (resume.rs, timer, foreground check, cancel on typing, persisted waits); evidence/T-041-b-resume.png
- 2026-10-12 · [core] T-041-a · done: 200k cap (env for Claude, -c overrides for Codex, Settings > Agents switch), weekly-only read-only pill with tint and countdown, config-folder guard and one-window merge on status-line reports; DT-C14 drops the usage service; evidence/T-041-a-cap.png
- 2026-10-12 · [core] T-040-a · done: Board card meter (context bar in tokens + plan %), tab ring, header gauge colours, USAGE-005 maths against the 200k cap; Agents view parts split to T-040-b; evidence/T-040-a-meter.png
- 2026-10-12 · [core] T-039-b · done: statusLine slot taken with a chaining bash command, /claude-status route → kv claudeRateLimits + claudeUsageLimitResetsAt, pill 'Claude N% left', header gauge, limit stop carries the reset; evidence/T-039-b-usage.png
- 2026-10-12 · [core] T-039-a · done: StopFailure → stop cause limit/signin/error kept while blocked, chip + header tooltip say it, 'Agent Stopped' switch, sign-in stop re-checks the account; Kimi/Codex no cause DT-C13; evidence/T-039-a-stopped.png
- 2026-10-12 · [core] T-014-b-fix · done: prompt without --agent falls back to the default or first installed agent, `warnings` list + stderr for inert flags, `issue:` selector; `identity:`/`active` refused by DT-C12; cargo test 116
- 2026-10-12 · [accounts] Git & worktrees gear move · not done: the sidebar gear's Git & worktrees part is T-116-a (b67005e), which is on main and lane/orchestration but not on lane/accounts, and this lane may not merge; move it into src/settings/GitPage.tsx (with the one-line DESIGN.md amendment) after main is merged into this lane, or in the merge itself
- 2026-10-12 · [accounts] T-096-b · done: `recordKey`, `editChords`, `removeChord` and the `recording` flag in src/keys/record.ts; `keybindings_write` (one command into this platform's section, through a temp file, refuses a broken file and bad ids or values, emits `keybindings-changed`) in src-tauri/src/keybindings.rs; KeymapProvider `save` and reload on change; the window's shortcuts stand aside while recording; recorder on each Shortcuts row; tests in src/keys/record.test.ts, src/settings/shortcutRows.test.ts and two Rust tests · evidence/T-096-b.txt, evidence/T-096-b-1-recording.png .. -5-clash.png
- 2026-10-12 · [accounts] T-096-a · done: `resolve` records clashes and takes an ignore list (src/keys/keymap.ts); `shortcutRows`, `filterRows`, `MAX_QUERY` in src/settings/shortcutRows.ts; `keywords` on actions; KeymapProvider ignores disabled agents' new-tab commands; Shortcuts page rebuilt; tests in src/settings/shortcutRows.test.ts and src/keys/keymap.test.ts · evidence/T-096-a.txt, evidence/T-096-a-1.png .. -3.png
- 2026-10-12 · [accounts] T-143 · done: `agentRows`, `searchAgents` (name, word start, alias, initials, command; over 40 characters ignored) and `wantsTerminal` in src/launch/agents.ts; PlusMenu search box, Show more toggle, Blank terminal row and Manage agents; sidebar row opens a shell tab, pane row splits a shell; tests in src/launch/dropdown.test.ts · evidence/T-143.txt, evidence/T-143-1-folded.png .. T-143-5-manage.png
- 2026-10-12 · [accounts] T-148-d · done: Appearance fields `paneDividerWidth`, `paneDividerDark`, `paneDividerLight`, `paneDim` (clamped, colours #rrggbb only) as CSS vars `--divider-width`, `--divider`, `--pane-dim`; the grid gap and ground follow them, unfocused pane content fades over 140 ms; Panes card under Terminal; DT-A7 + SET-023 amendment · evidence/T-148-d.txt, evidence/T-148-d-1.png .. T-148-d-3.png
- 2026-10-12 · [accounts] T-148-c · done: new `src/chrome/chromeItems.ts` (`titleBarAppName`, `tasksButton`, `automationsButton` with DT-A6 defaults, folded summary), Window & Sidebar switches and status bar item ticks in Settings > Appearance, TopBar app name, ProjectsPanel Tasks row and Automations button follow the switches; DT-A6 + SET-020 amendment; View-menu submenu on T-248, used/left usage on T-041 · evidence/T-148-c.txt, evidence/T-148-c-1-defaults.png .. T-148-c-5-automations-hidden.png
- 2026-10-12 · [accounts] T-148-b · done: Appearance page in three `<details>` sections with folded summaries (SET-016), links unfold their section (SettingsPage), App font / Editor font fields with installed-font suggestions (new `src-tauri/src/fonts.rs` `list_fonts`, `src/settings/fonts.ts`), fonts kept in `appFont` / `editorFont` and cached for the first frame; icon chooser, search unfolding, terminal font and editor noted on T-300, T-246, T-247, T-323 · evidence/T-148-b.txt, evidence/T-148-b-1-sections.png .. T-148-b-7-link-unfolds-window.png
- 2026-10-12 · [accounts] T-148-a · done: new `src/terminal/schemes.ts` (catalogue, search, Windows Terminal import, tidy on load), `src/settings/SchemePicker.tsx` (scheme lists), theme.ts dark/light picks (`terminalScheme`, `terminalSchemeLight`, `terminalCustomSchemes`), Appearance page Terminal colours rebuilt · evidence/T-148-a.txt, evidence/T-148-a-1-pickers.png .. T-148-a-5-custom-terminal.png
- 2026-10-11 · [accounts] T-147 · done: new `src/chrome/statusItems.ts` (items, `readStatusBar` with old-list clean-up, `toggleItem`), `StatusBar.tsx` (right-click menu, popover guard, hidden items), App wiring (`statusBarVisible`, `statusBarHidden`), Settings > Appearance status bar switch; DT-A5 + VIEW-096 amendment; menu-bar item added to T-248 · evidence/T-147.txt, evidence/T-147-1-menu.png .. T-147-5-appearance-switch.png
- 2026-10-11 · [accounts] T-145-a · done: `src/theme.ts` (Tango light scheme, `currentDark`), new `src/terminal/colourMode.ts` (DEC 2031 subscribe, CSI ? 996 n query, CSI ? 997 ; 1|2 n reports), `TerminalPane.tsx` wires it to theme changes; T-145-b split off and HAND TO FABLE: Windows ConPTY swallows OSC 4/10/11 "?" and CSI ? 996 n / ? 2031 h before xterm sees them (proved live: a cursor-position query came back, the colour and mode queries did not); custom themes moved to T-148 · evidence/T-145-a.txt, evidence/T-145-1-light-tango.png, evidence/T-145-2-dark-kolux.png
- 2026-10-11 · [accounts] T-145-b · HAND TO FABLE: the colour and light/dark questions programs ask are swallowed by Windows ConPTY (system conhost via portable-pty) before xterm sees them; fixing it is PTY work (a pass-through console or answering in the Rust reader)
- 2026-10-11 · [accounts] T-141 · done: new `src-tauri/src/cli_accounts.rs` (app side: `account.list`, `account.add-begin` makes a throwaway folder in the profile's `sign-in-temp`, `account.add-finish` hands it to the same `sign_in` Settings uses and deletes it, a sign-in whose throwaway copy cannot be deleted is failed and not kept; CLI side: the login runs in the user's terminal with inherited input and output, a console handler passes Ctrl+C to the login only, then the folder is removed, a closing terminal removes it on the way out; an unknown begin command reads as a Kolux too old for accounts); `cli.rs` parses `account add [--agent claude|codex]` and `account list` (Claude when left out, an empty `--agent` refused, other flags refused as "this machine"), help text; `state.rs` `Store::dir`; windows-sys Console feature; 5 new Rust tests + 1 parse test; live: stand-in claude/codex, app not running -> `app_unreachable` and no folder made, add Claude -> listed, same again -> refused, add Codex with a printed device code -> listed and active, list text and JSON, Ctrl+C sent part-way -> "Sign-in interrupted; nothing was added" and the throwaway folder empty · evidence/T-141.txt, T-141-1-settings-after-cli-add.png
- 2026-10-11 · [accounts] T-140 · BLOCKED, not started: AUTO-014 saves a run's output when the run ends, and runs only ever reach "dispatched" until T-072 (AUTO-012, truthful end status) is built; its token and cost figures read the same unpublished Claude Code / Codex usage logs (Needs Txais, token analytics)
- 2026-10-11 · [accounts] T-139-b · not started · HAND TO FABLE: ACCT-023 and ACCT-064 need each pane to remember the account it started on, a check of the pane's foreground program (PTY) and an in-pane restart prompt that restarts Codex once the shell is ready; terminal-pane internals of the core lane.
- 2026-10-11 · [accounts] T-139-a · done: `modelsFor` returns nothing for an agent without a built-in list, `seatReady` counts such a seat ready once its AI is picked, the chooser hides the model group for it; seats test extended (5 listed agents end in Program default, Aider has none and is ready, Codex without a model is not); live: stand-in claude and aider on PATH, chooser opened from the pane's New session menu, Aider picked -> no model group and Start enabled, Claude picked -> model group with Start disabled · evidence/T-139-a-1-aider-no-model-step.png, T-139-a-2-claude-model-step.png. Seen: the Codex usage poller ran the real installed Codex for the system default's figures (top bar showed Codex 100% left); later live checks put a stand-in codex first on PATH.
- 2026-10-11 · [accounts] T-138 · done: `claude_accounts.rs` (duplicate check `same_account`, `activate(None)` for the system default, `remove` deleting only folders inside Kolux's own, refused during a sign-in), `codex_accounts.rs` (system default, `remove` with `remove_dir_patiently`, 30 s `missing_now` grace, roll-back only when no sign-in file exists, custom-provider refusal, read only), shared `AccountRow.tsx` with inline Remove confirm, Codex re-read on focus; 5 new Rust tests, 8 new front-end tests; live: seeded fake accounts with stand-in claude/codex on PATH, clicked rows, removed the active Claude and Codex accounts and the System default took over, folders gone · evidence/T-138-1-lists.png, T-138-2-remove-asks.png, T-138-3-removed-system-default-active.png
- 2026-10-11 · [accounts] T-136-b · BLOCKED, not started: USAGE-011 counts agent turns from the status hooks (T-025 unbuilt; the window only knows a program is running); USAGE-012 / 013 read Claude Code and Codex log files whose format has no public description (Needs Txais, token analytics)
- 2026-10-11 · [accounts] T-137 · BLOCKED, not started: the Claude / Codex token panels and cost figures parse the same unpublished log formats (Needs Txais, token analytics); the Grok credits panel waits for a Grok usage source
- 2026-10-11 · [accounts] T-136-a · done: `src/usage/alerts.ts` (`dueAlerts` 80 % and 95 % once per window and reset time, both at once when first seen over 95 %, nothing without a reset time, window wording for 5-hour / weekly / monthly / n-day / n-hour / other; `useUsageAlerts` watches the shared figures, waits for settings and the saved record) + `alerts.test.ts` (6 tests); `src-tauri/src/usage_alerts.rs` (fired record in state.db, saved before the notification shows) + tauri-plugin-notification; Settings > Notifications usage-alerts switch; live: Codex 70 % gave nothing, 82 % one toast, 84 / 90 % and a reload nothing more, 97 % the 95 % toast, a new reset time at 30 % then 81 % the 80 % toast again, Claude first seen at 97 % two toasts, no reset time none, switch off none, switch on again the one due; all read back from Windows' notification history; build / clippy / 132 Rust + 174 front-end tests / cargo-deny / tsc / licence check / plan-check green; no orphan process · evidence/T-136-a.txt, evidence/T-136-a-*.png
- 2026-10-11 · [accounts] T-135 · done: `src/usage/launchWarn.ts` (`launchWarnings` one line per provider at 80 % or more of its shortest window with a figure, seat count or the one agent named, reset time when known; the shared figures store the Codex pill now publishes to) + `launchWarn.test.ts` (4 tests: three Claude seats at 85 %, a second provider, 80 % exactly, 40 %, no figures, no usage source, the shortest-window rule); `ChooserPane.tsx` shows the lines above Start (1 more test); live: three Claude seats with 85 % set gave one line counting 3 sessions with its reset time and Start enabled, 40 % gave none, a real Codex seat (0 % used) gave none, Codex at 90 % added its own line; build / clippy / 132 Rust + 168 front-end tests / cargo-deny / tsc / licence check / plan-check green; no orphan process · evidence/T-135.txt, evidence/T-135-*.png
- 2026-10-11 · [accounts] T-037-fix-look · done: `styles.css` top bar is a three-column grid (`1fr auto 1fr`) instead of an absolutely centred switcher, a 1100 px rule that leaves the search box its icon, `.chooser-foot`; `ChooserPane.tsx` Start moved out of the scrolling body into a footer; a new test in `ChooserPane.test.ts` (Start sits in a footer after the scrolling body; failed before the move) and `scripts/evidence/overlap.mjs` (live check, exit 1 on overlap; before: switcher 595-805 over search box 771-961 at 1400 px, after: 517-727 against 771-961, and at 884 px 160-370 against 414-445 with the close button inside the window); live: Start reachable and starting a PowerShell session from a 6-pane chooser; seen, not fixed (core lane's tabs): a chooser that gets a tab beside it is named "Terminal N" on its tab · evidence/T-037-fix-look.txt, evidence/T-037-fix-look-*.png
- 2026-10-09 · T-024 · done: `src/terminal/tabs.ts` (one badge per tab, unread rule with the late-event drop) + `tabs.test.ts`; `TerminalPane.tsx` `onBell` (xterm's bell) and the `unread` mark; `App.tsx` unread panes and rows, window focus, in-view rule, `noticed` note, tab badges; `ProjectsPanel.tsx` takes the unread set from the window; `styles.css` badges. Live: Claude workspace via CLI, Ctrl+T second tab, `/exit` sent to the hidden Claude tab → bell badge, pane glow, row unread, note "Claude finished"; clicking the tab → green check, marks gone; `[char]7` from the hidden shell tab → bell badge and "Terminal 3 rang the bell". Evidence: `evidence/T-024-unread.png`, `evidence/T-024-viewed.png`, `evidence/T-024-bell.png`.
- 2026-10-09 · T-023 · done: `src/terminal/status.ts` (header word, tone, icon, age, needs-you cycle) + `status.test.ts`; `TerminalPane.tsx` finish time, minute tick, glow until focused, `onNeedsYou`; `App.tsx` Ctrl+J handler across workspaces; `styles.css` glow and age. Live: agent workspace via CLI, split shell focused, `/exit` sent to the agent → "Done · just now" with a glow, "1m ago" after a minute, glow gone on focus; Ctrl+J with nothing waiting left focus where it was. Evidence: `evidence/T-023-glow.png`, `evidence/T-023-focused.png`.
- 2026-10-09 · T-022 · done: `src/projects/rows.ts` (states, ranks, smart order, status and PR groups, setting keys) + `rows.test.ts`; `App.tsx` derives each folder's strongest state and change time from its panes and offers `saveSetting`; `ProjectsPanel.tsx` grouping, sort, filter form, state dots, unread marks, accent bar, 5 s branch poll; `styles.css`. Live: two CLI-made agent workspaces, one agent ended → done above working under Smart; Status grouping headers; hand-marked unread on the shown row; `git checkout -b renamed` in zeta's folder showed on its row. Evidence: `evidence/T-022-status.png`, `evidence/T-022-branch.png`.
- 2026-10-09 · T-021 · done: `cli.rs` (parse refuses the retired `--parent-workspace`, an empty `--parent-worktree`, a non-numeric or zero `--issue`; dispatch works out the parent from the calling folder, `--parent-worktree` in the same project or `--no-parent`, records the origin and echoes it; `calling_worktree`), `projects.rs` (`set_origin` / `origin` under `workspaceOrigins`, forgotten on removal), tests extended (65 Rust tests); live with `kolux-dev` rebuilt and the dev app up: from inside zeta `worktree create --name b --agent claude --prompt hi --issue 7 --comment "from zeta" --json` → envelope with parent = zeta's path, madeBy cli, issue 7, comment; row b appeared with zeta still selected and claude.exe running "hi" under the app; `--name c --activate` → c selected; `--name d --prompt hi`, `--parent-workspace name:zeta`, `--issue nope` → exit 1 with their messages; `rm --worktree name:b --force` and c → rows back to zeta, the Claude process gone; build / clippy / 65 Rust tests / 76 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-021-background.png, T-021-activate.png
- 2026-10-09 · T-020 · done: `projects.rs` (`resolve_workspaces_dir(env, setting)`, `KOLUX_WORKSPACES_DIR` read there, `PlaceInfo.fromEnv`, `set_place` makes an absolute folder and fails when it cannot; 2 tests, 65 Rust tests), `model.ts` (`placeFieldAction`; 1 test, 76 front-end tests), `ProjectsPanel.tsx` (Enter/Escape/composing, blur retry, Browse… for the folder, env label); live in the dev app started with the variable padded with spaces: Use default + Save showed the variable's folder with the "(from KOLUX_WORKSPACES_DIR)" label and env-proof was created at `<env>\repo\env-proof`; a folder under a file failed with "cannot be made" and kept the typed text, leaving the field after the blocker was removed saved it; Escape put the saved folder back; a typed folder + Enter put typed-proof at `<folder>\repo\typed-proof`; build / clippy / 65 Rust tests / 76 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-020-env.png, T-020-failed.png, T-020-folder.png
- 2026-10-09 · T-019 · done: `include.rs` (new: include-file lines, kolux.yaml shared list, tidy rules, copy, junction link, unlink; 3 tests), `git.rs` (`worktree_remove` keeps a branch in use elsewhere and reports its commit, `worktree_move`, `delete_branch_if_at`, `dirty` sees submodule work, `ref_ok` guard; 1 test), `projects.rs` (per-repo turn, `Created.warnings`, `remove_workspace(force)`; 1 test), 63 Rust tests; sidebar form asks "Discard and remove" after a refusal, warnings join the created note; live in the dev app on the throwaway repo with `.gitignore`, `.worktreeinclude` (`.env`, `*.log`) and kolux.yaml (`node_modules/`, `src`): Remove on the dirty zeta → "zeta has uncommitted changes. Remove it anyway? That work is lost." with work.txt still there; New workspace "bring along" → created from origin/main, note names `*.log` and `src`, `.env` copied, `node_modules` a junction to the main checkout showing its dep.js, `git status --porcelain` empty on branch bring-along; removal of a worktree with untracked files took the two-step path, of a clean one the one-step path, the main checkout's node_modules/dep.js survived both; build / clippy / 63 Rust tests / 75 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-019-dirty.png, T-019-created.png
- 2026-10-09 · T-018-b · done: `scm.rs` gains `Status.rewritten` / `Status.base`, `remote()` and `scm_remote` (push, pull, sync, fetch, ff, force --force-with-lease, publish --set-upstream origin, rebase after fetch); 1 Rust test over a bare remote (58 total); `nextStep` and `remoteItems` in `src/scm/model.ts` with 2 tests (75 total); panel: main button + Remote menu; live in the dev app on the throwaway repo with a bare origin: edit → "Stage all" → "Commit" held with "Write a message first" → typed → commit 6495041 → "Push 1"; menu read "Push 1 commit" on, "Pull · Nothing to pull", "Sync ↓0 ↑1", "Fast-forward · Already current", "Publish branch · Already published", "Rebase from origin/main · This is the base branch"; push → "Create pull request"; `feat` branch with a commit → "Publish branch" → published (`feat...origin/feat`); main moved from a second clone, menu Rebase from origin/main → `[ahead 2, behind 1]`, `git cherry HEAD @{u}` one `-`, button "Force push with lease" → pushed, counts 0; build / clippy / 58 Rust tests / 75 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-018-b-menu.png, T-018-b-lease.png
- 2026-10-09 · T-018-a · done: `scm.rs` (status / stage / commit, 4 Rust tests, 57 total), `src/scm/model.ts` + `SourceControlPanel.tsx` (2 front-end tests, 73 total), right card on Mod+Shift+G / Mod+L / the top bar button; live in the dev app on a throwaway repo: 1 edit + 4 new files listed as Changes 1 / Untracked 4, the three `docs/` rows staged by row, Ctrl+Enter in the box made commit 66f5f87 `Add the docs folder` (git log 2 → 3), the draft survived a switch to zeta and back, a refusing pre-commit hook gave `Commit blocked by a hook` + `nope, said the hook: README needs a title` + Fix with AI with no commit made, the Staged section's minus unstaged it; build / clippy / 57 Rust tests / 73 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-018-a-sections.png, -staged.png, -committed.png, -blocked.png
- 2026-10-09 · T-017-b · done: `trust.rs` gains `codex_config_file` (`CODEX_HOME` else `~/.codex`), `codex_key` (real path, lower-cased on Windows), `trust_codex` (`toml_edit` in-place edit of `[projects."<key>"] trust_level = "trusted"`, rest of the file byte for byte, locked, tmp + rename), `trust_folders` routes `codex`; `checked_keys` and `write_whole` shared with Claude; `toml_edit = "0.25"` in Cargo.toml; 1 Rust test (53 total); live with `CODEX_HOME` unset: `worker-start --spec "say hi and stop" --agent codex` → `trust: true`, the pane shows Codex (GPT-6-Sol) answering "Hi!" with no trust prompt, `~/.codex/config.toml` gained the worktree and the lower-cased repo root (12 → 14 `[projects…]` headers, everything above untouched); a second worker in the same worktree → `trust: true`, file hash unchanged; worktree removed; build / clippy / 53 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-017-b-codex.png
- 2026-10-09 · T-017-a · done: new `src-tauri/src/trust.rs` (`claude_config_file`, `claude_key` real-case forward-slash key, `trust_claude` locked read-modify-rename write that only touches the flag, `trust_folders` per agent, `trust_folders_cmd` command); `Ctx.claude_config` and a trust step in `worker_start` with a `trust` field in the receipt; App.tsx `pretrust(agent, dirs)` called from the new-tab path, `startSeats` (one call per agent for all its seats) and `startIn`; `serde_json` `preserve_order`; 3 Rust tests (52 total) + the cli dispatch test checks the trust write; live in the throwaway "repo": `worker-start --spec "say hello and stop" --agent claude` → `trust: true`, the pane shows Claude answering "Hello." with no trust menu (prompt reached it), `.claude.json` gained `C:/Users/XiongT/kolux-rs/workspaces/repo/nimble-starfish` and the repo root with the flag; a second worker in the same worktree → `trust: true`, the entry unchanged and no new entry; worktree removed, both workers gone; build / clippy / 52 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-017-a-no-prompt.png
- 2026-10-09 · T-016 · done: `terminal.rs` marks program sessions (start time, last output) and `program_in(dir, since)`; `projects::create_fresh` shared by the UI command and the CLI; `cli.rs` `orchestration worker-start` parse (`WORKER_FLAGS`, `check_worker_start` with every refusal from CLI-035/ORCH-016/018/019), `worker_start` dispatch (task made/found under `orchestration.tasks`, worktree made or picked, `created` + `start` notify, readiness wait, receipt, `orchestration.dispatches`), `text_of` worker line, help text; front end `CliWorkspace` `start` kind → `startIn` with extra args and a pane title; 2 Rust tests (49 total; dispatch test runs the full flow with a 1 ms timeout); live in the throwaway "repo": `worker-start --spec "add a test" --agent claude --json` → `status: ready` in 1.8 s, `dispatch-1`/`task-1`, worktree hazel-otter, terminal 2; sidebar row hazel-otter + background tab "add a test" (Claude, Running) while the view stayed on main; opening the row shows one tab with Claude's trust prompt; `claude.exe --permission-mode auto "add a test"` under the app; `--worktree current --base-branch main` refused with exit 1 before anything was made; `worktree rm --worktree path:… --force` took the row, tab, process and folder away; build / clippy / 49 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-016-ready.png, evidence/T-016-one-tab.png
- 2026-10-09 · [accounts] T-037 · done: new `resources.rs` (`owners` counts each process tree under one session only and the rest under the app, `total` adds memory and CPU up with the app's working set standing in when its row is missing, `percent` clamps to the machine's cores, Win32 Toolhelp + process memory/times + GlobalMemoryStatusEx, `ps` and /proc/meminfo elsewhere; new `resources` command), `Terminals::list`, windows-sys features ProcessStatus / SystemInformation / Threading, `src/status/resources.ts` (grouping) and `ResourceManager.tsx`, the status bar memory figure opens it; 2 Rust tests (86 total), 1 front-end test (121 total); live: five sessions (three in a throwaway repository, one home terminal, one left from before a reload and shown in no pane) listed in their groups with memory figures, a session running a child read about twice the memory, ending it after the in-row question stopped it and its child while the other four kept running, ending the hidden one left the remaining three, a busy loop read 5.4 %; build / clippy / cargo-deny / tsc / JS licence check / plan-check green; no orphan process · evidence/T-037.txt, evidence/T-037-*.png
- 2026-10-09 · [accounts] T-036 · done: `agents.rs` (`StartLine` gains `program` and `env`; `start_line` applies the saved permission mode and the agent's command, arguments and environment; `split_args`, `parse_env`; `agent_start_line` reads the settings), `terminal.rs` (`terminal_spawn` takes `env`), App and TerminalPane pass them through, `src/launch/agents.ts` (`disabledAgents`, `offeredAgents`, `switchAgent`; no default means the first agent), new `src/settings/AgentsPage.tsx`; 1 Rust test (84 total), 1 front-end test (120 total); live: the page listed Claude Code and Codex, Claude given powershell.exe with `-NoLogo -NoExit -Command "echo $env:KOLUX_T036"` and KOLUX_T036=hello opened from New tab and printed hello, Manual dropped both agents' prompt-skipping flags, Claude switched off left Auto selected, no chip and a New tab menu without Claude, a saved default of aider showed "Aider (saved, not found right now)" through Refresh; build / clippy / cargo-deny / tsc / JS licence check / plan-check green; no orphan process · evidence/T-036.txt, evidence/T-036-*.png
- 2026-10-09 · [accounts] T-055 · done: `git.rs` (worktree `locked` read from `git worktree list --porcelain`, `changes` keeps the porcelain lines' leading space), `projects.rs` (`RemoveCheck`, `remove_check`, `removal_refused`: stamp, nested, locked never forced, changes need force; new `workspace_remove_check`, `workspace_remove` checks again before deleting), `src/projects/deleting.ts` (question rules), ProjectsPanel question lists up to five changes with a force box and shows a refusal in place, `workspace.delete` shortcut wired, `src/settings/GitPage.tsx`, `activeAfterRemove` picks the sibling used last; 1 Rust test (83 total), 4 front-end tests (119 total); live: lima with a changed and an untracked file listed both, Remove without the box refused and kept the folder, a file added while asking refused with the stamp message and listed three, forced delete removed it and moved to kilo with the list still at scroll 200, a locked workspace showed its reason with Remove disabled and a direct forced call was refused, the question switched off in Settings deleted clean golf from Ctrl+Shift+Backspace at once while dirty hotel still asked; build / clippy / cargo-deny / tsc / JS licence check / plan-check green; no orphan process · evidence/T-055.txt, evidence/T-055-*.png
- 2026-10-09 · [accounts] T-057 · done: `src-tauri/src/procs.rs` (has a process started a child), `terminal_busy` command and `Terminals::busy` (program panes live while running, shells while they have a child, ended or failed reads idle), each session keeps its process id, `src/terminal/closing.ts` + `CloseAsk.tsx` (the question naming the tab), every close in App goes through `closeTab`, the pane's own Close defers to the window, Settings > Terminal & sessions gets the switch; 1 Rust test (82 total), 3 front-end tests (115 total); live: a background tab running ping closed from its x asks "Close “Terminal 1”?" with Close tab focused, Escape keeps it, Close tab removes it and ping is gone, an idle shell closes with Ctrl+W without a question, Ctrl+W and the pane header's close button on a busy tab ask too, with the switch off a busy tab closes at once; build / clippy / 82 Rust tests / 115 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process · evidence/T-057.txt, evidence/T-057-*.png
- 2026-10-09 · [accounts] T-056 · NOT BUILT, left unticked, needs Txais: the permission check that guards this build session refused the edit that gives more agents their no-prompt start (Gemini CLI `--yolo`, Aider `--yes-always`, Goose `GOOSE_MODE` auto) as an unsafe-agent change, so nothing was changed. Claude Code (`--permission-mode auto`) and Codex (`--dangerously-bypass-approvals-and-sandbox`) already start that way from the agent catalogue. The rest of the card (the user's default arguments replacing the built-in ones, Kilo Code's refused argument dropped) waits with it. Txais decides: allow it for the build agent, or build it in a session of his own · no evidence
- 2026-10-09 · [accounts] T-054 · done: `src/theme.ts` (mode and light-terminal fields, `isDark`, light `buildTheme`, light terminal scheme, `followSystemMode`, two-frame transition hold on a light/dark switch), `src/settings/pages.ts` (ten pages, repo pages, `openSettings`, last page), `src/settings/general.ts` + `GeneralPage.tsx` (look and first screen), `ShortcutsPage.tsx` (file, errors, every command and its keys), SettingsPage rebuilt on the page list with lazily loaded pages and scroll-to-section, Appearance gets Interface > Mode and the light-scheme switch, App starts on the saved first screen and hides the switcher under Classic, the screen-cycle shortcut does nothing under Classic; 7 new front-end tests (112 total); live: existing profile opens Classic with System = light (Windows is in light mode) and the General page greys Agents and Board, New brings the switcher back, Board saved as first screen shows first after a restart, a fresh profile is written as New, Dark applies at once and System follows an emulated Windows switch to dark and back (#050405 / #fcfcfc), transitions held for two frames, light scheme on gives a #f6f6f6 terminal and off #0d0d0d, a link opens Shortcuts scrolled to its section, a repository adds an 11th entry with its own page; build / clippy / 81 Rust tests / 112 front-end tests / cargo-deny / tsc / JS licence check / plan-check green; no orphan process · evidence/T-054.txt, evidence/T-054-*.png
- 2026-10-09 · [accounts] T-053 · done: `src/theme.ts` (17 themes in wheel order, `readAppearance` / `writeAppearance` with unknown names as Classic and sliders clamped or defaulted, `buildTheme`, `previewOf`, `terminalFor` with a matched 16-colour palette, `applyAppearance` + `cachedAppearance`), `src/settings/AppearancePage.tsx` (swatches, preview, sliders, terminal picker, live apply and a 250 ms save), Settings gets an Appearance page, open terminals recolour in place, App applies the look on every settings read, the window starts hidden and is shown after the first themed frame (index.html, main.tsx, tauri.conf.json, `core:window:allow-show`, Rust backstop); 7 front-end tests (105 total); live: fresh profile Classic with sliders off, Teal on the whole window inside one frame, Moss saturation 0 grey and back, saturation 500 read as 160 and a word as 100, Match with Sky then Ember recolours a running PowerShell pane (#090e11 then #110b09) and Kolux dark puts it back (#0d0d0d), Rose saved while the app was closed is the first visible frame, an unknown name starts as Classic; build / clippy / 81 Rust tests / 105 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-053.txt, evidence/T-053-*.png
- 2026-10-09 · [accounts] T-043-d · HAND TO FABLE: Kolux-side renewal means Kolux sending the managed account's refresh credential to Anthropic's token service itself; that service's address, client id and answer are in no public Claude Code doc, so it cannot be built clean-room, and OD-01 (direct provider calls off) argues against building it at all, which is a call for Txais; the macOS keychain rules cannot be run or checked on this Windows PC; the switch alone (`claudeSignInUpkeepByClaudeCode` false) would only turn off Claude Code's upkeep with nothing in its place, so it was not shipped either; nothing changed, left unticked · no evidence
- 2026-10-09 · [accounts] T-042-b · HAND TO FABLE: Codex's own usage service is not in OpenAI's public Codex docs (only the background process's `account/rateLimits/read`, which T-042-a already uses), so its address and answer cannot be learnt clean-room, and the last route reads Codex's status screen in a hidden terminal (PTY screen parsing); nothing changed, left unticked · no evidence
- 2026-10-09 · [accounts] T-041 · HAND TO FABLE: blocked on T-025 and T-039 (carrying on after a limit needs the stop reason from the agent status hooks; Claude plan figures and the weekly pill need the status-line channel); the 200k window part could go alone (Claude Code's auto-compact variable, Codex's context-window and auto-compact overrides per run) but was not split off, to keep the task whole; the stored resume switch from T-045 waits for it; nothing changed, left unticked · no evidence
- 2026-10-09 · [accounts] T-040 · HAND TO FABLE: blocked on T-025 and T-039 (Board meters, tab rings and the Agents rings take their context and plan figures from Claude Code's status line, which needs T-039's report channel); nothing changed, left unticked · no evidence
- 2026-10-09 · [accounts] T-039 · HAND TO FABLE: needs T-025's agent status hooks (stop reasons, one notification per stop) and a token-checked local channel that Claude Code's status line reports figures through (hooks/IPC), none of which exists yet; the expired sign-in notice in the main window is already met by T-044's SignInNotice; nothing changed, left unticked · no evidence
- 2026-10-09 · [accounts] T-045 · done: `claude_own_sign_in` + `own_sign_in` (Claude Code's own sign-in reported on the Claude card only while panes run on it, warning when signed out), `auth_status` takes an optional folder, `codex_accounts::config_drift` / `top_level` and `drifted` ids in the Codex view, Codex rows marked Needs sign-in / Settings changed with Sign in again, Claude account rows marked Needs sign-in, `bad_arguments` (a Codex refusing its command line is no sign-in problem), the usage read reports a helper that quit before answering, the Claude card's resume-after-limit switch (`claudeResumeAfterLimit`, off by default), App reloads its settings copy on `settings-saved`; 4 Rust tests (81 total), 3 front-end tests (98 total); live with stand-in claude.exe / codex.exe and fake files only (no real sign-in): own sign-in shown as own@example.com, stand-in `claude auth logout` → Settings reopened → yellow "Claude Code is not signed in on this PC", a Codex account with `cli_auth_credentials_store = "keyring"` → Settings changed + Sign in again, a Codex that rejects its arguments → "This Codex version did not accept Kolux's sign-in command" and usage "quit before answering (exit code: 2)" with no sign-in flag set, resume switch turned on → settings.json true → app restarted → still on; build / clippy / 81 Rust tests / 98 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-045.txt, evidence/T-045-signed-in.png, evidence/T-045-signed-out.png, evidence/T-045-codex-args.png, evidence/T-045-resume-kept.png
- 2026-10-09 · [accounts] T-044 · done: `src/settings/SignInNotice.tsx` (main-window bar for a stale active managed Claude account or a Codex account with a sign-in error, hidden until both lists load, Sign in again with Signing in…), `src/settings/Attention.tsx` (reason → one fix, usage limit with its reset time and no button), `claude_key::Attention` with named reasons, `claude_account_check` (one `claude auth status` at start when Kolux looks after sign-ins), `mark_stale`, Codex sign in again in place, Codex sign-in errors set and cleared from usage reads, `open_install_page`, `settings-saved` event; 3 Rust tests (77 total), 6 front-end tests (95 total); live with stand-in claude.exe / codex.exe and fake sign-ins only (no real sign-in): stale account flagged at start and the bar shown, Sign in again → Signing in… → bar gone, stale again → bar back, upkeep handed to Claude Code → bar gone, Codex account with a sign-in error → bar, Sign in again → cleared and still active, usage limit → "It can be used again at 7:38 PM." with no fix button; build / clippy / 77 Rust tests / 95 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-044.txt, evidence/T-044-notice.png, evidence/T-044-signing-in.png, evidence/T-044-upkeep-on.png, evidence/T-044-codex.png, evidence/T-044-limit.png
- 2026-10-09 · [accounts] T-043-c · done: `codex_accounts.rs` (hidden `codex login` / `codex login --device-auth` with CODEX_HOME set to a private home per account, file credential store pinned in that home, device link and code shown only once both are printed, the new account made active, sealed vault copy, roll-back that never deletes a home holding a working sign-in, links and the code removed from errors, system-default login read as ChatGPT / API key / custom provider / signed out, `codex-accounts` event), Codex panes get the active home as CODEX_HOME, the usage pill reads that home first, `strip_ansi` keeps cursor-placed lines apart, `src/settings/CodexCard.tsx`; 4 Rust tests (74 total), 4 front-end tests (89 total); live with a stand-in codex.exe and fake sign-ins only (no real sign-in): Codex's own login reported, device view waiting then link + code with Cancel, connected as kim@example.com, a second account lee@example.com by the browser route, Cancel leaves two accounts and no half-made home, a failed code sign-in shows its reason with code and link removed, a Codex pane runs in the active home; %USERPROFILE%\.codex (11,903 files) byte-for-byte unchanged by SHA-256; build / clippy / 74 Rust tests / 89 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-043-c.txt, evidence/T-043-c-default.png, evidence/T-043-c-code-waiting.png, evidence/T-043-c-code.png, evidence/T-043-c-connected.png, evidence/T-043-c-browser.png, evidence/T-043-c-second.png, evidence/T-043-c-cancelled.png, evidence/T-043-c-failed.png, evidence/T-043-c-pane.png
- 2026-10-09 · [accounts] T-043-b · done (split; T-043-d holds the renewal opt-out switch, Kolux-side renewal and the macOS keychain rules): `claude_accounts.rs` (hidden `claude auth login` with CLAUDE_CONFIG_DIR set to a private folder per account and the 1-year key variable removed, 20 s hidden `claude auth status --json` for email and organisation, a failed add removes its folder, a failed re-auth restores the earlier credentials, unchanged credentials refused, links and codes scrubbed from errors, one sign-in at a time, Cancel, Make active, sealed vault copy, `claude-accounts` event), `claude_key::run_hidden` shared by both setups, Claude panes fall back to the active account's folder and drop an inherited key variable, `src/settings/ClaudeAccounts.tsx` + the Claude card's "Use my Claude account instead"; 6 Rust tests (70 total), 5 front-end tests (85 total); live with a stand-in claude.exe and fake credentials only (no real sign-in): empty list, browser step with Cancel, account added as sam@example.com · Stand-in Org, Cancel leaves the list and active account unchanged with no partial folder, failed re-auth keeps the row Active with the credentials file unchanged, a Claude pane gets the account folder and no key variable; build / clippy / 70 Rust tests / 85 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-043-b.txt, evidence/T-043-b-empty.png, evidence/T-043-b-browser.png, evidence/T-043-b-added.png, evidence/T-043-b-cancelled.png, evidence/T-043-b-reauth-failed.png, evidence/T-043-b-pane.png
- 2026-10-09 · [accounts] T-043-a · done (split; T-043-b ACCT-005/006, T-043-c ACCT-007): `claude_key.rs` (hidden `claude setup-token` in portable-pty answering ESC[6n, browser step seen from the first https:// line, key picked out of ANSI-stripped output, subscription line not final, 10-minute limit, cancel, single setup at a time, .cmd/.bat/.ps1 launcher → needs attention, status/connect/cancel/disconnect commands and a `claude-key` event, key handed to Claude panes only in key mode), `terminal_spawn` passes it as CLAUDE_CODE_OAUTH_TOKEN, `src/settings/` Settings overlay + Claude card, usage pill opens Settings; 7 Rust tests (64 total), 6 front-end tests (80 total); live: the real setup ran once by accident and connected (see Needs Txais: revoke that key), fake key now → "Renew in October 2027", fake key backdated 340 days → "runs out in 24 days (November 2026)" with Renew, new Claude pane in a throwaway worktree → /status "Auth token: CLAUDE_CODE_OAUTH_TOKEN" (401 with the fake key, no browser prompt), Disconnect → "Connect with a key that lasts a year"; build / clippy / 64 Rust tests / 80 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-043-a-browser.png, evidence/T-043-a-connected.png, evidence/T-043-a-renew.png, evidence/T-043-a-pane.png, evidence/T-043-a-disconnected.png
- 2026-10-09 · [accounts] T-042-a · done (split; T-042-b holds the usage-service and status-screen routes): `codex_usage.rs` (sign-in lookup account home → `CODEX_HOME` → `~\.codex`, nothing launched without one, API-key sign-ins reported as such; hidden `codex app-server` with CREATE_NO_WINDOW, initialize → account/read → account/rateLimits/read, 20 s limit, input closed then 3 s grace then the process tree stopped by force; windows placed by their own length, model-specific buckets ignored, reset credits from `rateLimitResetCredits`; refused sign-ins / dead refresh tokens → sign in again; errors scrubbed of paths and key-like text; one read per Codex home), `src/usage/` pill text and hover detail, `CodexPill` in the top bar; 5 Rust tests (57 total), 3 front-end tests (74 total); live: real sign-in → pill "Codex 100% left", hover "5-hour: 97% left, resets today 05:27 PM / Weekly: 100% left, resets Fri 12:27 PM / Limit-reset credits: 3 / Plan: plus", no codex.exe left afterwards; CODEX_HOME = a throwaway folder with fake tokens → yellow "Codex · sign in again", no figures, no window; build / clippy / 57 Rust tests / 74 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing; note: the first dev launch after a fresh compile quit by itself twice (no panic in the log), a second launch stayed up · evidence/T-042-a-figures.png, evidence/T-042-a-signin-again.png
- 2026-10-09 · [accounts] T-038 · done: `secrets.rs` (DPAPI seal/unseal with a `kolux-sealed:v1:` prefix, clear values from older profiles load as they are, settings fields `claudeOauthToken` / `xaiApiKey` kept out of `get_settings` and protected from `save_settings`, `secret_status` / `secret_set` / `secret_clear` commands, sealed vault files with read-and-reseal and move-aside, one-off pass 2 s after setup with `secretsSealingPassDone` in the store, profile folder limited to the user, `logs\kolux.log`); 4 Rust tests (52 total), 71 front-end tests; live with fake keys: a clear profile was sealed on first launch (settings + vault file, icacls shows only TxaisX\XiongT), still connected; a key set through `secret_set` and an attempted overwrite from the window left no key text in settings.json, still connected after quit and reopen; `shot.ps1` takes `-ProcessId`; build / clippy / 52 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-038.png, evidence/T-038.txt
- 2026-10-09 · [release] T-097 · done: with the app minimised behind another window, kolux-dev open restored it and put it in front (four times out of four) and exited 0; with the app closed and a stale cli.json left behind, open started it detached and exited 0 once it answered (4.4 s), and a second open started no second copy; a missing app program failed at once and a silent one after 60 s, both exit 1 · evidence/T-097-*.png, T-097-live.txt
- 2026-10-09 · [release] T-096 · BLOCKED, not started: the Shortcuts page is one of the ten Settings pages (SET-006 in T-054, not built), and a Settings screen already exists only on lane/accounts (T-043-a); a second Settings screen here would collide with it at merge. The pieces it builds on are on main already: the keybindings file reader (T-005, SET-011) and the keymap resolver with scopes in src/keys. Build T-096 after T-054 lands, and note its live test writes Txais's real ~/.kolux/keybindings.json (shared with the old app), so back it up and restore it byte for byte · no evidence
- 2026-10-09 · [release] T-095-b · done: with a made-up Claude config folder, a publish written before start was ignored and a new one turned up within a poll as "Launch Plan · repo · session 7c371ba6" with its image and an offline copy of its jsdelivr script (the failed cdnjs one kept its address, a file outside the folder was not copied); a Bash look-alike, prose and a failed publish were ignored; publishing again kept one entry and refreshed the open viewer to v3; a replayed old publish in a resumed file was ignored; a subagent's publish was kept; a network-share page was listed Unavailable and a WSL path Remote · evidence/T-095-b-*.png, T-095-b-live.txt
- 2026-10-09 · [release] T-095-a · done: two pages added through the real Windows file dialog listed newest first and opened in the viewer offline with their stored image; a file outside the page's folder was not copied and the frame could not fetch it or another entry's files; a link to example.com opened in Chrome while a link outside the entry did nothing; "sales quarterly" hid the other row and "sales quarterly chart" showed the no-match message; an 11 MB page gave an error toast and left the list alone; a network-share page was listed Unavailable without being read; removing the open entry closed the preview and deleted its stored folder · evidence/T-095-a-*.png, T-095-a-live.txt
- 2026-10-09 · [release] T-094-c · done: Ctrl+P then "panel" listed panel.tsx and sidepanel.md before ui/panel/util.ts and index.ts; the hover tooltip moved with the pointer across four points and showed the full path with the name in bold; Enter opened panel.tsx; with no ripgrep on PATH the dialog said how to install it, offered Retry and listed git's files; with a portable ripgrep it left out .next, .vscode and a nested worktree and put mod9 before mod10; 100,000 files listed in about 0.7 s on a debug build and ranked in 15-18 ms a keystroke · evidence/T-094-c-*.png, T-094-c-live.txt
- 2026-10-09 · [release] T-094-b2 · done: Ctrl+C then Ctrl+V copied a file into another folder and, pasted again where the name was taken, as "taken copy.txt" with the original untouched; dragging a folder together with one of its own files moved only the folder, and Ctrl+Z moved it back still open; holding a drag at the tree's bottom edge scrolled it 792 px in 2 s; a folder dropped in from the desktop onto a root that already held one of that name arrived as "lib copy" with its contents, and a junction in the same drop was refused; undo sent the dropped copy to the trash. The drop was driven by emitting Tauri's own drag events (a real desktop drag could not be aimed at this window from here) · evidence/T-094-b2-*.png, T-094-b2-live.txt
- 2026-10-09 · [release] T-094-b · done: the explorer creates files and folders (a taken name is refused and the original kept), renames inline with F2 (Enter or clicking away commits, Escape cancels, a letter-case-only rename is allowed, another file's name is refused), deletes the selection to the system trash after one question (two files went to the Recycle Bin with one confirmation), and Ctrl+Z brought both back; Ctrl+Y and Ctrl+Shift+Z redo; Alt+Shift+C and Ctrl+Alt+Shift+C copy the path and the relative path (read back from the Windows clipboard); a WSL share deletes for good after saying so; T-094-b2 holds copy, drag to move and desktop drop · evidence/T-094-b-*.png, T-094-b-live.txt
- 2026-10-09 · [release] T-094-a · done: Ctrl+Shift+E opens an explorer of the worktree on the right with the keyboard in it; Down, Right, Down, Enter opened the first file of the second folder; Up, Down, Home and End move the highlight, Right opens or steps into a folder, Left folds or climbs to the parent; Shift-click two rows apart selected three, Ctrl-click adds one; a 2000-file folder drew 55 rows at a time; hiding and showing kept open folders and the scroll; a folder junction expanded and a file symlink opened as a file; an unreadable file opened from the tree showed the failure with Retry and loaded after access came back · evidence/T-094-a-*.png, T-094-a-live.txt
- 2026-10-09 · [release] T-093-d · done: New tab > All Changes opens one tab with a section per changed file and side (staged and unstaged are separate sections, each tagged Staged, Unstaged or Untracked, with its changed-line count); sections keep an estimated height and draw as they scroll near; over 2000 changed lines a section waits for Load diff; each text section stops at 560 px and scrolls inside; images show before and after at natural size, other binaries are named; the Files button shows a resizable side tree (grouped by folder, name filter, jump, viewed boxes that stay off until the section has drawn); a viewed tick, the scroll position, the tree and its filter survive a tab switch; a file changed in a terminal redraws within 2 s and its tick clears; at 2035 changes the tab opened in about 1.1 s and a jump stayed put · evidence/T-093-d-*.png, T-093-d-live.txt
- 2026-10-09 · [release] T-093-c · done: a diff tab for one changed file, opened from New tab > Changed file diff... (staged, unstaged and untracked files listed; staged and unstaged are separate tabs, the header says which); starts inline (no line numbers for the old side) and switches to side by side; the ... menu turns on whitespace-only changes and line wrapping, both off at first; F7 and Shift+F7 and the header arrows step through changes, the arrows grey while there are none; an unstaged diff's right side is the working file, editable, with the unsaved dot and Mod+S; the sides are read again every 2 s, so a terminal edit shows and a file staged elsewhere keeps its text with a No unstaged changes note; Shift+wheel scrolls the side under the pointer sideways; markdown diffs are plain source · evidence/T-093-c-*.png, T-093-c-live.txt
- 2026-10-09 · [release] T-093-b · done: a markdown file opens in a rich, document-style view (Lexical) with a Rich | Source switch in its header, rich edits go into the same text so the unsaved dot, Mod+S and twin panes work as in source; Mod+Shift+V opens a read-only preview tab marked Preview that follows the open text live and is reused for the next file; a file over 600 KB opens in source with a banner whose Open anyway turns that tab rich; a file the rich view cannot show faithfully (tables, images, HTML, front matter, reference links, footnotes, rules, underlined headings, or any word lost on the round trip) stays in source with the reason; a rich view that fails to start shows the reason and Retry; Mod+Shift+O picks from the worktree's markdown files (git ls-files: ignored files and symlinked folders left out, 2000 cap, asked afresh each time); Mod+Shift+M makes untitled.md, untitled-2.md... at the worktree root, never overwriting, stopping after 100 · evidence/T-093-b-*.png, T-093-b-live.txt
- 2026-10-09 · [release] T-093-a · done (T-093 split into -a..-d, one card each): New tab > File... opens a file from disk in an editor tab (CodeMirror 6, coloured by language), the tab and header carry an unsaved dot that trailing whitespace does not set, Mod+S saves the focused editor only on the terminals screen (atomic write, CRLF files keep CRLF), a failed save is a toast and the dot stays, a file that will not load is tried 3 times then shows the reason with Retry, the same file in two cells is one text (typing shows in both, one save writes once and cleans both), caret, selection and scroll survive a trip to Board · evidence/T-093-a-*.png, T-093-a-board-trip.txt, T-093-a-crlf.txt, T-093-a-load-failed.txt, T-093-a-save-failed.txt, T-093-a-two-panes.txt
- 2026-10-09 · [release] T-092 · BLOCKED, not started: the Connect cards live on Settings > AI connections and the xAI key must be sealed (ACCT-008 rule, ACCT-009), and both exist only on lane/accounts (T-038 sealing, T-043-a Settings with AI connections, T-043-b managed Claude accounts); building them again here would duplicate that lane and break the never-plain-text rule. Build T-092 in lane/accounts or on main after that lane merges · no evidence
- 2026-10-09 · [release] T-091 · done: pnpm ship (AI or own message, merge never rebase, conflict stops with nothing pushed, --main lands and starts the release job, --no-release, --merge, --dry-run, --model), release job (own checkout, lock + one queued rebuild, stale after 3 h or a dead holder, patch bump, signed installer + .sig + latest.json + notes with hidden source marker, smoke test, print-only and no-publish rehearsals), CI in four shards with one result job, release workflow behind a 30-minute CI gate, workflow-check script; kolux-dev --version; 15 script tests; live against a throwaway bare repo: two ships 20 s apart landed on main and built 0.1.1 then 0.1.2 one after the other into a local publish folder, a conflicting ship left the remote untouched, a released main was skipped, the gate refused a failed CI run and wrote the summary, the four shards add up to the whole suite (40+35+22+13 = 110); build / clippy / 52 Rust tests / 110 front-end tests / tsc / cargo-deny / JS licence check / plan-check / workflow-check green; no orphan process after closing · evidence/T-091-ship-dry-run.png, evidence/T-091-ship-and-queue.txt, evidence/T-091-conflict.txt, evidence/T-091-dry-run.txt, evidence/T-091-no-publish.txt, evidence/T-091-ai-message.txt, evidence/T-091-ci-gate.txt, evidence/T-091-shards.txt
- 2026-10-09 · [release] T-090 · done: quiet schedule (30 min, remainder wait, focus merge, 1 h retry doubling to 6 h, offline silence + recheck 5 s after online, wake check, timeouts), automatic signed download with progress, ready pop-up once per version per launch, install on Restart or on quit, update card through every phase with Escape / Enter, dismiss, tip and release notes; 10 schedule + 14 card tests, 4 Rust tests; live against a stub feed on 127.0.0.1 signed with a throwaway key: quiet check downloaded 0.2.0 and showed the pop-up, card listed 5 notes with headings removed, Escape collapsed, Enter on the error ran Try again, quitting ran the stub installer with /P /UPDATE and no restart, clicking Restart to update closed the app and ran it with /R; build / clippy / 52 Rust tests / 95 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-090-ready-popup.png, evidence/T-090-card-ready.png, evidence/T-090-card-collapsed.png, evidence/T-090-up-to-date.png, evidence/T-090-downloading.png, evidence/T-090-error.png, evidence/T-090-quit-install.txt, evidence/T-090-restart-install.txt
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

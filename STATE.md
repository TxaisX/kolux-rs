# STATE
Status: RUNNING            (RUNNING | PAUSED | BLOCKED: reason)
Phase: 3                   (Phase 1 was done by the dirty-room team on 2026-10-06; Phase 2, the plan, on 2026-10-07)
Budget: 6 passes per day   (today: 25, date: 2026-10-09)
Next task: T-025 · STAT-001 / STAT-007 / STAT-008 … (status hooks)
Done: 38 / 351 tasks  ·  P0 parity: 0/228 cards

How to read this: `PLAN.md` holds the 351 tasks in build order; each names the spec cards it must
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
haiku; Codex: gpt-5.6-sol/high, gpt-5.6-terra/high, gpt-5.6-terra/medium, gpt-5.6-luna/low).
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
is open; the watcher is GIT-001's (T-033), the multi-row bulk bar is T-018-c and folder rows are
T-033's tree view.

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
The desktop notification and its settings are T-026.

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
Claude half still reads "unknown" until T-041.

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
its own panes (the ACCT-006 default under OD-01). The renewal opt-out switch and Kolux-side
renewal are T-043-d.

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

## Needs Txais

13 open decisions in `DECISIONS.md` section 2 are marked "confirm". The loop builds each one's
recorded default until told otherwise; nothing here blocks a pass.

- [accounts] 2026-10-09 · **Please revoke one Claude Code long-lived key.** During the T-043-a live
  check, clicking Connect ran Claude Code's real key setup; your browser was already signed in to
  claude.ai, so it finished by itself in a few seconds and made a real 1-year key on your account.
  Nobody read or printed it; it was stored sealed in the lane's test profile and removed with
  Disconnect about two minutes later, but it stays valid at Anthropic until revoked. Revoke the
  long-lived Claude Code key created 2026-10-09 around 12:45 in your claude.ai account settings.
  Every later check uses a stand-in program and fake keys only.

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
  U untracked, X unmerged. The multi-row bulk bar went to T-018-c and the folder rows (stage
  everything beneath) to T-033's tree view, both named in PLAN.md. Status is polled every 4 s
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

## Last 10 passes  (date · task · result · evidence)
- 2026-10-12 · [core] T-013-fix-a · done: `createOpens()` in `model.ts` (+ test), `ProjectsPanel.tsx` routes Mod+N and the header button through it, T-013-c added; `evidence/T-013-fix-a-no-project.png`
- 2026-10-12 · [core] T-010-fix · done: `src/terminal/paste.ts` (+ test), `TerminalPane.tsx` wired to it; `evidence/T-010-fix-paste.png`
- 2026-10-11 · [core] T-009-fix-b · done: `blocking()` in `grid.ts` (+ test), the naming toast in `App.tsx`, T-151 named as the owner; `evidence/T-009-fix-b-toast.png`
- 2026-10-11 · [core] T-009-fix-a · done: `columnsFor(count, stacked)` in `grid.ts`, a per-workspace stacked flag in `App.tsx`, tests; `evidence/T-009-fix-a-stacked.png`
- 2026-10-11 · [core] T-003b-fix-a · done: `.topbar` grid in `src/styles.css`; `evidence/T-003b-fix-a-1400.png` (no overlap at 1400; centred at 1920)
- 2026-10-11 · [core] T-001-fix · done: the opening of STATE.md rewritten from the 2026-10-11 state (bookkeeping only)
- 2026-10-11 · [core] T-029, T-030 · deferred (0 passes): the palette and the orchestration store are other tasks' work
- 2026-10-11 · [core] T-028-a · done: `src/board/chip.ts` (+ test), Board lanes and chip rows in `App.tsx` / `TerminalPane.tsx` / `styles.css`, `agent_answer` and `Change.wrote` in `status.rs` / `hooks.rs`; `evidence/T-028-a-board.png`, `-approved.png`, `-deny-ask.png`, `-denied.png`
- 2026-10-11 · [core] T-027 · deferred (0 passes): needs T-325 / T-326 / T-050; rules moved onto the T-326 line
- 2026-10-11 · [core] T-026-c · done: `src/inbox/inbox.ts` (+ test), `InboxView.tsx`, the bell and `view.inbox` in `TopBar.tsx` / `App.tsx`, pane state stamps; `evidence/T-026-c-all-clear.png`, `-groups.png`, `-detail.png`, `-opened.png`
- 2026-10-11 · [core] T-026-b · done: `VOCAB` + `stoppedLabel` + `headerOf` on it (`status.ts`, tests), `StatusGlyph` + synced `Spinner` (`icons.tsx`), `Tip.tsx`, `.spin` 12 fps + reduced motion (`styles.css`), header / badge / dot wired; `evidence/T-026-b-working.png`, `-needs-you.png`, `-done.png`, `-tab-badge.png`, `-sidebar-dot.png`, `-reduced-motion.png`



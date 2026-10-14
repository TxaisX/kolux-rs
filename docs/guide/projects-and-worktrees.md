# Projects and worktrees

Use the sidebar to add projects, give each task its own branch in its own folder, review and commit changes, and come back after a restart with everything where you left it.

## The sidebar

The project sidebar shows on the Terminals view. Toggle it with Ctrl+B. The header "Projects" has four buttons.

| Button | What it does |
|---|---|
| Group and sort | Opens the grouping and sorting form (below) |
| Add project | Clone, open a folder or start a new project. See [Getting started](getting-started.md) |
| New group | Sort projects into folders of their own. Works only when grouped by Project |
| New workspace | Make a branch in its own folder (Ctrl+N) |

Each project block shows its name, a gear for project settings, a plus for a new workspace, and the main folder row (the "main checkout", your original folder). Workspaces are listed under it.

The bottom of the sidebar holds "New session" (start an agent in a new pane inside a fresh workspace), Model routing, Help and "Check for updates". A gear there lets you add a project by typing its path, or change the folder where workspaces go. An empty sidebar reads "No projects yet." Projects must be Git repositories; one without Git can start Git from the sidebar.

When someone makes a worktree outside Kolux, a notice says "N new workspace(s)" with Show, Hide and Done.

## What a worktree is

A worktree is an extra working folder for the same Git repository, on its own branch. Kolux calls it a workspace. Each AI can then edit its own files, and nobody collides. The original folder stays as the main checkout.

## Create a workspace

Press the plus, or Ctrl+N (also Ctrl+Shift+N). The form asks for:

| Field | Meaning |
|---|---|
| Project | Which repository |
| Name, or an existing branch | A sentence under the field previews what will happen |
| Parent | Which workspace it branches from |
| Agent | What to start. The default is "No agent: a terminal" |
| Note | An optional first request for the agent |

"Advanced…" adds a branch name, reuse of an existing branch, opening a pull request, a setup script (run it, or skip it, in a tab, a split right or a split below, and optionally wait for it) and the base to start from. Press "Create workspace" or Cancel. Tick "Create more" to keep the form open for another.

While Git works, a stand-in row shows "creating…" with a cancel x.

## Workspace rows

Click a row to switch to it. Enter shows it. F2 or a double-click on the name renames it. A chevron folds a workspace's children.

Each row shows a coloured dot for its state, the name, and hints such as "sleeping" or "external". Its buttons:

| Button | What it does |
|---|---|
| Pin | Keeps the row at the top of the list |
| Mark read / Mark unread | Toggles the unread mark |
| Change parent | Moves it under another workspace |
| Sleep | Closes its tabs and terminals. Show it again to wake it |
| Hide this worktree | Takes it off the list |
| Remove (x) | Deletes it. Off for the main folder |

Ctrl+1 to Ctrl+9 jump to a workspace by position. Ctrl+Shift+Up and Ctrl+Shift+Down step through them. Ctrl+Shift+J opens a switcher. Ctrl+J jumps to the next session that needs you; the sidebar shows "Next that needs you" with its key.

## Remove a workspace

Press x on a row, or Ctrl+Shift+Backspace. Kolux checks first, then asks "Remove <branch> and its folder?" It deletes the branch too, unless the workspace was opened on a branch that already existed. If there are uncommitted changes, it lists them and offers a "Delete my changes too" checkbox. Press Remove to go on or Keep to stop. Removing a workspace ends its shells and everything they started. Kolux can refuse and tell you why, for example when a program stays running.

## Grouping and sorting

Press the sliders button.

| Choice | Options |
|---|---|
| Group by | Project, None (one flat list), Status, Pull request |
| Sort | Smart (what needs you first), Name, Recent (latest activity first) |
| Checkboxes | Hide workspaces made by automations; pinned rows also show in their usual place; show sleeping workspaces |

Group headers fold. Pinned rows gather in a "Pinned" section. A project group has its own gear to rename it, move it or delete it. Deleting a group offers an "also remove the projects" checkbox.

## Source Control

Open the right panel with Ctrl+Shift+G (Ctrl+L hides or shows the panel). Source Control lists the changes in the current workspace.

| Section | Rows |
|---|---|
| Conflicts | Files Git cannot merge by itself |
| Staged | Changes ready to commit |
| Changes | Edited files not staged |
| Untracked | New files Git does not know yet |

Each section has a count, Stage all or Unstage all, and Discard all. Each row has Stage or Unstage and Discard. Click selects a row, Ctrl adds, Shift selects a range, and a bar then offers the same actions for the selection. Esc clears it.

Header buttons: Review changes (an agent checks the branch), All changes, list or tree view, Refresh, Close.

### Commit

Type a message in the box (placeholder "Message (Ctrl+Enter to commit on <branch>)") and press Ctrl+Enter. "Write the message with AI" drafts one. Your draft is kept per workspace.

The main button proposes the next step on its own:

| Order | Button |
|---|---|
| 1 | Commit (off with "Write a message first" or "Resolve the conflicts first") |
| 2 | Stage all |
| 3 | Publish branch |
| 4 | Force push with lease |
| 5 | Sync, with counts ahead and behind |
| 6 | Pull |
| 7 | Push |
| 8 | Create pull request |

A "Commit and" menu commits then pushes, syncs or force pushes. A "Remote actions" menu has Push, Pull, Sync, Fetch, Fast-forward, Force push with lease, Publish branch and Rebase from base.

The panel can also create a pull request (Title, Description, base branch), open the current one, link another, merge it, and run "Fix with AI" on failed checks. The list refreshes after each action, and within about a second of any change to the workspace's files or Git state while the panel is open. Changes inside build and package folders (target, node_modules, dist, .venv) do not trigger it. If Kolux cannot watch the folder, it checks every 4 seconds instead. Open diffs and All Changes follow the same rule.

### Discarding changes

Discard always asks first, and the message tells you the consequence.

| What you discard | What the question says |
|---|---|
| A new, untracked file | "Delete <name>?" It is deleted from disk. This cannot be undone. Button: Delete |
| A deleted file | "Restore <name>?" The file comes back as Git last had it. Button: Restore |
| A modified file | "Discard changes to <name>?" Staged: its staged and unstaged changes are lost. Unstaged: its unstaged changes are lost; anything staged stays. Button: Discard |
| Several rows | "Discard all N in <section>?" with counts of files deleted, restored and losing changes. Button: Discard all |

Conflicts cannot be discarded. Staged new files are deleted from disk, not only unstaged.

## Quitting and reopening

Terminals do not keep running while Kolux is closed. When you reopen, Kolux restores:

- your tabs, pane layout, active workspace and tab, and which pane had focus;
- the earlier output of each terminal, shown above a new shell with the note "── restored after a restart · the shell below is new ──" (it keeps the last 256 KB per pane);
- the screen you left: Agents, Board, Terminals, the Inbox or Artifacts.

Claude and Codex tabs with a known session resume it. Other agents return at their prompt. Browser tabs reopen fresh. A tab whose folder is gone is dropped, and a damaged saved entry is dropped on its own without losing the rest. A tab you closed on purpose does not come back. A slow start never drops saved tabs.

Quitting with unsaved editor text asks "Quit with unsaved changes?" with "Quit without saving" or "Keep working".

<!-- verified against: src/projects/ProjectsPanel.tsx, src/projects/AddProject.tsx, src/glossary.ts, src/scm/SourceControlPanel.tsx, src/scm/watch.ts, src-tauri/src/scm_watch.rs, src/scm/model.ts, src/chrome/RightSidebar.tsx, src/terminal/layout.ts, src/keys/actions.ts, src/App.tsx at d5034cd -->

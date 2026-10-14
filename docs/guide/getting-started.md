# Getting started

Use this page to finish first-run setup, find your way around the window, add a project and start your first agent.

## First launch

On a fresh install Kolux opens a four-step dialog, "Get started with Kolux". Each step has a main button on the right. Ctrl+Enter presses it. A Back button appears from step 2 on. Closing the dialog asks "Skip setup?".

| Step | What you do | Main button |
|---|---|---|
| 1. Welcome | Read the idea: several AIs can work on your files at the same time | Get started |
| 2. Connect an AI | Link at least one AI. The main button stays off until one is connected | Continue (or "I'll do this later") |
| 3. Your work | Pick a folder, or use sample data | Try with sample data |
| 4. Choose a kit | Pick a starter lineup of sessions. A switch, "Tell me whenever an AI finishes", turns on notifications | Start kit (or "Just open a session") |

You can reopen the dialog later: click the "?" button at the bottom of the sidebar, then Help, then Onboarding.

When you have never picked a view, Kolux opens on Terminals. After that it opens on the view you were on when you quit.

A fresh start has no terminal pane yet. The Terminals view says "No terminal open here" and offers two buttons: Open a shell, and Choose what to run.

## The top bar

The bar across the top is 36 pixels tall and replaces the Windows title bar. Drag any empty part of it to move the window. Left to right:

| Control | What it does |
|---|---|
| Kolux mark | Names the app. Not clickable |
| Menu (dots) | Opens a "View" menu with Zoom In, Zoom Out and Reset Size. They act on the focused terminal |
| Sidebar button | Hides or shows the project sidebar (Ctrl+B) |
| Back / Forward | Return to the last workspace or page you were on, and go forward again (Ctrl+Alt+Left, Ctrl+Alt+Right) |
| Screen switcher | Four buttons: Agents, Board, Terminals, Tower. See the next section |
| Right-panel button | Shows or hides the right panel, which holds Source Control. Hidden while a full page is open |
| Search box | Jump to a worktree, tab, project or setting (Ctrl+Shift+J) |
| Bell | Opens the Inbox. Press it again to return to Terminals |
| Usage pill | Shows how much of your weekly AI allowance is left, for example "Claude 80% left". Read-only. Hover for the reset time |
| Minimize, Maximize, Close | The usual window controls |

The usage pill turns to a warning tint at 70% used and a danger tint above 90%. A Codex pill shows only when Codex is installed and you have added at least one Codex account. It reads "Codex N% left", or "Codex · sign in again" when its sign-in has lapsed. A pill shows only for an AI program that is installed and reports a weekly figure.

In the Classic look (Settings, Appearance) the screen switcher is absent and the window stays on Terminals.

Press Escape to leave a full page such as the Inbox.

## The views

Use the screen switcher in the middle of the top bar.

| View | Use it to |
|---|---|
| Agents | See one list of sessions grouped by agent, with the picked session beside it. See [Board, Agents and Inbox](board-agents-inbox.md) |
| Board | See every session as a card in a lane: Needs you, Working, Done, Stopped, Idle. Approve or deny from the card |
| Terminals | Work in the pane grid. The project sidebar shows only here (and on the Artifacts page). See [Terminals](terminals.md) |
| Tower | See every agent at a glance on one full-width screen, the ones that need you first, with usage per AI provider across the top. One click opens a pane. See [Board, Agents and Inbox](board-agents-inbox.md) |

The Board, Agents and Tower views list sessions from every workspace at once. The Terminals view shows the panes of one workspace.

## Add a project

A project is a Git repository (a folder whose history Git tracks). In the sidebar, click the folder-plus button in the "Projects" header: "Add project". A dialog offers three choices. Arrow keys move between them, Enter takes one, Escape closes.

| Choice | What happens |
|---|---|
| Copy from a web address | Clones a repository. Type the web address (for example `https://github.com/owner/project.git`). The Folder field fills itself; change it if you like. Press Copy. A Cancel button stops a copy in progress |
| Open a folder… | Opens a folder picker for a project already on disk |
| New project | Type a Name and a "Goes in" folder, then press Create |

More detail is in [Projects and worktrees](projects-and-worktrees.md).

## Start your first agent

1. In the sidebar, press "New session" at the bottom. It starts an agent in a new pane, inside a fresh workspace (a branch in its own folder).
2. A menu lists the AI programs Kolux found on your computer. Claude Code, Codex and Grok lead; others sit behind "Show more agents". Pick one.
3. The pane opens and the agent starts. Type your request in the pane.
4. Watch its status word in the pane header (Working, Needs you, Done). Press the bell to see every session that needs you.

Other ways in: press Ctrl+T for a plain shell, or use "New tab" and "Choose agent…" to pick the AI, model and number of sessions before anything starts.

<!-- verified against: src/onboarding/Wizard.tsx, src/chrome/TopBar.tsx, src/usage/meter.ts, src/usage/ClaudePill.tsx, src/usage/CodexPill.tsx, src/settings/general.ts, src/projects/AddProject.tsx, src/projects/ProjectsPanel.tsx, src/launch/PlusMenu.tsx, src/keys/actions.ts at d3358c3 -->

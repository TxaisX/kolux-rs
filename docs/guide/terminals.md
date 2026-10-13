# Terminals

Use the Terminals view to run agents and shells in a grid of panes, split and resize them, group them in tabs, and paste into the one you are working in.

## The pane grid

Each workspace (a branch in its own folder) has its own grid. The grid holds up to 12 panes. It picks columns by count: 1 pane is one column, 2 panes two, up to 4 panes two columns, up to 9 panes three, and more than that four.

An empty workspace shows "No terminal open here." with two buttons: "Open a shell" and "Choose what to run".

### Layouts

The Layout strip has four buttons: 1, 2, 4 and 6. Press one to set the pane count.

| Action | Result |
|---|---|
| Grow (for example 2 to 4) | Empty panes are added |
| Shrink (for example 4 to 2) | Panes that were never started are removed |
| Shrink past a started session | Blocked. A toast says "<name> is a started session: close it to go smaller." |

At 3, 5 or more than 6 panes no layout button is pressed. New workspaces start with the pane count set in Settings.

### Split, resize, expand

| Do this | How |
|---|---|
| Split | Use "Split right" on the pane header (a shell in the same folder), or Ctrl+Shift+D (right) and Alt+Shift+D (down) |
| Resize | Drag the thin divider between two panes. It moves live. Letting go outside the window ends the drag where it was |
| Expand | Press Expand on the header, or Ctrl+Shift+Enter. The pane fills the workspace. Press the same control to restore |

Expanding hides the other panes; it does not restart them or lose their scrollback. If you add or close a pane meanwhile, the layout comes back when you restore. In the Classic look, a lone pane cannot expand.

## Pane headers

Every pane has a header. Left to right it shows:

| Item | Meaning |
|---|---|
| Agent mark and title | Hover for the folder |
| Branch chip | The Git branch, or the short commit when HEAD is detached. Plain folders show none |
| Program word | The program and its model |
| Status word | Working, Needs you, Done and so on. See [Board, Agents and Inbox](board-agents-inbox.md) |
| "restored" mark | The pane came back after a restart. A key press or click clears it |
| Crew label | For example "2 agents, 1 waiting", when an agent has helpers |
| Age | "just now", then "5m ago", after a turn finishes |

On the right sit the plan text (5-hour and weekly windows), a "Review plan" button when a plan is waiting, the "..." Pane menu, Expand, "Split right", "+" (start a new session in a new pane) and Close pane (Ctrl+W, which ends the program).

In a narrow pane the header drops the branch chip, program word, buttons and status word, in that order. The dot, mark and name stay.

### The Pane menu

Press "..." or right-click the header.

| Item | What it does |
|---|---|
| Expand pane / Restore pane | Same as the Expand control |
| Split right / Split down | Add a shell in the same folder |
| Close pane | Ends the program |
| Set Title… | Gives the pane your own title |
| Clear Pane Title | Appears only when you have set a title |
| Copy Session ID | Appears only when the session is known |
| Copy Terminal ID / Copy Pane ID | Puts the id on the clipboard |
| Copy terminal diagnostics | Puts a scrubbed snapshot of the pane on the clipboard, for a bug report |

## Tabs

A cell with more than one pane shows a tab strip. Each tab has an icon, a status badge, a context ring (how full the AI's memory is), its name and an x to close it. An editor tab also shows a dot while it has unsaved text.

- Double-click a terminal or agent tab to rename it.
- Middle-click a tab to close it.
- Right-click a tab for the menu below. Items that would close nothing are greyed out.

| Item | What it does |
|---|---|
| Rename tab | Terminals and agents only |
| Close | Closes this tab (Ctrl+W) |
| Close others | Closes every other tab |
| Close to the right / Close to the left | Closes the tabs on that side |
| Close all | Closes every tab (Ctrl+Alt+W) |

Closing the active tab returns you to the tab you used before it. If there is none, the one to its right, else the one to its left.

If a program is still running, Kolux asks first: "Close "<name>"?" with "A program is still running in it. Closing the tab stops it." Press "Close tab" to go on. This question is on by default and can be switched off in Settings. When a shell ends by itself, a dialog says "The shell ended with exit code N" and offers Close pane or Restart.

### The New tab menu

The "New tab" button opens beside the focused pane.

| Item | What it opens |
|---|---|
| Terminal | A shell. One entry for each shell Kolux found; the first is Ctrl+T |
| Choose agent… | A pane that asks which AI, model or terminal to run. Nothing starts until you press Start |
| An installed agent | That agent directly |
| Browser | A web page tab (Ctrl+Shift+B) |
| New markdown file / Open markdown file… | Notes tabs (Ctrl+Shift+M, Ctrl+Shift+O) |

Files and diffs are covered in [Files and browser](files-and-browser.md).

## Choose what to run

The chooser pane, titled "Choose what to run", sets up one or many sessions before they start.

| Part | Use it to |
|---|---|
| Kits | Start from a saved lineup |
| Use last lineup | Repeat the last lineup for this project (appears when there is one) |
| Shape | Pick a built-in or saved arrangement. "Save as team" stores yours under a Team name |
| Sessions | Pick a quick count, or type any number, and press "Same for all" to copy one choice to every seat |
| Folders | "Separate copy for each AI" gives every session its own workspace. "Same folder for all" shares one |
| Task for every seat | Optional first request for all sessions |
| Per seat | Pick the AI and its model, and an optional job title |

If you share a folder between several AIs, Kolux warns "Several AIs would be editing the same files at once." and offers "Give each its own copy". Separate copies need a Git project.

The Start button reads "Start", or "Start N" for several, and "Starting…" while it works. It stays off until every seat has an AI and model (or Terminal).

## Paste and copy

| Do this | Keys |
|---|---|
| Paste into the focused pane | Ctrl+V, Ctrl+Shift+V or Shift+Insert |
| Copy the selection | Ctrl+Shift+C, or Ctrl+C when text is selected |
| Interrupt the program | Ctrl+C with nothing selected |
| Select all terminal text | Ctrl+Shift+A |

A paste goes only to the focused pane. Large pastes are sent in pieces so the window stays responsive. A paste over 8 MB is refused: the header says "Paste of X MB is over the 8.0 MB limit; nothing was sent". If the opening request is still being delivered, your paste waits and goes in after it.

## Keyboard shortcuts

On Windows, the main key is Ctrl. You can change every shortcut in Settings (see [Settings](settings.md)).

| Keys | What it does |
|---|---|
| Ctrl+, | Open Settings |
| Ctrl+B | Hide or show the left sidebar |
| Ctrl+L | Hide or show the right sidebar |
| Ctrl+Shift+E | Show Explorer in the right sidebar |
| Ctrl+Shift+G | Show Source Control in the right sidebar |
| Ctrl+Shift+J | Open the worktree switcher |
| Ctrl+Shift+Up / Ctrl+Shift+Down | Previous / next worktree |
| Ctrl+Shift+0 | Focus the worktree list |
| Ctrl+1 to Ctrl+9 | Select the workspace at that position |
| Ctrl+N or Ctrl+Shift+N | Create a workspace |
| Ctrl+Shift+Backspace | Delete the workspace (it asks first) |
| Ctrl+Alt+Left / Ctrl+Alt+Right | Back / forward through workspaces and pages |
| Ctrl+J | Jump to the next session that needs you |
| Ctrl+T | New shell tab |
| Ctrl+Shift+B | New browser tab |
| Ctrl+Shift+M / Ctrl+Shift+O | New / open markdown file |
| Ctrl+W | Close the tab, or the pane |
| Ctrl+Alt+W | Close all tabs |
| Ctrl+] / Ctrl+[ | Focus next / previous pane |
| Ctrl+Shift+D / Alt+Shift+D | Split right / split down |
| Ctrl+Shift+Enter | Expand or restore the pane |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset the focused terminal |
| Ctrl+V, Ctrl+Shift+V, Shift+Insert | Paste |
| Ctrl+Shift+C | Copy selection |
| Ctrl+Shift+A | Select all terminal text |

<!-- verified against: src/chrome/LayoutStrip.tsx, src/chrome/TopBar.tsx, src/App.tsx, src/terminal/TerminalPane.tsx, src/terminal/PaneMenu.tsx, src/terminal/paste.ts, src/terminal/status.ts, src/terminal/layout.ts, src/launch/ChooserPane.tsx, src/keys/actions.ts at 106e966 -->

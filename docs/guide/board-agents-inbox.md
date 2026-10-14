# Board, Agents and Inbox

Use these views (and the Tower) to see what every session is doing, answer a permission request without hunting for its pane, and find the sessions that need you.

## The Board

Open it from the screen switcher in the top bar. Each terminal pane in any workspace is one card. Editor and browser tabs get no card. Shells and chooser panes that have not started sit in Idle. With no sessions the Board says "No session yet."

### Lanes

Lanes run left to right. A lane is drawn only when it holds a card.

| Lane | Cards in it |
|---|---|
| Needs you | Waiting on a permission or a question |
| Working | Running, starting, queued, or with no recent update |
| Done | Finished a turn |
| Stopped | Exited, interrupted, or blocked |
| Idle | Nothing running, or not started |

### What a card says

| State | Lane | Line on the card |
|---|---|---|
| Needs permission | Needs you | The tool and detail, with Approve and Deny |
| Asked a question | Needs you | Every question it asked, joined by " · " ("Which framework? · Which database?") |
| Blocked | Stopped | The cause: "Limit reached · resets at …", "Sign in again", or "The AI hit an error" |
| Interrupted | Stopped | "Interrupted" |
| Exited | Stopped | "Exited" |
| Done | Done | The first line of the reply and the newest file written |
| Idle | Idle | Time since it went idle |
| Queued | Working | "Queued" |
| Quiet for a while | Working | "No recent update", and how long since its last status (for example "no status for 12m"). Shown when a working agent prints nothing for a while, or sends no status for 30 minutes |
| Working | Working | Time running and the current tool step |

A meter bar on the card shows how full the AI's memory is (tokens used out of its window) and its plan allowance.

### Approve and Deny

When an agent asks permission to use a tool, its card shows two buttons.

- **Approve** lets the agent carry on.
- **Deny** tells the agent no.

They appear only for a permission request the agent's hooks reported, which names the tool. A permission a program prints into its own output, or one Kolux guesses from the pane title, shows no buttons on the card: answer it in the pane. Questions need an answer typed in the pane. The same two buttons also show in the agent pane's header (see [Terminals](terminals.md)).

### Expand a card

Press Expand on a card to show that session's live terminal inside the card. Press Collapse and the terminal goes back to its grid slot. Only one card is expanded at a time.

## The Agents page

Use it to browse sessions by program rather than by state. The left rail, "Sessions by agent", has one group for each agent you have switched on and installed, then "Other sessions" for anything unmatched.

- Each row shows the agent mark, a name (the title, the folder, or "Session N"), a context ring and a status word.
- The + beside an agent ("Add a <agent> session") adds a not-started session, shown as "New session" and "Not started".
- A footer line shows the picked session's 5-hour allowance and when it resets, for example "Claude 80% left".
- The picked session's terminal (or its chooser) fills the area beside the rail. Kolux remembers your pick; first run it picks the first agent's newest session.

With no agent switched on the page says "No agents yet" with an "Open Settings" button. With an agent but no session it says "No session yet. Add one with + under an agent."

## The Inbox

Use it to see everything that wants your attention. Press the bell in the top bar. Press it again, or press Escape, to leave.

| Group | Contents |
|---|---|
| Needs you | Rows labelled Permission, Question or Blocked |
| Waiting on agent | Rows labelled Running or Queued |
| Done today | The 20 newest sessions that finished in the last 30 minutes. Interrupted ones are left out |

When nothing needs you the page says "All clear. Nothing needs you." With no sessions at all it says "Sessions show up here as they ask, run and finish."

Up and Down walk the rows. Enter or a double-click opens that session's pane. A detail panel shows the Agent, Branch, Workspace, Changes ("N files changed, M staged" or "No files changed") and the last Prompt. Its button reads "Answer in Code" for a session that needs you and "Open in Code" otherwise. The Inbox does not answer for you; it takes you to the pane.

## The Tower

Use it to watch every agent at once, for example on a second screen. Click Tower in the screen switcher, and pick another view to leave. "Show Tower" in the keyboard shortcuts has no key until you give it one. The Tower is a screen in the main window; it does not open a window of its own yet.

Across the top, a summary card counts the agents and how many are in each lane (for example "2 needs you"). Next to it is one usage card per AI program (Claude, Codex) with its 5-hour and weekly bars and how many panes it runs in. When those panes use named accounts, the card lists each account with its pane count. The bars are the program's figures for the account Kolux reads usage from, so they are shown once per program, never under each account's name. Without figures yet a card says "No usage figures yet".

Below, every agent pane is one row, grouped Needs you, Working, Done, Stopped, Idle, with the newest change first in each group. A row shows the pane's name, the program and account, the branch and folder, the status word with its line (the same words as the Board), and the context and plan figures. Shells and editor or browser tabs get no row. With no agent running it says "Nothing is running. Start an agent and it shows up here."

Click a row, or walk the rows with Up and Down and press Enter, to open that pane.

## The Floor

Use it to see when each agent worked, waited for you or sat idle. It has no button yet: give "Show Floor" a key in the keyboard shortcuts, then press it. Pick another view to leave.

Each agent pane is one lane, named after its terminal. Coloured stretches show Working, Needs you (a permission, a question or a block), Idle and Unverifiable. Unverifiable means the pane's terminal has closed, so Kolux cannot vouch for its quiet stretches. Hover a stretch for its times. Pick the range at the top: 15 minutes, 60 minutes (the default) or Today (from midnight). The page reads again every 5 seconds. With nothing to show it says "No agent reported any activity in this range."

## Automation runs

A finished run's page keeps **Saved output**: the last text the agent's terminal showed when the run ended (about the last 16,000 characters; when older lines were left out, it says so). It also shows **Tokens and cost** for the run, from the agent's own usage records, and the automation's page adds up its runs. When no usage can be matched, it says "Unavailable" with the reason rather than showing 0. A run's figure counts every session that worked in the same folder while it ran, so a run in a folder where you also work by hand can show your own usage too; a fix is planned. The figure is read when you open the Automations page, so reopen it after a run finishes.

## Status words

The same words appear in pane headers, tabs, the sidebar, the Board and the Inbox.

| Word | Meaning |
|---|---|
| Working | The agent is working on its turn |
| Working (background) | The turn is over, but Kolux is watching the agent's background tasks. Shown as "Working" |
| Needs you | It asked a question, or needs permission for a tool. Every question it asked shows with it; for a plan, its first line |
| Blocked | It cannot go on: a limit, a sign-in or an error. Open the pane to see why |
| Interrupted | The turn was stopped before it finished: you pressed Esc or Ctrl+C and no finish arrived within about 3 seconds. If the agent then starts a new step, it goes back to Working, so a Ctrl+C that only cleared what you were typing does not leave it Interrupted. With Claude Code, a finish that arrives after the key press, even a late one, shows Done instead, because Claude Code sends no finish for a turn it really stopped. Otherwise it stays until your next prompt |
| Failed | The program could not start |
| Done | The agent finished its turn. Clearing a session (/clear) or compacting it by hand also shows Done, without a notification |
| Idle | Nothing is running here |
| Queued | Waiting for its turn to start |
| No recent update | No status has arrived from this agent for a while: it printed nothing for some minutes, or, while working, sent no status for 30 minutes. It clears with the next status |
| Starting | The program is starting up |
| Cannot reach | Kolux cannot talk to this agent |
| Stopped | The program has stopped |

A plain shell reads "Ready" while it runs and "Ended (code)" after it exits. A session not yet started reads "Not started" on the Agents page.

Until an agent's status hooks report, Kolux guesses its state from the title the program gives its terminal. A spinner or a word such as "thinking" reads Working, "ready" or "idle" reads Done, and "permission" or "waiting" reads Needs you. A title it does not recognise, such as a folder path, changes nothing. The first real status replaces the guess.

A program can also report its own status by printing a hidden code (OSC 9999, with the state working, done, permission, waiting or idle). Kolux reads it and never shows it on screen. Any program running in the pane can print it, so this status is the program's own word, not proof.

## Notifications

Kolux tells you when:

- an agent finishes ("<tab> finished") or a helper agent's turn ends,
- an agent needs permission,
- a turn is interrupted,
- an agent stops: limit reached, sign in again, or the AI hit an error (with a "Resets at …" time when known),
- a session goes quiet: "<tab> has gone quiet for N min", "No terminal output since then. It may be stuck."

When several repositories have agents running, the title includes the repository name. You get a desktop notification only when the pane is out of view or the window is not in front. A toast appears in the app, and an unread mark sits on the tab and workspace until you view it.

Settings, Notifications has three switches and a sound choice (System default, Chime, Ping, Pulse):

| Switch | Default |
|---|---|
| An agent finishes its task or needs permission | On |
| A terminal rings its bell | Off |
| An agent halts on a usage limit, a lapsed sign-in or a provider error | On |

## The usage pill

The pill in the top bar shows how much of your weekly allowance is left for each installed AI program, for example "Claude 80% left". It is read-only. Hover for the weekly limit and when it resets. It tints as the allowance runs down (warning at 70% used, danger above 90%). See [Getting started](getting-started.md) for the full description.

<!-- verified against: src/board/chip.ts, src/App.tsx, src/agents/AgentsRail.tsx, src/agents/rail.ts, src/inbox/inbox.ts, src/inbox/InboxView.tsx, src/terminal/status.ts, src/terminal/notify.ts, src/status/useAgentStatus.ts, src/usage/meter.ts, src/tower/tower.ts, src/tower/TowerView.tsx, src/chrome/TopBar.tsx, src/keys/actions.ts, src-tauri/src/status.rs, src/floor/FloorView.tsx, src/floor/timeline.ts, src-tauri/src/activity.rs, src/automations/RunsDashboard.tsx, src/automations/usage.ts at f424c27 -->

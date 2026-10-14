# Board, Agents and Inbox

Use these three views to see what every session is doing, answer a permission request without hunting for its pane, and find the sessions that need you.

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
| Asked a question | Needs you | "Question" |
| Blocked | Stopped | The cause: "Limit reached · resets at …", "Sign in again", or "The AI hit an error" |
| Interrupted | Stopped | "Interrupted" |
| Exited | Stopped | "Exited" |
| Done | Done | The first line of the reply and the newest file written |
| Idle | Idle | Time since it went idle |
| Queued | Working | "Queued" |
| Quiet for a while | Working | "No recent update", and how long it has gone without output |
| Working | Working | Time running and the current tool step |

A meter bar on the card shows how full the AI's memory is (tokens used out of its window) and its plan allowance.

### Approve and Deny

When an agent asks permission to use a tool, its card shows two buttons.

- **Approve** lets the agent carry on.
- **Deny** tells the agent no.

They appear only for a permission request. Questions need an answer typed in the pane. The same two buttons also show in the agent pane's header (see [Terminals](terminals.md)).

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

## Status words

The same words appear in pane headers, tabs, the sidebar, the Board and the Inbox.

| Word | Meaning |
|---|---|
| Working | The agent is working on its turn |
| Working (background) | The turn is over, but Kolux is watching the agent's background tasks. Shown as "Working" |
| Needs you | It asked a question, or needs permission for a tool. The first line of the question or plan shows with it |
| Blocked | It cannot go on: a limit, a sign-in or an error. Open the pane to see why |
| Interrupted | The turn was stopped before it finished: you pressed Esc or Ctrl+C and no finish arrived within about 3 seconds. It stays until your next prompt |
| Failed | The program could not start |
| Done | The agent finished its turn. Clearing a session (/clear) or compacting it by hand also shows Done, without a notification |
| Idle | Nothing is running here |
| Queued | Waiting for its turn to start |
| No recent update | No status has arrived from this agent for a while |
| Starting | The program is starting up |
| Cannot reach | Kolux cannot talk to this agent |
| Stopped | The program has stopped |

A plain shell reads "Ready" while it runs and "Ended (code)" after it exits. A session not yet started reads "Not started" on the Agents page.

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

<!-- verified against: src/board/chip.ts, src/App.tsx, src/agents/AgentsRail.tsx, src/agents/rail.ts, src/inbox/inbox.ts, src/inbox/InboxView.tsx, src/terminal/status.ts, src/terminal/notify.ts, src/status/useAgentStatus.ts, src/usage/meter.ts at 944b6cb -->

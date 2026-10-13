# Settings

Change how Kolux looks, which agents it offers, when it notifies you, and which keys do what. Open Settings with Ctrl+, , or from the Settings buttons on the Agents screen and the project rows. It opens as a full-page overlay and remembers the last page you used. Press Esc or the x to close it.

Changes save as you make them. They live in `settings.json` in Kolux's data folder, `%APPDATA%\com.txaisxiong.kolux-rs`. The right-hand column of each table shows the name a setting has in that file, which helps if someone asks you to check it.

## The pages

| Page | What it controls |
|---|---|
| General | Which look Kolux uses, which screen it opens on, diagnostics, privacy |
| Appearance | Colours, fonts, terminal text, status bar |
| Accounts & keys | Signing in to Claude, Codex and Grok |
| Agents | Which agents are on, how they start, whether they ask permission |
| Terminal & sessions | How many panes a new workspace has, close warnings |
| Git & worktrees | Branch names, Source Control, commit messages |
| Safety | A short note on protected commands (see [Safety](safety.md)) |
| Notifications | What alerts you, and how |
| Shortcuts | Every command and its keys |
| Usage | Activity counts and token use |

Below those, a Repositories group lists one small page for each project you have added.

## General

| Setting | Choices | Saved as |
|---|---|---|
| Look | Classic or New. A fresh profile starts on New; an older profile that never chose stays on Classic | `uiLook` |
| Opens first | Agents, Board or Terminals. Default is Terminals. Under Classic only Terminals is offered | `firstScreen` |
| Review notes | On by default. Select text in a file and press Ctrl+Shift+A to leave a note for an agent | `markdownReviewNotes` |
| Needs you strip | On by default. Shows the strip of agents waiting for you above the panes | `needsStrip` |

### Diagnostics

Three buttons gather a report for troubleshooting. Keys, passwords and tokens are replaced with `[masked]`. Nothing is sent anywhere; you copy the report yourself. See [Troubleshooting](troubleshooting.md).

### Privacy

This card lists every outside connection Kolux can make:

- GitHub Releases, to check for updates.
- Your Git remotes and the GitHub account you set up.
- The AI providers you connected.
- Sites you open in a browser tab.
- Script libraries from public hosts (cdnjs, jsdelivr, unpkg, tailwindcss, jquery), only when you save a web page for offline use.
- Microsoft, through the WebView2 browser engine Windows provides. It runs startup checks that Kolux cannot switch off.

Kolux sends no usage data, and no server exists to receive it. "Send feedback" opens a new-issue page on GitHub in your browser; the app submits nothing itself.

## Appearance

The page has three sections, all open at first: Interface, Terminal, and Window & Sidebar.

### Interface

| Setting | Choices | Saved as |
|---|---|---|
| Mode | System, Light or Dark. New profiles start on Dark | `appearanceMode` |
| Mode per screen | Agents, Board and Terminals can each use "Same as app", System, Light or Dark | `screenThemes` |
| Language | System, English, 简体中文, 한국어, 日本語, Español, Français. Only dates and sorting follow it; Kolux's own words stay in English | `language` |
| Colour theme | Classic, or one of 16 colours: ember, copper, sand, moss, fern, jade, teal, lagoon, sky, cobalt, indigo, iris, violet, orchid, rose, graphite | `appTheme` |
| Tint | -180 to 180 degrees, default 0. Not available on Classic | |
| Saturation | 0 to 160 percent, default 100. Not available on Classic | |
| Depth | -3 to 6, default 0. Not available on Classic | |
| App font | Any installed font; default is the built-in font | `appFont` |
| Editor font | Same as the terminal font, or any installed font | `editorFont` |

### Terminal

| Setting | Choices | Saved as |
|---|---|---|
| Terminal font | Any installed font | `terminalFont` |
| Size | 8 to 32 points, default 13 | |
| Line height | 1 to 2, default 1 | |
| Weight, Bold weight | Normal, bold, or 100 to 900. Defaults: normal and bold | |
| Terminal colours | A searchable list of schemes, one for dark mode and one for light. "Match app theme" picks one for you. "Add scheme" takes a Windows Terminal colour scheme pasted as JSON | |
| Light scheme in light mode | On by default | `terminalLightScheme` |
| Divider width | 2 to 12 pixels, default 6 | `dividerWidth` |
| Divider colour | One for dark mode, one for light; empty by default | |
| Panes not in focus | 30 to 100 percent, default 100 (no dimming) | |

The View menu zooms text with Ctrl+= , Ctrl+- and Ctrl+0. Zoom affects only the focused terminal.

### Window & Sidebar

| Setting | Default | Saved as |
|---|---|---|
| Show app name in the title bar | Off | |
| Show Tasks button | On | |
| Show Automations row in the sidebar | On | |
| Draw terminals with the GPU (up to six at a time; applies to new terminals) | On | `terminalGpu` |
| Show status bar | On | `statusBarVisible` |
| Status bar items: Agent status, Resource Manager, Terminals running, Agents running (tick the ones you want) | All shown | `statusBarHidden` |
| Usage percentages: Used or Remaining (changes only the Agents screen footer) | Used | `usagePercentages` |

## Accounts & keys

Kolux charges nothing and ships no models or keys. You bring your own sign-in. The page shows one card for each of Claude, Codex and Grok.

- A card for a program you have not installed says "Not installed" and offers Install (through WinGet, Windows' package installer) or "Open install page".
- **Claude:** Connect, Renew, Cancel or Disconnect. Disconnect asks first. "Use my Claude account instead" signs you in through the browser. The switch "Carry on by itself once a usage limit resets" is off by default (`claudeResumeAfterLimit`).
- **Codex:** "Add account", or "Sign in with a code" if the browser route does not suit you.
- **Grok:** "Sign in with a code", or "Use an xAI API key (advanced, pay-per-use)". The key is stored sealed and never shown again.
- **Manage accounts (advanced):** lists your Claude and Codex accounts, so you can name them, for example Personal and Work.

Saved keys and sign-ins are sealed by the system keyring (Windows' secret store). See [Safety](safety.md).

## Agents

| Setting | Choices | Saved as |
|---|---|---|
| Default agent | "Auto: the first agent available", or one installed agent | |
| Agent Permissions | **Yolo** or Manual. Default is **Yolo** | `agentPermissions` |
| Installed agents | A list with a Refresh button. Each has an on/off switch, a "default" mark, and a "How it starts" fold with Command, Default arguments and Environment | `agentOptions` |
| Agent status hooks | Off until you turn it on | `agentStatusHooks` |
| Hold Claude and Codex to a 200k context window | On | |
| Prompt-cache timer | Off. When on, "Cache length" is 5 minutes (default) or 1 hour | |

**Agent Permissions matters.** Under Yolo, Claude Code starts in its automatic mode, where its own safety check approves routine actions and still stops risky ones. Codex starts with no approvals and no sandbox (the walled-off area it normally works in), so it acts without asking. Choose Manual if you want each agent to ask before it acts.

**Agent status hooks** are small scripts Kolux puts in an agent's settings so the agent can tell Kolux what it is doing. Until the switch is on, the Board and Agents pages cannot show live status. The hooks badge in the status bar shows whether this switch is On or Off. The switch also shows the path of Claude Code's settings file and any problem found.

## Terminal & sessions

| Setting | Choices | Saved as |
|---|---|---|
| New workspaces start with | 1, 2, 4, 6, 9 or 12 panes. Default 1. Classic always uses 1 | `defaultPaneCount` |
| Ask before closing a tab that is running a program | On. A tab with only an idle shell always closes at once | |

## Git & worktrees

| Setting | Choices | Saved as |
|---|---|---|
| Branch prefix | Your Git user name (or GitHub login), custom text, or none. Default is your Git user name | `branchPrefix`, `branchPrefixCustom` |
| Default compare base | The repository default, or the branch's upstream | `scmSummaryUpstream` |
| Refresh the base first | Off. When on, it fast-forwards the base branch only | `refreshBaseFirst` |
| Source Control group order | Staged first (default) or Changes first. Conflicts always come first | |
| Commit messages written by | Claude Code (default), a custom command with a `{prompt}` placeholder, or Off. An instructions box takes up to 2000 characters | |
| GitHub API budget | Shows how much of GitHub's hourly allowance is left; "Check again" re-reads it | |
| Ask before deleting a workspace | On. A workspace with changes, a lock or a nested workspace always asks | |

A worktree is a separate working copy of a project on its own branch; Kolux calls it a workspace. See [Projects and worktrees](projects-and-worktrees.md).

## Notifications

| Setting | Default | Saved as |
|---|---|---|
| An agent finishes its task or needs permission | On | `notifyOnFinish` |
| A terminal rings its bell | Off | `notifyBell` |
| An agent halts on a usage limit, a lapsed sign-in or a provider error | On | `notifyOnStopped` |
| Stay quiet about the workspace you are looking at | On | `notifySuppressFocused` |
| Sound: System default, Chime, Ping or Pulse | System default | `notificationSound` |
| Volume, 0 to 100 | 100 | `notificationVolume` |
| Usage alerts at 80% and 95% | On | `usageAlerts` |
| Quiet alert minutes: warn when a working terminal goes silent this long. 0 turns it off; the most is 600 | 10 | `quietMinutes` |

Two buttons help you check: "Send a test notification" and "System notification settings" (Windows' own page). See [Board, Agents and Inbox](board-agents-inbox.md) for what each alert looks like.

## Shortcuts

Every command in Kolux has a row here. Your changes are kept in `keybindings.json` in a `.kolux` folder in your user folder. The card at the top shows that path and any error in the file, and "Read the file again" reloads it if you edited it by hand.

- Filters: All, Modified, Unassigned, Conflicting. The search box matches names and keys.
- Commands are grouped: General, Tabs, Terminal, Browser, Editor, File explorer, Settings.
- Click a key to record a new one. Esc keeps the old one.
- Buttons: Add (a second key for the same command), Disable, Reset. The x removes one key.
- Badges: Modified, Unassigned, Disabled and Conflicts (two commands on one key in the same area).

## Usage

- **Activity:** Agents started, time agents spent working, and pull requests created in Kolux.
- **Token analytics:** tabs for Overview, Claude and Codex; ranges Last 7 days, 30 days, 90 days and All time; and a scope of "Kolux worktrees" or "Every local use". It reads only your agents' own log files on this computer. Token tracking is off until you press Enable Claude or Enable Codex. It also lists tokens By model and Recent sessions.

## Repository pages

Each project has two settings: "New workspaces start from" (blank means the default branch) and "Workspaces folder" (blank means the global folder). The page notes that setup scripts, the display name and the icon come later.

<!-- verified against: src/settings/pages.ts, src/settings/GeneralPage.tsx, src/settings/AppearancePage.tsx, src/settings/AgentsPage.tsx, src/settings/GitPage.tsx, src/settings/NotificationsPage.tsx, src/settings/privacy.ts, src/settings/RepoPage.tsx, src/keys/actions.ts at 106e966 -->

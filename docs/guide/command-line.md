# Command line

Drive Kolux from any terminal pane: make a workspace, read a pane's output, type into a pane, wait for a program to finish. Anything you can click for workspaces and panes, a script or an agent can do with one line.

## The command is `kolux`

The installed app puts a program called `kolux` (`kolux.exe`, with a `kolux.cmd` helper beside it) in the `bin` folder of its install folder. A development build calls the same program `kolux-dev`. Both are one program with one set of commands.

Two things to know:

- **The help text always says `kolux-dev`.** Every usage line in `kolux --help` starts with `kolux-dev`, even when you ran `kolux`. Type `kolux` where the help says `kolux-dev`.
- **Inside a Kolux RS pane, `kolux` is this app's command.** Kolux puts its own folder first on the PATH (the list of places Windows looks for programs) in every pane it opens. If you also have the older Kolux installed, a plain terminal outside Kolux RS may find that one instead. Registering the command for the whole computer is not built.

To check which one you are running:

| Check | Run | You should see |
|---|---|---|
| Which program is found first | `where.exe kolux` | A path under the Kolux RS install folder, ending in `bin\kolux.exe` |
| Version | `kolux --version` | `0.1.0` |
| Which app the pane belongs to | `$env:KOLUX_APP_DIR` (PowerShell) or `echo %KOLUX_APP_DIR%` (Command Prompt) | A folder ending in `com.txaisxiong.kolux-rs` |

## How it reaches the app

The running app listens on a random port of your own computer (address `127.0.0.1`, reachable only from this machine). It writes the port and a one-run secret key into `cli.json` in its data folder, `%APPDATA%\com.txaisxiong.kolux-rs`. The command reads that file, sends one request and prints the answer.

- A request that looks like a web page request is dropped, so a web page cannot talk to Kolux this way.
- A request with the wrong key is refused.
- Kolux handles one request at a time. If it does not answer within 300 seconds, you get "Kolux is running but did not answer within 300 s; it may still be working".

## Run Kolux from the command line

| Command | What it does |
|---|---|
| `kolux open` | Starts Kolux, or brings its window to the front, and waits up to 60 seconds until it answers |
| `kolux status` | Says whether Kolux is up, without starting it. Works with the app closed (see below) |
| `kolux diagnostics memory` | Shows how much memory Kolux and each terminal session use (see below) |
| `kolux --version` | Prints the version |
| `kolux --help` | Lists every command. `--help` also works on a group, such as `kolux terminal --help` |

`kolux status` prints one line with one of four words. Scripts can rely on these words; they will not change.

| Word | Means | Exit code |
|---|---|---|
| `running` | Kolux is up and ready | 0 |
| `graph-not-ready` | Kolux answers but is still reading your projects' workspaces, usually for a second or two after it starts | 1 |
| `stale` | Kolux left `cli.json` behind (it was killed or crashed) and nothing answers. Run `kolux open` to start it again | 1 |
| `not-running` | Kolux is closed | 1 |

With `--json` the word is in `result.state`, and the command counts as worked in every case. The exit code still says whether Kolux is ready.

Kolux answers the command line one request at a time. If it is busy with another one (a workspace being created with its setup, for example), `kolux status` waits about 2.5 seconds and then says `running: Kolux is up, busy with another request` (exit 0; with `--json`, `result.detail` reads "busy with another request"). It never waits the 5 minutes other commands allow. If it stays busy for many minutes with nothing long running, Kolux may be stuck.

`kolux diagnostics memory` prints the Resource Manager's memory figures: Kolux itself, then each terminal session together with every program running inside it, then the total, then free memory. Each row has two numbers:

| Column | Means |
|---|---|
| resident | Memory the process is using right now |
| committed | Memory Windows has set aside for it. When the computer runs low, this is the figure that runs out |

A dash means Kolux could not read that figure. The Resource Manager in the app shows the same two figures, Resident and Committed, with a dash where Kolux could not read one. If Kolux is closed, the command says so in one line and exits with 1.

Every command takes `--json` to print one machine-readable result instead of text. Without it, errors go to the error stream. Exit code 0 means it worked; 1 means any error.

## Selectors: how you name things

Many commands take `--repo` or `--worktree` to say which project or workspace you mean.

| Option | Accepts |
|---|---|
| `--repo` | `id:<id>`, `name:<name>`, `path:<folder>` |
| `--worktree` | `active`, `current`, `id:<repo-id>::<path>`, `identity:...`, `name:...`, `branch:...`, `issue:...`, `path:...` |

A worktree is a separate working copy of a project on its own branch; the rest of this guide calls it a workspace. With no selector, the command uses the folder you are standing in.

## Projects and workspaces

| Command | What it does |
|---|---|
| `kolux project list` | Lists your projects |
| `kolux repo list` | Lists repositories |
| `kolux repo add --path <folder>` | Adds a Git repository as a project |
| `kolux repo show` | Shows one repository |
| `kolux repo set-base-ref --ref <ref>` | Sets the branch new workspaces start from |
| `kolux repo search-refs --query <text>` | Searches branches and tags; `--limit` caps the list |
| `kolux worktree create --name <name>` | Makes a workspace. Options: `--repo`, `--agent`, `--prompt`, `--setup run\|skip\|inherit`, `--base-branch`, `--issue`, `--comment`, `--parent-worktree`, `--no-parent`, `--run-hooks`, `--activate` |
| `kolux worktree rm --worktree <selector>` | Removes a workspace (also `remove`, `delete`). `--force` and `--run-hooks` are optional |
| `kolux worktree list` | Lists workspaces |
| `kolux worktree ps` | Lists them with a summary of orchestration work |
| `kolux worktree show` | Shows one workspace |
| `kolux worktree current` | Shows the one you are in. `--usage` adds the tokens its sessions used |
| `kolux worktree set` | Renames it or changes its issue, comment or parent: `--display-name`, `--issue`, `--comment`, `--parent-worktree`, `--no-parent` |
| `kolux worktree changes` | Lists what the workspace changed |
| `kolux worktree overlap` | Shows who else touches the same files |

`--prompt` needs `--agent`: a first prompt has to go to an agent.

Example: make a workspace named `fix-login` and switch to it.

```
kolux worktree create --name fix-login --activate
```

## Panes

A pane is one terminal. Each has a handle (its name for scripts) that looks like `term-3`. Inside a pane, `KOLUX_TERMINAL_HANDLE` holds that pane's own handle, and commands that take `--terminal` default to it.

| Command | What it does |
|---|---|
| `kolux terminal list` | Lists panes; `--worktree` narrows it |
| `kolux terminal show --terminal <handle>` | Shows one pane |
| `kolux terminal create` | Opens a pane. Options: `--worktree`, `--command`, `--title`, `--focus` |
| `kolux terminal split --terminal <handle>` | Splits a pane: `--direction vertical\|horizontal`, `--command` |
| `kolux terminal rename --terminal <handle> --title <t>` | Renames it. Without `--title` the default name returns |
| `kolux terminal switch --terminal <handle>` | Focuses it (also `focus`) |
| `kolux terminal close --terminal <handle>` | Closes it. `--tab` closes the whole tab; `--worktree <selector> --all` closes every pane of a workspace |
| `kolux terminal read` | Prints what the pane showed. `--cursor` and `--limit` page through output; `--screen` gives the frame visible now. `--screen` and `--cursor` cannot be combined (a screen has no history). When older lines are no longer kept, a warning says which cursor to read on from. In the output form, PowerShell may show a typed command twice because it redraws the line as you type; `--screen` shows it once |
| `kolux terminal send` | Types into a pane: `--text`, `--enter`, `--interrupt`. With none of them it refuses. When it sends a prompt to an agent, it watches 3 seconds (`--wait-submit <seconds>` changes this) and reports whether the agent began its turn, or warns that Enter may have been lost. With `--retry-request <id>`, sending the same id to the same pane again answers with the first receipt and types nothing (until Kolux restarts) |
| `kolux terminal wait --for exit\|tui-idle` | Waits until the program ends, or a full-screen program stops moving. `--timeout-ms` sets the limit; if it passes first, the command fails (exit 1) and names the state the pane is in ("term-3 did not reach exit within 60000 ms (it is running)"). With no status hooks reporting, `tui-idle` means 3 seconds without output, and a warning says so |

Examples:

```
kolux terminal read --terminal term-3 --screen
kolux terminal send --terminal term-3 --text "npm test" --enter
kolux terminal wait --terminal term-3 --for exit --timeout-ms 60000
```

## Accounts

| Command | What it does |
|---|---|
| `kolux account add --agent claude\|codex` | Runs that agent's own sign-in in the current terminal. Codex uses a device code |
| `kolux account list` | Lists your Claude and Codex accounts |

## Working with other agents (orchestration)

Orchestration lets one agent (a coordinator) hand work to others (workers) and exchange messages. A Run is one coordinated effort; a task is one piece of work in it; a dispatch hands a task to a worker. These commands are for agents and scripts, so only the groups are listed here. Run `kolux orchestration --help` for every flag.

| Group | Commands |
|---|---|
| Runs | `run-create`, `run-use`, `run-current`, `run-list`, `run-show` |
| Messages | `send`, `check`, `reply`, `inbox`, `ask` |
| Tasks | `task-create`, `task-list`, `task-update`, `dispatch`, `dispatch-show` |
| Decision gates (a question that holds a task until answered) | `gate-create`, `gate-resolve`, `gate-list` |
| Workers | `worker-start`, `worker-list`, `worker-stop`, `worker-abandon`, `worker-retain` |
| Housekeeping | `request-show` (what became of a change whose answer was lost), `reset --all\|--tasks\|--messages` |

Changes can be retried safely: pass the same `--retry-request <id>` and the work is not done twice.

One Windows quirk: the `kolux.cmd` helper refuses `kolux orchestration send` and `kolux orchestration reply` (exit code 2), because the Windows command prompt reads their text a second time and can change it. Run `kolux.exe orchestration send ...` instead.

## Automations

| Command | What it does |
|---|---|
| `kolux automations list` | Lists automations |
| `kolux automations show <id>` | Shows one |
| `kolux automations runs <id>` | Lists its past runs |
| `kolux automations create` | Makes one: `--name`, `--trigger hourly\|daily\|weekdays\|weekly\|<cron line>`, `--prompt`, and optional `--time`, `--day`, `--timezone`, `--repo`, `--workspace`, `--workspace-mode`, `--enabled\|--disabled` |
| `kolux automations edit <id>` | Changes one, with the same flags |
| `kolux automations remove <id>` | Deletes one |
| `kolux automations run <id>` | Runs it now |

## Commands that work with Kolux closed

| Command | What it does |
|---|---|
| `kolux agent-context` | Lists every command with its flags and usage, for an agent to read |
| `kolux skills list`, `skills get <topic>`, `skills coverage` | Lists Kolux's skill documents, prints one, and shows which installed agents have the orchestration skill |
| `kolux agent hooks status` | Shows, for each agent, whether its status hooks are installed, partial, not installed or in error |
| `kolux agent hooks on`, `agent hooks off` | Switches the status hooks and brings every agent in line |
| `kolux agent hooks prepare-codex` | Installs and trusts Kolux's Codex hooks before Codex is first started |

`kolux claude-teams` is not available on Windows.

## Typos and errors

A mistyped command is caught before Kolux is contacted, with a suggestion: "no command or group is called kolux-dev x; did you mean kolux-dev y?" Other messages:

| Message | What to do |
|---|---|
| Kolux is not running; start it with `kolux open` first | Run `kolux open`, or start the app |
| the token does not match this app; is cli.json stale? | The app was restarted or a different Kolux is running. Retry; if it persists, see [Troubleshooting](troubleshooting.md) |
| this Kolux is older than the command line; update Kolux before sending orchestration changes | Update the app |
| the connection to Kolux dropped while sending | Check whether the change happened (`request-show` for orchestration), then retry |
| --path is required: the folder of a Git repository | Give `repo add` a `--path` |
| kolux.exe is missing from the folder of kolux.cmd; reinstall Kolux. | Reinstall |

## Not built yet

These do not exist, so do not look for them: opening or comparing files from the command line, a `tab` command, and registering `kolux` on the PATH for the whole computer.

<!-- verified against: src-tauri/src/cli.rs, src-tauri/src/bin/kolux.rs, src-tauri/src/bin/kolux-dev.rs, src-tauri/Cargo.toml, src-tauri/cli/kolux.cmd, src-tauri/src/terminal.rs, src-tauri/src/resources.rs, src/status/ResourceManager.tsx, PLAN.md (T-250-a, T-250-b) at 1db1bf0 -->

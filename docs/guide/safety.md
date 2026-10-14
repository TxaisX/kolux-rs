# Safety

Know what Kolux guards, what it only warns about, and what it leaves entirely to you. Kolux protects your files, your keys and your work in progress. It is not a sandbox for the agents you run. Read the Agent Permissions note first.

## Agent Permissions: the biggest switch

In Settings, Agents, "Agent Permissions" is **Yolo** by default. Under Yolo, Claude Code starts in its automatic mode: its own safety check approves routine actions and still stops risky ones. Codex starts with no approval prompts but inside its sandbox (the walled-off area it works in): it can change files only in the workspace's own folder. By default the sandbox also keeps its commands off the internet and away from Git's own records, so Codex can edit files but cannot commit, install packages or push. Such a command fails and Codex is told why; it does not ask you. Commit its work yourself from Source Control.

Switch it to **Manual** and each agent asks before it acts. Do this if you want a person in the loop. See [Settings](settings.md).

## Protected commands: advice for Claude, not a lock

Kolux can make Claude stop and ask before it runs a risky command. When a command matches a rule, Claude shows its own permission prompt: "Kolux protected action: <name>. The command waits for you; allow it once to run it, or refuse to leave it unrun."

| Rule | What it catches |
|---|---|
| Stripe changes | Commands that change your Stripe account |
| Force-push to main | Overwriting the main branch's history |
| Deleting database tables | Dropping tables or other database objects |
| Infrastructure changes | Commands that change cloud or server setup |
| Production deploys | Pushing to a live site |
| Deleting folders outside the workspace | Recursive deletes that reach beyond the workspace |
| Throwing away uncommitted work | Commands that discard changes you have not saved in Git |

The rules look inside wrappers: chained commands, `$( )` substitutions (four levels deep), `sh -c`, `cmd /c`, PowerShell `-Command` and encoded commands, `eval`, `iex` and `wsl`.

**What this is not.** It is a warning, not a safety control.

- It covers **Claude only**. Codex and other agents are not guarded.
- It reads only Claude's Bash and PowerShell tools.
- A command that matches nothing gets no opinion, and a determined command can be written to slip past. The project's own review found four ways to do so.
- It becomes a real control only when the project owner decides so.

The master switch and a list of rules to turn off live in `settings.json` as `protectedAsk` (on unless saved otherwise) and `protectedOff`. There is no switch for them in the Settings pages. The Safety page in Settings carries a short note saying the same. Changes apply on the next command.

## Where Kolux asks first

| Action | When it asks |
|---|---|
| Closing a tab that is running a program | Always, if the setting is on (default). A tab with an idle shell closes at once |
| Deleting a workspace | By default. A workspace with changes, a lock or a nested workspace always asks |
| Discarding changes in Source Control | Always. It spells out what will be lost |
| Disconnecting Claude | Always: "Disconnect Claude?" |
| Closing the window with unsaved editor text | Always: Keep working, or Quit without saving |

## Files: the fence

The Kolux window reads and writes files only in two places: inside your projects and their workspaces, and single files you pick yourself with the "Open a file" choice.

- A file you pick is granted exactly, never its folder. At most 100 such grants are kept, oldest dropped, so tabs you reopen still work.
- Network shares and the top of a drive are never treated as a project.
- Paths are resolved through shortcuts and links first, so a link cannot lead outside.
- Paths on other computers are refused: "<path> is on another computer; Kolux never opens or checks paths on other machines".

When you do hit the fence, the editor says "<path> is outside your projects; Kolux reads and writes only inside them". It then offers **Open this file anyway**, which grants that one file for this session and nothing beneath it. Clicking a link to a program reveals it in its folder instead of running it.

Kolux decides what counts as a program from a fixed list of file types, not from what Windows would do with the file. The list covers scripts and installers and also remote-desktop shortcuts (`.rdp`), Windows Sandbox files (`.wsb`), update packages (`.msu`), provisioning packages (`.ppkg`), `.appref-ms` shortcuts and disk images (`.iso`, `.img`, `.vhd`, `.vhdx`). Opening a file this way needs a full path to a file that exists; a folder, a relative path or a missing file is refused. A name holding a hidden control character is refused too, because Windows can read such a name as a different file than the one shown.

**Show in file manager** in Source Control stays inside the workspace. Kolux checks each folder on the way to the file, and if any of them is a link (a symbolic link or junction), it refuses with an error saying the path "goes through a link that leads outside the worktree" and opens nothing, so a link cannot lead the file manager to a folder elsewhere. If the file or its folders have been deleted, it shows the nearest folder that still exists, as before. A workspace path that points at another computer is refused as well.

## Secrets

- Saved keys and sign-ins are sealed by the system keyring (Windows' secret store). There is no plain-text fallback.
- Secrets are never sent to the Kolux window.
- The data folder is limited to your Windows account.
- A key that can no longer be unsealed is cleared, and Kolux asks you to reconnect.
- Diagnostics are scrubbed before you share them. See [Troubleshooting](troubleshooting.md).

## Local doors that stay shut to web pages

Kolux runs two small listeners on your own computer, one for the command line and one for agent status hooks. Neither can be reached from the internet. Both also refuse web pages running in your browser: a request that looks like a web page request, or that arrives without the one-run secret key, is dropped or answered with an empty "not found". Browser tabs inside Kolux open only web addresses (http or https), never local files.

## What Kolux sends out

Nothing about your use. The list of outside connections is in Settings, General, Privacy. See [Settings](settings.md).

## Trust for new workspaces

Kolux pre-trusts the workspaces it creates, for Claude and Codex, so an agent's first prompt is not swallowed by a "do you trust this folder" question. Only workspaces Kolux made are pre-trusted. Pre-trust for Cursor and Copilot is not built.

<!-- verified against: src-tauri/src/protected.rs, src-tauri/src/hooks.rs, src-tauri/src/fence.rs, src-tauri/src/links.rs, src-tauri/src/files.rs, src-tauri/src/cli.rs, src-tauri/src/trust.rs, src/settings/AgentsPage.tsx, src-tauri/src/agents.rs, src/settings/privacy.ts, src-tauri/src/scm.rs at 2c8b9d8 -->

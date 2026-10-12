---
name: kolux-cli
description: Drive Kolux from a terminal - worktrees, repos, automations and JSON answers.
---

# Using the kolux command

Kolux answers commands typed in any terminal it started. Use it to make and remove
worktrees, look up repos, and manage automations without clicking through the app.

- `kolux worktree create --name <name>` makes a worktree in the current repo.
- `kolux worktree list`, `kolux worktree current` and `kolux worktree show` look things up.
- `kolux automations list` shows saved automations; `create`, `edit`, `remove` and `run` change them.
- `kolux agent-context --json` prints every command, its flags and its usage.

Add `--json` to any command for one machine-readable answer on stdout. Exit 0 means it worked.

Most commands need the app running. These work with it closed: help, agent-context and
skills list, get, install and update.

References: `kolux skills get kolux-cli --references` lists them.

# Worktrees and selectors

A worktree is a second checkout of a repo on its own branch, so two agents never edit
the same files.

- `kolux worktree create --name <name> [--repo <selector>] [--agent <id>] [--prompt <text>]`
- `kolux worktree rm --worktree <selector> [--force]` (also written `remove` or `delete`)
- `kolux worktree changes` lists what a worktree changed against its base.
- `kolux worktree overlap` says which other worktrees touch the same files, and whether
  merging them would conflict.

Selectors name a repo or worktree without its full path:

| Selector | Means |
|---|---|
| `--repo name:<name>` | a repo by its name |
| `--repo path:<folder>` | a repo by its folder |
| `--worktree current` | the worktree this terminal is in |
| `--worktree branch:<branch>` | the worktree on that branch |

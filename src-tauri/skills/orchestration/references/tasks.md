# Tasks and workers

- `task-create --spec <text> [--deps ["task-1"]]`: a task is ready once its dependencies finish.
- `task-list --ready` shows what can start now.
- `worker-start --task <id>` picks the agent by `--agent`, `--model` or `--tier`; it works in a
  new child worktree unless `--worktree` says otherwise.
- `dispatch --task <id> --to <handle>` gives a task to a terminal that is already open.
- `worker-abandon --dispatch <id>` gives up on a worker; its task goes back to ready.

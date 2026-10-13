# Tasks and workers

- `task-create --spec <text> [--deps ["task-1"]]`: a task is ready once its dependencies finish.
- `task-list --ready` shows what can start now.
- `worker-start --task <id>` picks the agent by `--agent`, `--model` or `--tier`; it works in a
  new child worktree unless `--worktree` says otherwise.
- `dispatch --task <id> --to <handle>` gives a task to a terminal that is already open.
- `worker-abandon --dispatch <id>` gives up on a worker; its task goes back to ready.
- `worker-stop --dispatch <id>` ends the worker's agent terminal and keeps its worktree; its task goes back to ready.
- `task-update --id <task> --status completed|failed|ready|pending|blocked [--result <text>]` moves a task; a
  dispatched one settles its worker in the same change.

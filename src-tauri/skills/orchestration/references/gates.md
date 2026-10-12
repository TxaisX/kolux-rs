# Decision gates

A gate holds a task until the coordinator decides something.

- `gate-create --task <id> --question <text> [--options ["yes","no"]]` needs a Run attached
  to this terminal; without one it fails and creates nothing.
- The task waits as blocked until every gate on it is resolved.
- `gate-resolve --id <gate> --resolution <text>` settles it; the task goes back to ready.
- `gate-list [--status pending|resolved]` shows this Run's gates; `--run <id>` reads another
  Run without attaching to it.

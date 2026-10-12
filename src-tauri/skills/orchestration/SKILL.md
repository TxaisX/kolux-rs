---
name: orchestration
description: Coordinate several agents in Kolux - Runs, mail, tasks, workers and decision gates.
---

# Coordinating agents in Kolux

One terminal is the coordinator. It opens a Run, splits the work into tasks, hands each
task to a worker in its own terminal, and reads what comes back.

1. `kolux orchestration run-create --objective <text>` opens a Run and attaches this terminal.
2. `kolux orchestration task-create --spec <text>` adds a task; `--deps` orders them.
3. `kolux orchestration worker-start --task <id> --tier build` starts a worker on a task.
4. `kolux orchestration check --wait` waits for mail; `reply --id <message>` answers.
5. `kolux orchestration gate-create --task <id> --question <text>` holds a task until you
   decide; `gate-resolve --id <gate> --resolution <text>` lets it go.

Workers report with `kolux orchestration send --outcome succeeded|failed`.

References: `kolux skills get orchestration --references` lists them.

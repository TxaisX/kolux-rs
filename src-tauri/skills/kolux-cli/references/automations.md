# Automations

An automation starts an agent with a saved prompt on a timetable.

- `kolux automations create --name <n> --trigger daily --time 09:00 --prompt <text>`
- `--trigger` takes hourly, daily, weekdays, weekly, a cron line or an RRULE.
- `--day` takes 0 to 6, with Sunday as 0. `--timezone` takes an IANA zone name.
- `--workspace <selector>` reuses one worktree; otherwise each run gets a new one.
- `--precheck <command>` runs first, in the run's folder, ahead of a timed run (never `run`): any exit
  code but 0 skips the run. `--precheck-timeout` is 60, 120, 300 or 600 seconds (60 if not given).
- `--missed-run-grace-minutes` (0, 30, 60, 180, 720, 1440 or 2880) says how late a run missed while
  Kolux was closed may still start.
- `kolux automations edit <id>` changes fields; give `--trigger` with any timetable change.
- `kolux automations run <id>` starts it now; `runs <id>` lists what happened.

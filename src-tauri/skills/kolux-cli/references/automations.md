# Automations

An automation starts an agent with a saved prompt on a timetable.

- `kolux automations create --name <n> --trigger daily --time 09:00 --prompt <text>`
- `--trigger` takes hourly, daily, weekdays, weekly, a cron line or an RRULE.
- `--day` takes 0 to 6, with Sunday as 0. `--timezone` takes an IANA zone name.
- `--workspace <selector>` reuses one worktree; otherwise each run gets a new one.
- `kolux automations edit <id>` changes fields; give `--trigger` with any timetable change.
- `kolux automations run <id>` starts it now; `runs <id>` lists what happened.

# Mail between terminals

Every message goes to a terminal handle (`term-3`), a whole Run (`run:<id>`) or a
dispatch (`dispatch:<id>`).

- `send --subject <s> --body <text> --to <who>` sends; `--priority high|urgent` raises it.
- `check` reads new mail once; `check --wait` blocks until mail arrives or the timeout passes.
- `inbox` lists what this terminal has received; `reply --id <message>` answers in the thread.
- A terminal only reads mail from terminals in the same Run.

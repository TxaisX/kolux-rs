# Kolux memory: a local record of agent work

<!-- html -->

A session ends and its context dies with it. The next agent inherits a handoff note, a few reports
and a git history, but not the 10,000 tool calls that produced them. This adds a rebuildable local
database so the next session can ask what was tried, what failed, and who did it.

## What it is

`tools/kolux-memory/` is a stdlib-only Node tool (`node:sqlite`). It reads sources that already
exist on the machine and builds one SQLite file:

- the local agent session store, for sessions, messages and tool calls;
- the repository, for every commit on every branch, worktrees, spec cards and evidence files;
- the vault, for Kolux project notes, syntheses and handoff notes;
- optionally GitHub, for pull requests and releases.

The database is written to `%APPDATA%\com.txaisxiong.kolux-rs\memory\kolux-memory.db` by default.
**It is never committed.** Each machine builds its own, and the file differs because the work differs.
The tool and its schema are the shared part.

## Why not one shared database

A shared file would mix machines, leak one profile's session text to another, and go stale the moment
someone worked offline. A local build is smaller, private, and always current. `build` is idempotent
and takes about 7 seconds; deleting the file costs nothing.

History alone cannot hold everything. A session can record a completed item with `record`; that
appends one line to `work-items.jsonl` beside the database. Every later `build` replays the ledger,
so the record survives a rebuilt or deleted cache. The ledger is the part a rebuild cannot derive.

## What it stores

| Table | Author's machine | Contents |
|---|---|---|
| `sessions` | 59 | agent, model, directory, cost, tokens, timestamps |
| `messages` | 1,348 | user and assistant text; reasoning is dropped |
| `tools` | 10,600+ | tool name, status, input and output preview |
| `commits` | 2,944 | sha, author, date, subject, body, files, insertions, deletions |
| `prs`, `releases` | 36, 3 | optional `gh` enrichment |
| `cards` | 1,264 | every spec card, tier, boxes done, pass/open |
| `evidence` | 2,530 | path, card, task, PASS/FAIL, first line |
| `documents` | 58+ | project notes, syntheses, repo docs, handoffs |
| `agents` | roles and models | sessions, messages, last seen |
| `work_items` | the ledger | completed items written with `record`, newest first |
| `events` | merged | sessions, commits, PRs, releases, docs, evidence and recorded work |
| `search` | FTS5 | full-text search across messages, tools, commits, evidence, docs and recorded work |

## Commands

```
node tools/kolux-memory/cli.mjs build --github
node tools/kolux-memory/cli.mjs status
node tools/kolux-memory/cli.mjs resume
node tools/kolux-memory/cli.mjs search "first load"
node tools/kolux-memory/cli.mjs card BROW-008
node tools/kolux-memory/cli.mjs timeline --days 2 --kind commit
node tools/kolux-memory/cli.mjs record --agent memory-scout --title "Built the memory database (PR #36 open)" --status done --detail "PR #36"
node tools/kolux-memory/cli.mjs items --agent memory-scout
```

`resume` is the handoff brief: scoreboard, open P0 cards, failures on open cards, recorded work, the
last three days of work, and the agents involved. Run it at the start of a session, and `build` at
the end.

## Privacy

- Local only. No network call unless `--github` is passed.
- Reasoning blocks are not stored.
- Credential-shaped strings are replaced with `[redacted]` before they reach the database: API keys,
  GitHub and Slack tokens, AWS keys, private key blocks, bearer tokens, and `key=value` secrets.
- The database still holds the text agents wrote, so treat it like the session store it came from:
  do not commit it, attach it to an issue, or sync it to a shared drive.

## Verification

```powershell
node --test tools/kolux-memory/test.mjs
```

The five tests build a synthetic machine: a session store with a secret in a user message, a spec
with an open card and a struck card, evidence whose card is on line 2, and a missing-source case.
They assert redaction, card state, evidence mapping, search and the resume brief. The fifth records
a completed item, queries it back, rebuilds the database and queries it again.

The end-to-end build on this machine produced:

```
sessions 59  messages 1348  tools 10622  agents 5
P0 cards 215/228 passing, 13 open
evidence 2530 (4 FAIL)  documents 58  handoffs 5
commits 2944  PRs 36  releases 3
database 73.2 MB
```

A real record and query, in the same sample database:

```
$ node tools/kolux-memory/cli.mjs record --agent memory-scout --title "Built the local Kolux memory database (PR #36 open)" --status done --detail "PR #36"
recorded "Built the local Kolux memory database (PR #36 open)" for memory-scout (done)

$ node tools/kolux-memory/cli.mjs items --agent memory-scout
1 recorded item(s) for memory-scout
  2026-10-31T14:41:37.327Z  memory-scout  done  Built the local Kolux memory database (PR #36 open)
```

## Limits

- Only the local OpenCode session store is read. A Claude Code or Codex session that never went
  through it needs its own adapter.
- GitHub is optional because a fresh machine may have no `gh` login.
- Tool output makes the file large. It is about 70 MB for 10,000 calls; clip more in `lib.mjs` if a
  machine is short on disk.

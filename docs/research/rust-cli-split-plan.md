# Splitting `src-tauri/src/cli.rs`: module plan

Measured at `a1c590d0` (this worktree, branch `lane4/rust-split`), from
`src-tauri/src/cli.rs` itself: **596,822 bytes, 8,946 lines**. It is one file that holds the
whole `kolux` / `kolux-dev` command line: the usage text, argument parsing, the client that talks
to the running app, the app-side dispatcher for every command, and the tests for all of it.

This is the same defect the front end already fixed (`App.tsx`, 3,315 lines to 203), and it was
never fixed on the Rust side. This document is the plan; the first slice of it is executed in the
same pass (see `docs/research/rust-cli-split.md`).

## How the file is laid out today

Byte sizes are exact; read by byte offset of each line start, so they include the long single-line
string constants (the usage text is 3 lines but 18,368 bytes).

| Lines | Bytes | What lives there |
|---|---|---|
| 1–104 | 4,004 | Module declarations (`automations_cli`, `local_cli`, `cli_register`, `file_cli`, `worker_read`), wire types `Request`, `Pane`, `Fail`, `Parsed`, `envelope`, `bundled_skills`, constants `FILE`, `EVENT`, `APP_DIR_ENV` |
| 105–398 | 36,287 | The command table (`TERMINAL`, `MAIL`, `TERM`, `QUERY`, flags), the usage text `HELP` (18,368 B), typo suggestion (`near`, `nearest`, `command_typo`, `flag_typo`), `camel`, `known_flag`, `commands()` |
| 399–727 | 18,798 | `parse()` and its help detection |
| 728–838 | 5,864 | Argument validation: `check_terminal`, `max_depth`, `check_worker_start` |
| 839–976 | 7,615 | Client plumbing: `data_dir`, `read_endpoint`, `call`, `call_within`, `open` |
| 977–1179 | 11,868 | `memory_figure`, `memory_text`, status wire names, `status_of`, `status_line`, `span`, `status_exit`, `launch_app`, `app_command`, `request_id` |
| 1180–1494 | 20,218 | `text_of`, `text_core` (the plain-text answer for every command), `mail_lines` |
| 1495–1631 | 6,838 | `hand_back_after`, `exit_status`, `wait_for_mail`, `wait_for_terminal`, `wait_step` |
| 1632–1719 | 4,626 | `version_only`, `help_path`, `GLOBAL`, `help_raw`, `help`, `named` |
| 1720–1896 | 8,984 | `main()`: the `kolux-dev` program |
| 1897–2279 | 23,638 | `Ctx`, selectors (`selector`, `pick_project`, `pick_worktree`, `pick_in`), `dispatch()` |
| 2280–2502 | 13,664 | Terminal commands (`terminal_cmd`) and `terminal_text` |
| 2503–2695 | 10,874 | Repo/worktree reads: `repo_row`, `worktree_row`, `scan`, `ps`, `hosts`, `base_of`, `change_rows`, `overlap` |
| 2696–2922 | 14,056 | `query()` and `query_text` |
| 2923–3122 | 11,349 | Mail caller identity, caps, `reset` |
| 3123–3364 | 16,585 | `tasks()` |
| 3365–3708 | 20,701 | Terminal I/O: submit verdict, `terminal_io` |
| 3709–3826 | 6,409 | Typing into terminals, retry memos, `send_once` |
| 3827–3924 | 5,972 | Dispatch list storage, `keep_transcripts`, agent choice |
| 3925–4335 | 22,539 | Dispatch stamps: late notes, tabs, `reuse` |
| 4336–4888 | 33,772 | `worker_start` and everything it launches |
| 4889–5039 | 8,154 | The loopback server: `serve_loop`, `serve`, `caller_distro` |
| 5040–8946 | 284,036 | `mod tests` (3,906 lines) |

Two facts drive the plan:

1. **The tests are 48% of the file** (284 KB of 597 KB). The production code is 313 KB.
2. **The file is already grouped by cohesion** with section comments, but not by module boundary.
   Most private helpers are called from exactly one cluster of commands, so a move is mostly
   mechanical; the exceptions are the command table constants and the text renderers, which are
   read from many places.

## Proposed module map

Parent stays `src/cli/mod.rs` (the task asks for a `cli/` module directory). The five
`#[path = "..."]` child module declarations move with it and need `../` prefixes, because
`#[path]` resolves relative to the directory holding `mod.rs`.

| Module | Contents | Size | Cross-references |
|---|---|---|---|
| `cli/mod.rs` | Wire types, `main()`, `Ctx`, `dispatch()`, `bundled_skills`, the constants shared across commands, and whatever has not moved yet | shrinking | — |
| `cli/args.rs` | Command table, flag constants, `commands()`, `camel`, `known_flag`, `near`/`nearest`/`line`, `command_typo`, `flag_typo`, `parse()`, `check_terminal`, `max_depth`, `check_worker_start` | ~42 KB | Reads `automations_cli`/`local_cli`/`file_cli`/`browser::cli`/`orchestration::runtime` command lists; `Fail`, `Parsed` |
| `cli/help.rs` | `HELP`, `GLOBAL`, `help_raw`, `help`, `named`, `help_path`, `version_only` | ~23 KB | `commands()`, `nearest`, `SWITCHES`, `known_flag` from `args` |
| `cli/text.rs` | Plain-text answers: `text_of`, `text_core`, `mail_lines`, `memory_figure`, `memory_text`, `status_line`, `span`, `terminal_text`, `query_text` | ~36 KB | Command constants; `local_cli::text`, `browser::cli::text`, `automations_cli::text`, `runtime::text`, `file_cli::text_of`, `cli_accounts::text` |
| `cli/client.rs` | `data_dir`, `read_endpoint`, `call`, `call_within`, `open`, `launch_app`, `app_command`, `request_id`, `status_of`, `ask_status`, `status_exit`, `STATES`, `GRAPH_READY`, `status_answer`, wait helpers (`wait_for_mail`, `wait_for_terminal`, `wait_step`, `hand_back_after`, `exit_status`) | ~30 KB | `Fail`, `Request`, `STATUS_WAIT` |
| `cli/query.rs` | `repo_row`, `worktree_row`, `scan`, `ps`, `hosts`, `base_of`, `change_rows`, `overlap`, `query` | ~25 KB | `Ctx`, selectors, `crate::scm`, `crate::git` |
| `cli/terminal.rs` | `terminal_cmd`, layout helpers, `terminal_io`, submit verdict, `send_once`, typing | ~35 KB | `Ctx`, `Terminals`, orchestration delivery |
| `cli/mail.rs` | caller identity, `caps`, `reset`, `tasks`, `mail`, `seen_from`, `in_run` | ~28 KB | `crate::orchestration`, store |
| `cli/orch.rs` | dispatch stamps, late notes, `reuse`, `worker_start` and its helpers | ~56 KB | `Ctx`, terminal module, mail module |
| `cli/serve.rs` | `serve_loop`, `serve_loop_with`, `serve`, `busy_status`, `caller_distro` | ~8 KB | `Request`, `envelope`, `STATUS_WAIT` |
| `cli/tests.rs` | `mod tests` unchanged, `use super::*` | 284 KB | Everything above, via re-exports in `mod.rs` |

Public API rule: anything that is `pub` today stays `pub` in its new module and is re-exported from
`mod.rs` with `pub use`, so `crate::cli::parse`, `crate::cli::dispatch`, `crate::cli::Ctx`,
`crate::cli::FILE`, `crate::cli::STATES` and the rest keep the same paths. Private helpers used by
`mod.rs` become `pub(super)`; that is a widening inside `cli` only, never outside it.

## First slice: `args.rs` + `help.rs` + `text.rs` (103,095 B measured, 3 modules)

Why this one first:

- **Fewest edges into the rest of the file.** `parse`, the typo suggestions and the help printer
  read the command tables and nothing else; they never touch `Ctx`, the store, terminals, git or
  the network. The only outward calls are the sibling command tables that already live in their
  own modules (`automations_cli`, `local_cli`, `file_cli`, `browser::cli`,
  `orchestration::runtime`).
- **The text renderers are pure functions over `Value`.** They read a JSON answer and return a
  `String`. They have no state, no I/O and no ordering requirements, so moving them cannot change
  behaviour. They are also the piece most likely to grow, and they are the reason `text_core` is a
  single 280-line match.
- Together they are the "shared arg parsing", "help output" and "shared output/JSON shaping" of
  the task's own example grouping, and they clear 103,095 B, 17.3% of the file, without touching the
  dispatcher.

Rejected for the first slice:

- `dispatch()` / `Ctx` (23.6 KB): it is the hub every command touches, so moving it first would
  force edits across all remaining code with no size win.
- `worker_start` (33.8 KB): the most tangled block in the file (terminals, store, mail, stamps,
  spawning) and the worst place to learn the file's edges.
- Tests (284 KB): the biggest single win, but moving them proves nothing about the production
  boundaries and makes the diff unreviewable in one pass. They move last, once the production
  modules are settled.

## What is deliberately left for later passes

`client.rs`, `query.rs`, `terminal.rs`, `mail.rs`, `orch.rs`, `serve.rs` and `tests.rs` stay in
`mod.rs` for now. `mod.rs` will still be large (495,337 B) after this slice; the remaining moves are
listed above with their measured sizes so the next pass can pick them up without re-deriving the
boundaries.

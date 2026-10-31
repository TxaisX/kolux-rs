# Splitting `cli.rs`: slice 1, argument parsing, help and the text answers

<!-- html -->

`src-tauri/src/cli.rs` was 596,822 bytes in one file: the whole `kolux` / `kolux-dev` command
line, its client, the app-side dispatcher for every command, and every test. This pass moves the
first coherent slice out of it and proves the move changed nothing. The plan and the remaining
boundaries are in [the split plan](rust-cli-split-plan.md).

## What moved

| New file | Bytes | Lines | Contents |
|---|---|---|---|
| `src-tauri/src/cli/args.rs` | 43,113 | 733 | The command table (`TERMINAL`, `MAIL`, `TERM`, `QUERY` and the flag lists), `commands()`, `camel`, `known_flag`, the typo suggestions (`near`, `nearest`, `line`, `command_typo`, `flag_typo`), `parse()`, and the flag checks (`check_terminal`, `max_depth`, `check_worker_start`) |
| `src-tauri/src/cli/help.rs` | 23,153 | 96 | The usage text `HELP`, `GLOBAL`, `help_raw`, `help`, `named`, `help_path`, `version_only` |
| `src-tauri/src/cli/text.rs` | 36,806 | 587 | The plain-text answer of every command: `text_of`, `text_core`, `mail_lines`, `memory_figure`, `memory_text`, `status_line`, `span`, `terminal_text`, `query_text` |

`src-tauri/src/cli.rs` became `src-tauri/src/cli/mod.rs`: 495,337 bytes, 7,556 lines.

Moved: 103,072 bytes, 17.3% of the file, in three modules. The parent shrank by 101,485 bytes
(17.0%); the 1,587-byte difference is module boilerplate (three 4-line module headers, three
`use super::*` lines, the `mod` declarations and the import block).

## Why these boundaries

They are the file's own seams, not an imposed split:

- **`args.rs`** is everything that turns a typed command line into a `Parsed` call. It reads the
  command tables and nothing else: no `Ctx`, no store, no terminals, no git, no network. Its only
  outward references are the sibling command tables that already live in their own modules
  (`automations_cli`, `local_cli`, `file_cli`, `browser::cli`, `orchestration::runtime`).
- **`help.rs`** is the usage text and the printer over it. It shares `commands()` and `nearest()`
  with `args.rs` and nothing else. `HELP` is a 16 KB single-line constant; keeping it next to the
  code that parses it by `\n\n` blocks is the only place it stays readable.
- **`text.rs`** is every function that turns a JSON result into the string a person sees. They are
  pure: a `&str` command name and a `&Value` in, a `String` out, no state and no ordering. They
  were scattered through the file (memory at 979, status at 1101, the main renderer at 1174,
  terminal at 2449, query at 2793), which is exactly why they were easy to lose track of.

The slices rejected for this pass are recorded in the plan: `dispatch`/`Ctx` is the hub every
command touches, `worker_start` is the most tangled block, and the test module is half the file
but proves nothing about the production seams.

## How "no behaviour change" was checked

1. **Byte-exact extraction.** The new files were cut from the original by line offset, not
   retyped. A throwaway checker (`G:\Temp\opencode\verify-split.ps1`, not committed) read the
   original blob (`git cat-file blob HEAD:src-tauri/src/cli.rs`), read the four new files, stripped
   the `pub(super) ` visibility prefix, and compared line by line against the exact source ranges.
   Output:

   ```
   OK args.rs = HEAD 105-113 + 117-834 (727 lines)
   OK help.rs = HEAD 114-116 + 1632-1717 (90 lines)
   OK text.rs = HEAD 979-1033, 1101-1125, 1174-1492, 2449-2499, 2793-2919 (581 lines)
   OK mod.rs = HEAD minus the moved ranges (with the five ../ paths) (7546 lines)
   PURE MOVE: every line accounted for
   ```

   The only intended differences are the `pub(super) ` prefixes (visibility inside `cli` only) and
   the five `#[path = "../….rs"]` attributes. Those five are required: `#[path]` on a module
   declared in `cli/mod.rs` resolves against `src/cli/`, so the five sibling modules that stay in
   `src/` gain `../`. Every other line, including every error string, comment and blank line, is
   identical.

2. **Public API unchanged.** Only two moved items were `pub`: `parse` and `Parsed`. Both are
   re-exported from `cli/mod.rs` (`pub use self::args::{parse, Parsed};`), so `crate::cli::parse`
   and `crate::cli::Parsed` resolve exactly as before — `browser_cli.rs` and the tests use them and
   compile unchanged. No public item was renamed, and nothing private became public outside the
   `cli` tree.

3. **Tests did not move.** All 98 `#[test]` functions in the CLI tree are still in `cli/mod.rs`'s
   `mod tests`, untouched; the count before and after is 98.

4. **Compiler agreement.** `cargo check` is clean with no warnings. The cli module's own tests pass:
   164 of 164. The full suite was **not** confirmed green in this worktree — it runs
   `2,644 passed, 2 failed`, and both failures are environment-caused and named with their cause in
   `evidence/rust-cli-split.txt` (a CRLF-sensitive source scan, and a batch file whose `find` exits 1
   on an empty folder). Neither mentions `cli`. A repeat of the full suite was interrupted before it
   finished, so no green full run is claimed.

## What is left

`cli/mod.rs` is still 495,337 bytes, and 284 KB of that is the test module. The remaining
production code — the client, the dispatcher, the command implementations and the loopback server
— is exactly where the plan says it is, with the next boundaries already measured:

| Next module | Contents | Size |
|---|---|---|
| `cli/client.rs` | `data_dir`, `read_endpoint`, `call`, `open`, `status_of`, `launch_app`, the wait helpers | ~30 KB |
| `cli/query.rs` | repo/worktree reads, `ps`, `overlap`, `query` | ~25 KB |
| `cli/terminal.rs` | `terminal_cmd`, `terminal_io`, submit verdict, `send_once` | ~35 KB |
| `cli/mail.rs` | caller identity, caps, `reset`, `tasks`, `mail` | ~28 KB |
| `cli/orch.rs` | stamps, late notes, `reuse`, `worker_start` | ~56 KB |
| `cli/serve.rs` | `serve_loop`, `serve`, `caller_distro` | ~8 KB |
| `cli/tests.rs` | the 3,906-line test module, unchanged | 284 KB |

Two things this pass deliberately did **not** do:

- It did not move the tests. They are the largest single win but they cross every remaining
  boundary, so they move last, once the production modules are settled.
- It did not update the historical documents that name `src-tauri/src/cli.rs` with line numbers
  (`PLAN.md`, `STATE-history.md`, the audit files, the `docs/*.md` "verified against" footnotes).
  Those are records of past passes, not build inputs; rewriting them here would mix a pure move
  with a documentation change and make the diff harder to review.

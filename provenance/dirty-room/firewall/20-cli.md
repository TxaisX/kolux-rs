# Firewall scrub report · 20 The `kolux` CLI

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/20-cli.json` (56 cards, generated 2026-10-06, all round 0, critic round 1 rules folded in)
- Output: `spec/20-cli.md` (ids CLI-nnn, number taken from D-20-nnn)

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 11 | 11 |
| P1 | 35 | 35 |
| P2 | 1 | 1 |
| H | 1 | 1 |
| X | 0 | 0 |
| D | 8 | 8 |
| **Total** | **56** | **56** |

The area row expected 25–45 cards; the raw JSON holds 56, and all 56 were written. Sort order in the
spec: tier, then `pushed` (null last), then id. Tier, pushed and state come straight from the raw
JSON through the generator for every card; the generator refuses a card with fewer than two
acceptance items or an H/D card with no decision. Raw cards with one acceptance item (CLI-016,
CLI-037, CLI-041, CLI-042) and the H and D cards whose acceptance read "n/a" (CLI-048 to CLI-056)
got new items written from the card's own rules. All prose (title, user does, user sees, rules,
acceptance, compat, decision) was rewritten, not transcribed.

## Leaks found and how each was fixed

Method: (1) a naive render of the raw card prose (evidence excluded) was run through
`scripts/firewall-check.ps1` — 27 hits, one of them a false positive (prose "import accounts");
(2) manual read of the raw prose against the forbidden list for what the script cannot see (paths
outside the old source folders, dependency names written in lower case, field names in prose);
(3) the six-word similarity hunt on the finished spec (next section). The raw prose contained no
quoted UI copy and no quoted error messages.

| Category | Found | Where (raw card) | Fix |
|---|---|---|---|
| Path | 5 | 022 (example relative source path), 006 (bundled CLI folder), 008 (system-wide and per-user local program folders), 043 (reference path inside a guide) | Described as "the bundled CLI folder in the per-user install", "the system-wide folder for locally installed programs", "the per-user programs folder under the home directory", "its path inside the guide's references folder"; the example path was dropped |
| Identifier | 11 | 031, 039 (three message-type names with underscores); 007, 039, 050 (five environment variable names); 047 (two camelCase cookie flags); 001 (help-path placeholder in backticks) | Message types written as "worker done, merge ready and decision gate" in prose, shown typed only inside one full `kolux orchestration send` example; environment variables described as "the terminal's handle and its pane key" and "a separate environment variable"; cookie flags shown only inside one full `kolux cookie set` example and otherwise described in words; help path written as "kolux help followed by a command path" |
| Schema | 6 | 042 (four command-map field names), 004 (runtime id field and the envelope's key names) | Described in plain words (schema version, command count, whether arguments are parsed or passed raw, bare arguments; request id, success flag, result, error code, message, data, runtime id in metadata); Compat lines point to COMPAT.md for the exact names |
| Library | 2 | 013 (the desktop framework's run-as-node switch), 046 (the browser-automation package name) | "the setting that makes the app's own program behave as a bare script runtime"; "the underlying browser-automation engine" |
| UI copy | 0 | — | — |
| Error text | 0 | — | — |
| Verbatim prose | 0 from raw | — | Raw prose was not transcribed; overlaps found in the finished spec are counted under the similarity hunt |

Leaks fixed (counted): 5 path + 11 identifier + 6 schema + 2 library = **24**.

## Firewall script

- First run: `firewall-check: 7 hit(s) across 1 file(s)`. All seven came from the generator's line
  wrapping cutting backtick spans across lines (an example command split mid-span left its
  underscore and camelCase values outside backticks). Fixed by keeping every backtick span unbroken
  when wrapping; no wording changed.
- Final run: `firewall-check: 0 hit(s) across 1 file(s)`.

## Similarity hunt

Method: every six-word window inside each punctuation-free clause of the spec prose (Tier, Source,
Tier counts and Related areas lines excluded), deduplicated, written to a phrases file. Two passes
over `src`, `tests`, `docs`, `README.md`, `HANDOFF.md`, `HANDOFF-HISTORY.md` of the old repo:
(a) a word-window pass over every text file with comment leaders stripped and whitespace collapsed,
so phrases wrapped across lines are caught; (b) one `rg -iF -j4 -a -o -f` pass of the whole phrases
file.

- Pass 1 (2,736 phrases): 27 matches → 20 sentences rewritten. Most were coincidental stock
  phrasing ("have nothing to do with", "a process that is still running"), plus two example commands
  that equalled examples in the old help text and a few clauses that echoed test titles.
- Method fix: spec lines were not joined before windowing, so windows crossing a wrapped line were
  missed. Rerun with whitespace collapsed (3,723 phrases): 3 matches → 2 sentences rewritten.
- `rg` pass: 3 matches the word pass missed, because a closing quote glued to the last word hid it
  (two clauses that echoed test titles, one example command). Rewritten, and the word pass now trims
  quotes at word edges.
- Final pass: **3,728 phrases checked, 0 matches in both passes.** Similarity hits fixed: **33**
  matched phrases across **25** rewritten sentences.

Tooling note: `rg` is not on PATH here; the copy bundled with VS Code was used, pinned to `-j4`.

## Allowlist candidates

- `worker_done`, `merge_ready`, `decision_gate` — message types typed after `--type`.
- `--httpOnly`, `--sameSite` — cookie set flags as typed (camelCase).
- `KOLUX_TERMINAL_HANDLE`, `KOLUX_PANE_KEY` — environment values agents and skills read by name.
- `kolux.cmd`, `kolux.exe` — the two Windows entry names (pass in prose, would hit inside backticks).

## Residual risks

1. CLI-042: the command map's exact field names and CLI-004's envelope field names are what scripts
   and skills read. The spec describes them in words only; the clean room must take the names from
   COMPAT.md or an owner decision, or the map and envelope will not be compatible.
2. CLI-007 and CLI-039: the two environment value names are a compat need but appear only as
   descriptions until they are allowlisted or listed in COMPAT.md.
3. CLI-046 and CLI-047 list browser verbs and flags in the order of the old command catalogue.
   These are typed interface words (allowed), but the lists are long; exec hands a raw string to an
   unnamed engine, so its accepted syntax depends on the engine the clean room chooses.
4. CLI-001 says four global options exist at 0.15.0; two belong to the dropped CLI-050, so the
   rebuilt CLI will have two unless CLI-050 is revived.
5. WSL path handling kept in CLI-009 (selector rule) and CLI-022 (file open) and WSL account marking
   (raw note on CLI-014) sit beside the WSL cut in CLI-052; owner should confirm.
6. Opening a link on the paired client sits in dropped CLI-050; it may belong with CLI-045 (browser
   tabs).
7. Help-copy drift noted in the raw JSON (orchestration check format flag, run-list cursor) is not
   carried into the spec.
8. CLI-048: the retirement date is not known; it was already retired when the history begins
   (2026-09-10).
9. Six test files had no dumped titles; acceptance items for those behaviours were written from the
   rules, not from tests.
10. Platform and format names kept as user-visible terms: AppImage, macOS Keychain, Program Files,
    PowerShell 5.1, cmd, RRULE, IANA, UUID, base64. None is an old dependency, but a stricter reader
    may want some paraphrased.
11. The similarity hunt catches exact six-word runs only; a close paraphrase, or a match broken by
    punctuation the old text uses differently, would not show.
12. Cards overlap with areas 01, 03, 08, 13, 15, 17 and 19 (worktree, terminal, orchestration,
    browser, skills, settings and lifecycle behaviour); the clean room should treat this area as the
    command-line surface over those features, not a second definition of them.

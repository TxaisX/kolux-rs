# Firewall scrub report · 09 Automations

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/09-automations.json` (29 cards, generated 2026-10-06, all round 0)
- Output: `spec/09-automations.md` (ids AUTO-nnn, number taken from D-09-nnn)

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 8 | 8 |
| P1 | 15 | 15 |
| P2 | 2 | 2 |
| H | 0 | 0 |
| X | 0 | 0 |
| D | 4 | 4 |
| **Total** | **29** | **29** |

Sort order in the spec: tier, then `pushed` (null last), then id. Tier, pushed and state were checked
against the raw JSON by the generator for every card. Every card has at least two acceptance items.
All prose (title, user does, user sees, rules, acceptance, compat, decision) was rewritten, not
transcribed.

## Leaks found and how each was fixed

Method: (1) a naive render of the raw card prose was run through `scripts/firewall-check.ps1`;
(2) the raw card prose was run through the same exhaustive six-word similarity hunt used on the spec
(1,661 phrases); (3) manual read against the forbidden list.

| Category | Found | Where (raw card) | Fix |
|---|---|---|---|
| Schema / stored values (snake_case) | 3 tokens | D-09-004 compat: the three stored event-kind keys | Compat rewritten as a behaviour-level carry-over rule: keep whether an automation is timed or event-driven and which of the three events it listens for. No stored names. |
| Schema / stored values (snake_case) | 5 tokens | D-09-012 compat: the stored run-status keys | Compat rewritten as: keep each run's status (four progress states, four skip causes, failed to dispatch) and how it started. Statuses named only as plain words the user sees. |
| Verbatim prose (HANDOFF-HISTORY) | 4 sentences | D-09-004 user_does ("an agent finishes in the project", HANDOFF-HISTORY.md:542), rule 2 (baseline sentence, :545), rule 9 (watcher sentence, :551), rule 10 (configured-workspace sentence, :553) | Each sentence rewritten from scratch with different structure and vocabulary. |
| Verbatim prose (test title) | 1 sentence | D-09-004 rule 11 (switching back to Schedule; AutomationEventTriggerField.render.test.tsx:124) | Rewritten ("going back to Schedule throws away the saved event and works out the upcoming run afresh"). |
| Verbatim prose (test title) | 1 sentence | D-09-012 rule 2 (pane never leaves pre-dispatch state; runtime-terminal-run-observer.test.ts:160) | Rewritten ("if the pane stays in the state it had before launch"). |
| Paths / identifiers | 0 in prose | 145 `evidence` references | Evidence column is not rendered; it stays in cards-raw only. Not counted as leaks. |
| UI copy over six words | 0 | — | Labels kept to four words or fewer: New Automation, Edit, Run Now, View run, Resume workspace, Rerun, Retry, Refresh, Runs, Overview, Schedule, Event, Custom. Starter-template names paraphrased. |
| Error text | 0 | — | Refusal reasons and the skipped-entry message described, never quoted. |
| Library names | 0 | — | — |
| Precaution (not a forbidden-list hit) | 1 | D-09-010 "project setup hook" | Reworded as "a setup script saved in the project's settings" so no internal mechanism is named. |

Leaks fixed (counted): 8 schema tokens + 6 verbatim sentences = **14**.

## Firewall script

- First run on the generated spec: `firewall-check: 0 hit(s) across 1 file(s)`.
- Final run (after the similarity rewrites): `firewall-check: 0 hit(s) across 1 file(s)`.

## Similarity hunt

- Method: exhaustive, stronger than three phrases per card. Every six-word window inside each
  punctuation-free clause of every card (plus the scope paragraph and the Dropped lines) was searched:
  pass 1 with ripgrep fixed-string, case-insensitive, binary-as-text, over `src`, `tests`, `docs`,
  `README.md`, `HANDOFF.md`, `HANDOFF-HISTORY.md`; pass 2 as a whitespace-normalised substring search
  over the markdown under `docs` plus README and both HANDOFF files, to catch phrases split by line wraps.
- Pass 1 of the draft: 2,051 phrases, 2 matches, both generic and in unrelated test files:
  - AUTO-008 "the exit code and what the" (rate-limits codex fetcher test) → rewritten to
    "along with the exit status number and the command's printed output".
  - AUTO-012 "in the middle of a run" (browser screencast test) → rewritten to
    "Restart Kolux while a run is still going".
- Final pass: **2,052 phrases checked, 0 matches.** Similarity hits fixed: **2**.
- Tooling note: no `rg` on PATH; the ripgrep bundled with VS Code was used with `-j4`. With its default
  thread count it returned partial results in this sandbox (3 files instead of 431 for a control word),
  so every search here pinned `-j4`.

## Allowlist candidates

None. No legitimate interface token was hit; `kolux.yaml`, `DECISIONS.md`, `kolux` commands and
`--flags` are already allowed.

## Residual risks

1. Hermes and OpenClaw cron-job integration (AUTO-025, and the setup/precheck/event exclusions that
   mention them) is tiered P1 by the reader; it is a third-party integration not named in the owner
   cuts. Owner should confirm keep or cut.
2. Entry point unknown: in the redesign the sidebar Automations row is off by default and no top-bar
   entry was found. The spec states this in the scope paragraph rather than inventing an entry point.
3. Run status words (pending, dispatching, dispatched, completed, failed to dispatch) and skip causes
   are the old app's visible vocabulary, kept as single plain words because the user sees them. They are
   not the stored keys.
4. The D cards' acceptance items, and AUTO-024's second acceptance item, were written at this stage
   (the raw D cards had "n/a — decision item"; the format needs two). They are derived from the
   card's own user-sees and decision text, not from new evidence.
5. The similarity hunt is line-level for code and tests: a copied phrase split across two lines inside
   a source comment or a multi-line test title would not be caught. Markdown prose was covered with
   wrap-insensitive matching.
6. Concrete numbers (60-second default and 10-minute ceiling for prechecks, 4,000 characters of
   precheck output, 2,048 prompt characters searched, 100 runs kept, five-minute event cooldown, about
   15 minutes to notice a new pull request, batches of 100 rows, smooth at 10,000 runs) are carried as
   behaviour facts; they are not code but they do mirror the old implementation's constants.

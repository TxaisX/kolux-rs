# Firewall scrub report · 11 Git, source control & review

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/11-git-review.json` (86 cards, generated 2026-10-06; critic
  round 1 notes present, no round 1-3 card additions)
- Output: `spec/11-git-review.md` (ids GIT-nnn, number taken from D-11-nnn)

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 12 | 12 |
| P1 | 38 | 38 |
| P2 | 21 | 21 |
| H | 0 | 0 |
| X | 0 | 0 |
| D | 15 | 15 |
| **Total** | **86** | **86** |

Sort order in the spec: tier, then `pushed` (null last, shown as —), then id. Tier, pushed and state
were copied from the raw JSON by the generator, which also refused to write unless every raw card had
exactly one rewritten block, every card had at least two acceptance items and every D card had a
Decision line. All prose (title, user does, user sees, rules, acceptance, compat, decision, scope
paragraph, Dropped lines) was rewritten, not transcribed.

## Leaks found and how each was fixed

Method: (1) a naive render of the raw card prose was run through `scripts/firewall-check.ps1`
(7 hits); (2) the raw card prose was run through the same six-word similarity hunt used on the spec
(2,850 phrases, 6 matching windows in 5 sentences); (3) a manual read against the forbidden list.

| Category | Found | Where (raw card) | Fix |
|---|---|---|---|
| Identifier (camelCase keybinding ids) | 6 tokens | D-11-001 compat (toggle id), D-11-037 compat (next and previous change ids), D-11-040 compat (add-note id), D-11-041 compat (send-notes id, two tokens) | Described by function and default key; the ids are listed below as allowlist candidates. Non-camel ids that the shared brief allows (view.tasks, sidebar.checks.toggle) were kept as plain text. |
| Identifier / schema (kolux.yaml key) | 1 token | D-11-067 compat (shared-folders key under worktree) | Described as "a shared-folders list in kolux.yaml"; exact key listed as an allowlist candidate. |
| File names | 3 | D-11-067 compat (repo-root include file name), D-11-012 user sees and rule (Git ignore file name), D-11-061 acceptance (secrets env file name) | Described in words: "an include file at the repository root", "the repository's ignore file", "an environment secrets file". Include-file name listed as an allowlist candidate. |
| Schema (placeholder token) | 1 | D-11-018 compat (custom-command prompt placeholder in braces) | Described as "the word prompt inside curly braces"; listed as an allowlist candidate. |
| Verbatim prose (test titles / code strings) | 5 sentences | D-11-017 rule 1 (hidden when nothing to commit), D-11-021 rule 1 (base must differ from head), D-11-024 rule 5 (empty description not falling back, 2 windows), D-11-028 rule 3 (gh not signed in), D-11-039 user sees (diff too large to display) | Each sentence rewritten with different structure and vocabulary. |
| UI copy over six words | 0 | — | Labels kept to four words or fewer: Commit, Fix with AI, Change Base Ref, Review changes, Explain changes, Add Review Note, Show Tasks Button, Delete / Restore / Discard. |
| Error text | 0 | — | Notices and refusal reasons described, never quoted. |
| Library names | 0 | — | — |
| Precaution (not counted) | 2 | D-11-008 acceptance (a git config key name), D-11-016 rule (internal improvement-card id) | Config key replaced by "the pull strategy in git config"; card id dropped, "shipped in 0.12.0" kept. |
| Paths / identifiers in evidence | — | the `evidence` arrays | Not rendered; evidence stays in cards-raw only. Not counted. |

Leaks fixed (counted): 7 identifier/schema tokens + 3 file names + 1 placeholder + 5 verbatim
sentences = **16**.

## Firewall script

- First run on the generated spec: `firewall-check: 0 hit(s) across 1 file(s)`.
- Final run (after the similarity rewrites and the backtick-safe re-wrap):
  `firewall-check: 0 hit(s) across 1 file(s)`.

## Similarity hunt

- Method: exhaustive, stronger than three phrases per card. Every six-word window inside each
  punctuation-free clause of every card, the scope paragraph and the Dropped lines was searched
  (inline `kolux` commands excluded). Pass 1: bundled ripgrep 15.0.0, fixed-string, case-insensitive,
  binary-as-text, `-j4`, all phrases in one pattern file, over `src`, `tests`, `docs`, `README.md`,
  `HANDOFF.md`, `HANDOFF-HISTORY.md`. Pass 2: whitespace-normalised substring search over the 37
  markdown files under `docs` plus README and both HANDOFF files, to catch phrases split by line wraps.
- Controls: two real test titles from the old test suite were planted in a control card, and pass 1
  found both (9 phrases, 2 hits). A six-word phrase that spans a line break in HANDOFF-HISTORY.md
  was planted in a second control card. Pass 1 missed it, as expected, and pass 2 found it.
- Draft pass: 3,409 phrases, 6 matches, all generic phrases in code or tests:
  - GIT-016 "when there is nothing to review" → "if the branch has no changes to look at".
  - GIT-003 "a link that points outside the" → "a symbolic link aimed at a file beyond the repository".
  - GIT-028 "when gh is not signed in" → "if gh has no signed-in account".
  - GIT-017 "when there is nothing to commit" → "stays out of sight until there are changes it could describe".
  - GIT-022 "the user moves to another workspace" → "while the user is busy in a different workspace".
  - GIT-025 "and falls back to the PR" → "can also find the PR by its number as a last resort".
- Final pass: **3,415 phrases checked, 0 matches.** Similarity hits fixed: **6**.

## Allowlist candidates

Interface tokens the user already touches, written around for now:

- `sidebar.sourceControl.toggle` (keybinding id, default Mod+Shift+G)
- `editor.nextChange`, `editor.previousChange` (keybinding ids, F7 / Shift+F7)
- `editor.addReviewNote` (keybinding id, default Mod+Shift+A)
- `sourceControl.sendReviewNotes` (keybinding id, unbound)
- `worktree.sharedDirectories` (kolux.yaml key the user writes)
- `.worktreeinclude` (repo-root file the user creates)
- `{prompt}` (placeholder the user types in a custom commit-message command)

A general rule such as `re:^[a-z]+(\.[a-zA-Z]+)+$` for dotted keybinding ids would cover the first five.

## Residual risks

1. GIT-084 (symbolic-link shared folders, tier D) and the kept kolux.yaml shared-folders rule in
   GIT-067 (tier P0) look like two routes to the same outcome. The owner should confirm that the cut
   covers only the per-repository setting and not the kolux.yaml list.
2. GIT-057 (Projects roadmap timeline) is half-done: the picker calls roadmap views unsupported while
   a timeline exists. Acceptance asks the owner to choose.
3. GIT-086 (git inside WSL) is cut with area 18, but WSL paths became local again on 2026-10-06. The
   owner should confirm whether git for WSL-stored repositories stays.
4. GIT-071 (star prompt) may conflict with the 2026-10-05 originality cleanup, and its target
   repository may need to change (theme 10). The spec does not name a repository.
5. GIT-081 (macOS developer permissions) is not a Git feature. It is carded here only because table
   1b lists it with the integrations cut.
6. 42 non-D cards had one raw acceptance item, and every D card had "n/a". The second acceptance item
   (and both items on D cards) were written at this stage from the card's own rules, user-sees and
   decision text, not from new evidence.
7. D-11-068 lists a related area "22", which does not exist. It was left out of the Related areas line.
8. Concrete numbers (50 files per review list, 100 checks or jobs, 20 annotations, 100 comments,
   15 reviewers, Git 2.38 for conflict forecasts, 2,000-file staging, 30,000-file cap scenario,
   100,000-line diff) are carried as behaviour facts. They also mirror the old implementation's
   constants.
9. The list of commit-message agents (Claude Code, Codex, Amp, Kimi, Copilot, Pi, Cursor,
   Antigravity) is kept, since agent names are allowed. Whether every one of them is still in the
   area 02 catalogue was not checked here.
10. The similarity hunt checks code and tests line by line. A copied phrase split across two lines
    inside a source comment or a multi-line test title would not be caught. Markdown prose was
    searched without regard to line wraps.

# Firewall scrub report · 01 Projects, repos & worktrees

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/01-projects-worktrees.json` (101 cards, generated 2026-10-06,
  all round 0; round 1 critic edits already merged into the file)
- Output: `spec/01-projects-worktrees.md` (ids PROJ-nnn, number taken from D-01-nnn)

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 15 | 15 |
| P1 | 56 | 56 |
| P2 | 18 | 18 |
| H | 2 | 2 |
| X | 0 | 0 |
| D | 10 | 10 |
| **Total** | **101** | **101** |

Sort order in the spec: tier, then `pushed` ascending (null last), then id. A generator took tier,
pushed and state from the raw JSON for every card, refused to run if any id lacked rewritten prose,
and refused any card with fewer than two acceptance items. All prose (title, user does, user sees,
rules, acceptance, compat, decision) was rewritten, not transcribed. The `evidence` column is not
rendered; it stays in cards-raw only.

## Leaks found and how each was fixed

Method: (1) a naive render of the raw card prose was run through `scripts/firewall-check.ps1`
(18 hits); (2) the raw card prose was run through the same exhaustive six-word similarity hunt used on
the spec (2,404 phrases, 4 matches); (3) a manual read against the forbidden list, plus a token search
of the raw JSON for paths, stored values and file names the script does not catch.

| Category | Found | Where (raw card) | Fix |
|---|---|---|---|
| Path | 7 | D-01-003 example clone URL with an embedded credential; D-01-004 example home-folder path; D-01-025 default workspaces location written as a path, plus two Windows drive paths; D-01-026 two Windows drive paths | Default described in words (a workspaces folder inside a kolux folder in the home folder); examples rewritten as "a folder on another drive", "the home folder", "a URL that carries a user name and token". |
| Path (folder name) | 4 | D-01-012 and D-01-032: the JavaScript package-dependency folder name, twice each | Described as "heavy dependency folders" / "a large dependency folder". Name listed as an allowlist candidate. |
| File name | 2 | D-01-032 rules and compat: the repo-root include-list file name | Described as "a list file at the repo root, one ignore-style path pattern per line". Name listed as an allowlist candidate. |
| Identifier (environment variable) | 1 | D-01-027 rules: the worktree-add timeout variable | Described as "an environment variable (milliseconds, clamped to three to thirty minutes)". Name listed as an allowlist candidate. |
| Identifier (camelCase keybinding ids) | 6 | D-01-053 (sleeping-workspaces toggle), D-01-055 (previous, next, select by position, focus list), D-01-085 (open board) | Commands described in words; ids listed as allowlist candidates. Dotted ids without capitals (workspace.create, workspace.rename, workspace.delete, worktree.palette, worktree.history.back, worktree.history.forward) kept as plain text, as the 02 spec does. |
| Schema (kolux.yaml keys and values) | 10 | D-01-034: five camelCase keys and two dotted keys; D-01-033 and D-01-034: the two stored values for agent start timing (three occurrences) | Compat rewritten in plain words (a setup script, whether the agent starts at once or waits for setup, an issue command, a list of default tabs with title, colour and command; cut fields named by purpose only). Kept keys and values listed as allowlist candidates. |
| Verbatim prose (similarity, raw) | 4 | D-01-001 (folder that is already a repository), D-01-043 (card position wording), D-01-064 (no-upstream wording), D-01-069 (after the repo has gone quiet) | Each sentence rewritten from scratch with different structure and vocabulary. |
| UI copy over six words | 0 | — | Quoted labels in the raw cards were all six words or fewer (Open as Folder, Open Worktree Palette, wait for setup, a count of new worktrees, an example workspace name). Labels kept: Add Project, Browse, Open as Folder, Start from, New workspace, Add project, Open Worktree Palette, Force delete, View changes, Move to Status, Manual order, Smart, Recent, Retry, Open in, Setup. |
| Error text | 0 | — | Failure messages are described by kind (missing base, name in use, Git failure, permissions), never quoted. |
| Library / tool names | 1 | D-01-033 acceptance: a package-manager install command used as the example setup script | Rewritten as "set the setup to install dependencies". No old-app library names appeared. |
| Not a leak (script hits) | 2 | D-01-013 acceptance (the word pair "import of" tripped the code-keyword rule); D-01-079 a subcommand word in backticks | Reworded ("Bring in x and z as one group"); subcommand written as plain `kolux worktree overlap` command words. |

Leaks fixed (counted): 7 paths + 4 folder names + 2 file names + 1 environment variable + 6 keybinding
ids + 10 schema tokens + 1 tool name + 4 verbatim sentences = **35**.

## Firewall script

- First run on the generated spec: `firewall-check: 2 hit(s) across 1 file(s)` (a capitalised
  `Kolux.yaml` produced by the generator at the start of a Compat line, and the "import of" false
  positive). Both rewritten.
- Final run: `firewall-check: 0 hit(s) across 1 file(s)`.

## Similarity hunt

- Method: exhaustive, stronger than three phrases per card. Every six-word window inside each
  punctuation-free clause of every card (plus the scope paragraph and the Dropped and Hidden lines),
  with wrapped continuation lines joined first, was searched: pass 1 with ripgrep fixed-string,
  case-insensitive, binary-as-text, over `src`, `tests`, `docs`, `README.md`, `HANDOFF.md`,
  `HANDOFF-HISTORY.md`, one ripgrep run per target with a file-count control per target (src 21,225,
  tests 709, docs 72, three root files); pass 2 as a whitespace-normalised substring search over the
  markdown under `docs` plus README and both HANDOFF files, to catch phrases split by line wraps.
- Pass 1 of the draft: 3,654 phrases, 3 matches, all generic wording in unrelated source and test
  files:
  - PROJ-028 "when there is no usable default" (agent-picker test) → "if no default can be found at
    all, creation stops and asks the user to set a base".
  - PROJ-075 "while the user is typing in" (browser-pane test) → "or while a text field has focus".
  - PROJ-035 "again when the window regains focus" (starter-kit status hook) → "it re-checks whenever
    the Kolux window comes back into focus".
- Final pass: **3,656 phrases checked, 0 matches.** Similarity hits fixed: **3**.
- Tooling note: no `rg` on PATH; the ripgrep bundled with VS Code was used. With several paths and
  more than one thread it silently dropped whole targets in this sandbox (a multi-path run found 0
  matches where `src` alone found 5), so the hunt runs ripgrep once per target, and the final verify
  pins `-j1`, which a control search showed reaching all six targets.

## Allowlist candidates

Real interface tokens the rebuild needs for compatibility; the spec describes each in words for now.

- Keybinding command ids: `sidebar.sleepingWorkspaces.toggle`, `worktree.navigateUp`,
  `worktree.navigateDown`, `workspace.selectByIndex`, `sidebar.focusWorktreeList`,
  `workspace.openBoard`.
- Environment variable: `KOLUX_WORKTREE_ADD_TIMEOUT_MS`.
- Repo-root include list file: `.worktreeinclude`.
- kolux.yaml keys and values that users' committed files already use: `scripts.setup`,
  `setupAgentStartupPolicy` (values `start-immediately`, `wait-for-setup`), `issueCommand`,
  `defaultTabs`. The cut fields (archive script, shared folders, environment recipes) only need to be
  ignored, so they are not candidates.
- Dependency folder name: `node_modules` (scan exclusion and the include-copy budget warning).

## Residual risks

1. PROJ-013: its acceptance item (z placed inside a sub-group for y) looks at odds with its rule that
   in-between folders leading to only one repository are folded away. Carried as the reader wrote
   it; the clean room or owner should settle which one wins.
2. PROJ-094: fork push remotes are cut together with fork sync, but opening a fork's pull request as
   a workspace may still need one. The raw notes flag this; owner to confirm.
3. PROJ-025: the only CLI route for a per-project workspaces folder sat in the cut host-setups group
   (PROJ-096); area 20 needs a replacement route.
4. Acceptance items were written at this stage for 96 cards: a second item for the 84 P cards that
   had one, and two items for each H and D card (the raw ones read "n/a — decision item"). They are
   derived from each card's own user-sees, rules and decision text, not from new evidence.
5. kolux.yaml compatibility depends on exact key spellings and the two start-timing values, which the
   spec gives only in words; until the allowlist takes them, the clean room cannot read existing files
   correctly from the spec alone.
6. Dotted keybinding ids without capital letters are written as plain text. They pass the script
   but are old-app identifiers; they are kept on purpose because users' `~/.kolux/keybindings.json`
   files refer to them.
7. Concrete numbers mirror the old implementation's constants: 2 GB and 50,000 entries copy budget,
   five skipped items named, three-minute add timeout clamped to three to thirty minutes, 30-second
   checks, 32 custom folders, Git status for every deletable row rather than the first 50.
8. Overlaps recorded in the raw notes: D-05-014/037/046/053 duplicate PROJ-083/057/055/053, and
   D-19-037/039 duplicate PROJ-089 (crash report and feedback, which belongs to area 19). The
   coverage stage should keep one copy of each.
9. The similarity hunt is line-level for code and tests: a copied phrase split across two lines of a
   source comment or a multi-line test title would not be caught. Markdown prose was covered with
   wrap-insensitive matching.

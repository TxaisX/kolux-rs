# Firewall scrub report · 12 Editor & files

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/12-editor-files.json` (57 cards, generated 2026-10-06;
  critic rounds 1-3 present: D-12-053 to 055 added in round 1, D-12-056 in round 2, D-12-057 in round 3)
- Output: `spec/12-editor-files.md` (ids EDIT-nnn, number taken from D-12-nnn)

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 12 | 12 |
| P1 | 29 | 29 |
| P2 | 14 | 14 |
| H | 0 | 0 |
| X | 0 | 0 |
| D | 2 | 2 |
| **Total** | **57** | **57** |

Sort order: tier, then `pushed` (null last, shown as —), then id. Tier, pushed, state and related
areas were taken from the raw JSON by a generator in the scratchpad; all prose (titles, user does,
user sees, rules, acceptance, compat, decision, scope paragraph, Dropped lines) was rewritten by
hand, not transcribed. The generator refused to write unless every raw card had exactly one
rewritten block, every card had at least two acceptance items, and every D card had a Decision line.
The spec has 57 `Source: D-12-nnn` lines and 134 acceptance items.

## Leaks found and how each was fixed

Method: (1) a naive render of the raw card prose (576 lines) was run through
`scripts/firewall-check.ps1` → 36 hits; (2) the raw prose was put through the same two-pass six-word
similarity hunt used on the spec (3,208 phrases) → 7 sentences with matching phrases; (3) a manual
read against the forbidden list for what the script cannot see.

| Category | Found | Where (raw card) | Fix |
|---|---|---|---|
| Identifier (camelCase keybinding ids) | 16 ids, 19 script hits | D-12-006, 007, 012 (three ids), 020 (two ids), 027 (two ids), 031, 034 (five ids), 036 | Each described by function and default key with "existing id kept"; ids listed below as allowlist candidates. Dotted ids without inner capitals (editor.save, editor.find, editor.replace, sidebar.explorer.toggle, sidebar.search.toggle, view.code, settings.search) and the view id explorer were kept as plain text, as the shared brief allows. |
| File names (script) | 17 hits | D-12-012 (readme file, 1), 014 (example files with line anchors, one under a source folder, 3), 025 (HTML page name, 1), 032 (rename example, 3), 034 (existing-name example, 2), 037 (test-file exclude glob, 1), 042 (CLI example file, 1), 054 (untitled note names, 5) | Rewritten as words: "the repository's readme", "a link to a code file with a line-10 anchor", "an HTML page", "rename it", "a file whose name is already taken", "a pattern that matches test files"; the untitled series is now "a markdown file named untitled (then untitled-2, untitled-3 and onwards)". The CLI example now sits inside a `kolux file open …` command span with an invented path (see residual 10). |
| Path (script missed) | 1 | D-12-054 acceptance (folder-plus-name example) | "a name inside a folder that does not exist yet". |
| Paths (network and WSL) | 3 | D-12-044 user does and acceptance (two WSL network path forms, a sample distro home path), D-12-045 acceptance (a share on another host) | "reached through the wsl$ or wsl.localhost network path", "a project from an Ubuntu distribution's home folder through wsl.localhost", "a file on another computer's share". |
| URL | 1 | D-12-014 acceptance (sample web address) | "a web link". |
| Tool folder names | 1 list | D-12-036 rule (four dot-folder names of other tools) | "build-cache or editor-settings folders (such as those that the Next framework, VS Code and JetBrains IDEs create)". |
| Library implementation detail | 1 | D-12-016 rule (diagram library's security-mode setting) | Restated as behaviour: diagrams render in a locked-down mode that never runs scripts. |
| Verbatim prose (test titles / code strings) | 7 sentences | D-12-001 rule 6, 004 rule 3, 013 rule 9, 021 user sees, 032 rule 3, 041 user sees, 054 user sees | Each sentence rebuilt with different structure and vocabulary (see similarity hunt for the draft-stage catches). |
| UI copy over six words | 0 | — | Labels kept to four words or fewer: Reload, Keep my edits, Compare, Retry, Open anyway, Fix with AI, View Log, Open in Code, Answer in Code, More blocks, Untitled, Blank. |
| Error text | 0 | — | Refusals and failures described, never quoted. |
| Schema / JSON keys | 0 | — | Compat lines name data categories only; the settings-key and registry ids in `evidence` and `notes` were not rendered. |
| Precaution (not counted) | ~25 mentions | file-format extensions written with a leading dot in D-12-001, 010, 012, 014, 021, 023, 024, 025, 046, 053 | Written as format names (Astro, Svelte, Vue, Nim, JSON Lines, CSV, TSV, Jupyter notebook, HTML, zip archive, batch file, PowerShell script, executable, Windows shortcut, plain text file). |
| Paths / identifiers in evidence | — | the `evidence` arrays and `notes` | Not rendered; evidence stays in cards-raw only. Not counted. |

Leaks fixed (counted): 36 script hits + 1 missed path + 3 network/WSL paths + 1 URL + 1 tool-folder
list + 1 library detail + 7 verbatim sentences = **50**.

## Firewall script

- First run on the generated spec: `firewall-check: 0 hit(s) across 1 file(s)`.
- Final run (after the similarity rewrites): `firewall-check: 0 hit(s) across 1 file(s)`.

## Similarity hunt

- Method: exhaustive, stronger than three phrases per card. Every six-word window inside each
  punctuation-free clause of every card, the scope paragraph and the Dropped lines was searched
  (inline `kolux` command spans excluded).
  - Pass 1: ripgrep 14.1.1, fixed-string, case-insensitive, all phrases in one pattern file, over
    `src`, `tests`, `docs`, `README.md`, `HANDOFF.md`, `HANDOFF-HISTORY.md` of the old repo.
  - Pass 2: a read-only Node scan of the 21,948 git-tracked text files under the same paths
    (138 MB) with line wraps and leading comment, quote and list markers removed, matching every
    six-word window of each clause against the phrase set. This catches phrases split across lines
    in wrapped markdown and multi-line code comments.
- Controls: a real test title from the editor tests and a six-word phrase that spans a line break in
  HANDOFF-HISTORY.md were run as a control set. Pass 2 found both; pass 1 found the test title only,
  as expected.
- Draft pass (first full draft, same method): 11 matching windows in 10 sentences, rewritten:
  - EDIT-037 "instead of showing an empty list" → "gives its reason rather than an empty result list".
  - EDIT-007 "at the very start of a" → "a selection whose end sits in column one of a line".
  - EDIT-054 user sees "at the end of the tab" / "tab at the end of the" → "placed last in the tab row".
  - EDIT-054 acceptance "at the end of the row" → "two tabs are added after the existing ones".
  - EDIT-017 "while a composition is in progress" → "while it is composing characters".
  - EDIT-021 "shows an error instead of a" → "produces an error message, never an empty tab".
  - EDIT-041 "reveals it in the sidebar and" → "scrolls the sidebar to it".
  - EDIT-004 "a worktree that no longer exists" → "files whose worktree has since been removed".
  - EDIT-014 "a target that does not exist" → "a link to a missing file shows a toast".
  - EDIT-032 "a tab already showing the changed-on-disk" → "if the changed-on-disk banner was already
    up on that tab, it stays up after the move".
- Final pass: **3,766 phrases checked, 0 matches in pass 1 and 0 in pass 2.** Similarity hits
  fixed: **10** sentences (11 windows).

## Allowlist candidates

Interface tokens the user already touches, written around for now:

- `editor.toggleWordWrap` (Alt+Z)
- `editor.copyContext` (Mod+Alt+C)
- `editor.markdownPreview` (Mod+Shift+V), `tab.newMarkdown` (Mod+Shift+M), `tab.openMarkdown` (Mod+Shift+O)
- `editor.addReviewNote` (Mod+Shift+A), `sourceControl.sendReviewNotes` (unbound)
- `editor.nextChange` (F7), `editor.previousChange` (Shift+F7)
- `tab.closeAll` (Mod+Alt+W)
- `fileExplorer.undo`, `fileExplorer.redo`, `fileExplorer.copyPath`, `fileExplorer.copyRelativePath`,
  `fileExplorer.delete`
- `worktree.quickOpen` (Mod+P)
- `.kolux/templates` at a repository root (folder the user fills with markdown templates; the spec
  describes it as the hidden folder with the same name as `~/.kolux`)

A general rule such as `re:^[a-z]+(\.[a-zA-Z]+)+$` for dotted keybinding ids would cover all but
the last.

## Residual risks

1. Two third-party names stay because the user meets them directly: ripgrep (Quick Open and search
   tell the user to install it; WSL search runs it inside the distribution) and mermaid (the fence
   word users type for diagram blocks). The shared brief forbids the old app's dependency names;
   the owner or a later lint should confirm these count as user-facing.
2. Concrete numbers are carried as behaviour facts and also mirror old constants: about 600 KB rich
   view threshold, 256 KB handoff note cap, 50 Quick Open results, about 100,000-file worktrees,
   100 untitled names, autosave pause 1 s clamped to 0.25-10 s, the old 5 MB read limit.
3. EDIT-044 (WSL projects local again, live 10-06) runs ripgrep inside the chosen WSL distribution
   for search. The area 18 cut names "WSL execution"; the owner should confirm this stays.
4. EDIT-030 (CI check details) also served GitLab jobs in the old app; GitLab is cut by table 1b.
   The spec describes pull-request checks only and does not split a D card for it.
5. Overlaps: explorer, search and handoff panel UI (EDIT-033 to 038, 040, 045, per the raw notes) are also area 05 ground;
   diff tabs, All Changes, conflicts, review notes and check details (EDIT-009, 020, 027 to 030, 056)
   are also area 11 ground. Dedupe at build time.
6. State: every card is live-unverified except EDIT-044, 045 and 053 (live, from the 10-06 close-out).
   The inline-answer path behind EDIT-041's Answer in Code switch was not runtime-verified.
7. 24 non-D cards had one raw acceptance item (D-12-009, 010, 011, 015 to 019, 021 to 026, 028, 030,
   032, 038, 043, 044, 047 to 050) and both D cards had "n/a". The extra items were written at this
   stage from each card's own rules and user-sees text, not from new evidence.
8. Keybinding ids with inner capitals appear in the spec only as "existing id kept"; the clean room
   cannot restore the exact ids until the allowlist candidates above are decided.
9. Tooling note: one pass-1 ripgrep run through the Bash tool with backslash Windows paths returned
   no matches and no error, while the same search with forward-slash paths found hits. All counted
   pass-1 runs used forward-slash paths, and pass 2 does not depend on ripgrep.
10. EDIT-042's acceptance uses an invented example path with a file extension inside a
   `kolux file open …` span. The script passes it because of the `kolux` allowlist rule. It names no
   old-repo file, but a stricter lint could flag it; it can be replaced with a placeholder.

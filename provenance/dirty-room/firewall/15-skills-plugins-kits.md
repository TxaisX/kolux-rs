# Firewall scrub report · 15 Skills, plugins & starter kits

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/15-skills-plugins-kits.json` (41 cards, generated 2026-10-06; 148 evidence entries; 9 notes including critic r1)
- Output: `spec/15-skills-plugins-kits.md` (ids SKILL-nnn, number taken from D-15-nnn)

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 2 | 2 |
| P1 | 25 | 25 |
| P2 | 5 | 5 |
| H | 1 | 1 |
| X | 0 | 0 |
| D | 8 | 8 |
| **Total** | **41** | **41** |

Sort order: tier, then `pushed` (null last), then id. Tier, pushed and state copied from the JSON for
every card (checked with `grep -o "^Tier: ..." | uniq -c` against the JSON tier counts). Every card
has at least two acceptance items: D-15-027 had one, so a second was derived from its own rule
(success clears after about 4 s, failure stays); the eight D cards and the one H card had
"n/a — decision item", so each got two checks that the cut holds (H: one default check, one
if-revived check). All prose was rewritten, not transcribed.

Content carried from the notes into cards (behaviour only): SKILL-018 states that the sidebar button
is the only way into the Skills page and the rebuild must keep a reachable switch (critic r1 note);
SKILL-016 points to area 16 for the checklist; SKILL-027 says area 05 also lists the status-bar
item; the scope paragraph says Artifacts is carded here while area 05 lists it as a view.

## Leaks found and how each was fixed

Method: (1) manual read of every raw field against the forbidden list while writing; (2) the raw
card prose was run through the same exhaustive six-word hunt used on the spec (2,415 clause
windows, 18 matching windows in about 13 sentences); (3) firewall script on the written spec;
(4) exhaustive six-word hunt on the written spec, repeated until clean.

| Category | Found | Where (raw card) | Fix |
|---|---|---|---|
| File names / extensions | 3 | D-15-021 rule 1, acceptance 1, compat: the standard skill file name | "a folder holding the standard skill file that agent CLIs read"; "a skill file with no front matter". Allowlist candidate below. |
| File names / extensions | 1 | D-15-007 compat: the kit completion-marker file name | "a short completion-marker file". |
| File names / extensions | 2 | D-15-013 compat: the collected folder's read-me and results page file names | "a README and a single HTML results page" (README is allowlisted as a bare word). |
| File names / extensions | 1 | D-15-014 compat: per-project run-record file name | "a small hidden run-record file in its results folder". |
| Paths | 1 | D-15-021 compat: the shared cross-agent skills folder path | "the shared cross-agent skills folder in the home folder". Allowlist candidate below. |
| File names / extensions | 2 | D-15-004 rule 3 and acceptance 1: Excel extensions | "a path to an Excel workbook". |
| Identifiers (component / screen names) | 1 | D-15-002 user_does, rule 2, acceptance 1 and 3: the start-screen component name and "unmounts" | "the start screen"; "stays open when the user leaves the start screen, since that screen does not own it". |
| Identifiers (internal machinery) | 3 | D-15-005 rule 7 (packaged-resource internals), D-15-034 (back end and its contracts), D-15-037 rule 5 (manifest loader) | Described as what the user gets: an installed copy finds its samples; "install machinery … no screen or command reaches it"; "accepted plugin descriptions under the upstream app's branded name". |
| Identifiers (skill ids) | 1 | D-15-032 rule 1: six cut-skill ids, including a legacy one | Named by what they drive (computer use, iOS and Android emulators, Linear under a current and a legacy name, environment recipes). |
| Library / dependency commands | 2 | D-15-026 compat and D-15-028 compat: verbatim third-party skills-installer command lines | "the community skills installer's update / add command … with the skill flag, the agent flag, a yes flag and a global flag". |
| Schema | 2 | D-15-034 rule 1 (bundle request fields); D-15-013 compat (folder-name format string) | Fields restated as what an install had to name; folder name restated in words (kit title, dash, short month, day, year, 12-hour time with a dot, AM or PM). |
| Verbatim prose (test titles) | ~13 sentences | Six-word matches in raw D-15-001, 006, 007, 009, 010, 015, 017, 024, 026 (two), 028, 035, 036 | All rewritten while drafting; four survived in my first draft (see similarity hunt) and were then rewritten. |
| Paths / identifiers in evidence | 148 entries | `evidence` arrays | Not rendered; they stay in cards-raw only. Not counted as leaks. |
| UI copy over six words | 0 | — | Labels kept to four words or fewer: Start kit, Start anyway, Try with sample data, Browse, Collect results, Open results, Open project, Preview, Open, Move to, Restart, Open AI connections, Filter by agent, Skill folders, Clear filters, Refresh, Retry, Delete skills, Select all eligible, Clear, Exit selection, View details, Reveal file, Copy path, Update skill(s), Show log, Re-check, Done, Install, Update, Copy command, Add artifact, Remove from library, Official. |
| Error text | 0 | — | Refusals and toasts described, never quoted. |

Leaks fixed (excluding evidence and similarity hits): 19.

## Firewall script

`powershell -NoProfile -File G:\Dev\kolux-rs\scripts\firewall-check.ps1 -Path G:\Dev\kolux-rs\spec\15-skills-plugins-kits.md`
reported 0 hits on the first draft and after every edit. Final line:
`firewall-check: 0 hit(s) across 1 file(s)`.

## Similarity hunt

Exhaustive rather than three phrases per card: every six-word window of the spec prose, split at
punctuation, plus every window that crosses punctuation as written, fed to one
`rg -iF -o -f <phrases>` over `src`, `tests`, `docs`, `README.md`, `HANDOFF.md` and
`HANDOFF-HISTORY.md` of the old repo.

| Pass | Phrases | Hits | Fixed |
|---|---|---|---|
| 1 (clause windows) | 2,924 | 7 | SKILL-035 "no usable title", SKILL-026 "revision the disk does not", SKILL-009 "while a run exists", SKILL-014 "live results folder when nothing", SKILL-010 "declared file older than the", SKILL-017 "every root that reached it", SKILL-022 "where the content stays when" — each sentence rewritten. |
| 2 (+ punctuation-crossing windows) | 7,791 | 2 | SKILL-030 and SKILL-031 compat: the usage synopsis lines of the skills CLI group matched the old CLI's own usage text; rewritten as flag lists in prose (flags kept, as the user types them). |
| 3 (final) | 7,820 | 0 | — |

Extra pass (beyond the brief): the final phrases against the old repo's `skills`, `skill-guides`,
`skill-stubs`, `specs`, `resources`, `AGENTS.md` and `CLAUDE.md`: 0 hits.

Similarity hits fixed: 9.

## Allowlist candidates (not edited)

- `SKILL.md` — the public cross-agent skill file name that Claude Code, Codex and others read; the
  rebuild must scan for it, and today the spec has to describe it indirectly.
- `~/.agents/skills` — the public shared cross-agent skills folder; same reason.

## Residual risks

- Kept skill names (kolux-cli, orchestration, koluxsecurity, koluxward) appear as written because
  the user types them in `kolux skills get`; they are the owner's own names.
- SKILL-026, SKILL-028 and SKILL-031 still name npx and Node and describe the community skills
  installer's add and update commands and their flags in words. This is a third-party tool the user
  sees typed in a terminal, not an old-app library, but the owner may want it judged.
- Behaviour constants come from the code (10 MB / 100 assets / 50 MB / 16 scripts at 5 MB, 200
  characters, 256 KB, 50 runs, 1 to 512 skills, 10 s polling, 4 s clear, back-off 0.5 / 2 / 5 s,
  50 ms at p95 with 20 packs). Kept as rules; they are numbers, not text.
- SKILL-001 restates the kit catalogue's structure (six kits, role-to-AI pairings, inputs, wait
  order) closely. The wording is mine, but the arrangement mirrors old data. It is product design
  the owner made.
- Cross-area duplicates to reconcile in later stages: Artifacts (SKILL-035/036 vs area 05), skills
  CLI (SKILL-030/031 vs area 20), skill update status bar (SKILL-027 vs area 05), plugins section
  (SKILL-037 vs area 17), skill sharing (SKILL-034 vs area 21).
- Open questions from the reader carried as rules, not settled: WSL skill scanning and deleting stay
  (SKILL-021/022), even though area 18 cuts WSL execution; the kept skill setup panel's home once the
  CLI settings section folds is unknown (SKILL-028 lists where it appears at 0.15.0).

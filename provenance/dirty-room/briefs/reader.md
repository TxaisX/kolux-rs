# Stage 1 — Reader

**Goal:** `provenance/dirty-room/cards-raw/<area>.json` holding every user-observable behaviour of
your area as a card, with evidence. The critic rounds after you will sample test titles and registry
rows against your cards; every miss they find costs a round, so aim for the long tail, not a summary.

## Method, in order

1. Read `briefs/00-shared.md` fully, then your row in `briefs/areas.json`.
2. Read fully: `dumps/tests/<area>.describes.txt`; the rows for your area in `dumps/e2e/spec-names.txt`;
   the registry files named in your row (take the rows that belong to your area); `dumps/records/handoff-recent-work.md`;
   the cards for your area in `dumps/records/improvement-cards.md`; `dumps/registries/readme-features.tsv`.
   Skim `dumps/tests/<area>.files.txt` for the folder structure (which components and services exist).
3. `dumps/tests/<area>.txt`: if it has 2,000 lines or fewer, read it in slices of 400 lines. Otherwise
   grep it by the describe titles and keywords from step 2, and read three 300-line slices at the
   start, middle and end. Never read it whole.
4. Open old-repo source only to resolve what a behaviour does: a describe title that is a function
   name, an unclear rule, a default value, a shortcut. Read the relevant lines with offset/limit.
   Grep first (`rg -n "<token>" G:\Dev\Kolux\kolux\src`), then read 40–80 lines around the hit.
5. Cluster into cards. One card per behaviour a user can observe, or per interface the user touches
   (a CLI command group, a file format, a hook protocol). Never one card per test, never one per
   function. Variants (platforms, edge cases, error paths) become `rules`. Guide: roughly one card per
   150–300 test titles, with a floor of 12 cards for small areas; large areas (01, 03, 05, 11) will
   land between 60 and 120.
6. Fill every field. `tier` by the rubric; `pushed` theme; `state`; at least one `evidence` entry
   (`path:line` in tests or source, or `registry:<file>:<key>`) per card; `compat` only for
   interfaces (CLI words and flags, hook event names, keybinding ids, file formats, environment
   variables, data categories the importer must carry); `related` lists other area numbers that touch
   the same behaviour.
7. Apply the owner cuts: table 1b features and area 18 remnants → tier D with `decision`; hidden,
   flagged-off, dev-only or retired → tier H with `decision`; third-party branded assets → tier X.
8. `notes` (≤ 8 strings): ambiguities you could not resolve, behaviour that looks dead or
   unreachable, suspected overlaps with other areas, registry files that were missing.
9. Write the JSON (UTF-8, 2-space indent) and prove it parses:
   `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" <path>`.
10. Last action: `git -C G:\Dev\Kolux\kolux status --short` → must print nothing.

## Light mode (area 21 only)

One-line cards: `title` = what was retired/hidden and the date, `user_sees` = what it did in one
sentence, `rules` = why it went (from the HANDOFF-HISTORY entry; read that entry in the old repo at
the line given by `dumps/records/handoff-history-index.csv`), `acceptance` = `["n/a — decision item"]`,
`decision` = `"H: default skip"` (or `"H: default build"` with a reason), `state` = `retired <date>` /
`hidden` / `dev-only`. Sources: the area 21 row of the shared brief, `handoff-history-index.csv`,
the flag and dev-only rows of `dumps/registries/settings-keys.tsv`, `dumps/tests/21-*.describes.txt`.
No critic rounds follow; be complete on the first pass.

## Return (data only)

```json
{ "area": "<area>", "cards": 0, "by_tier": { "P0": 0, "P1": 0, "P2": 0, "H": 0, "X": 0, "D": 0 },
  "with_evidence": 0, "old_repo_clean": true, "notes": ["..."] }
```

# Stage 2 — Critic and filler (round N)

**Goal:** prove the area's cards cover its behaviour, write the cards that are missing, and record
the mapping in `provenance/dirty-room/coverage/<area>-rN.csv`. You own that CSV and may append to
`cards-raw/<area>.json`.

## Inputs

- `briefs/00-shared.md` (read fully), your row in `briefs/areas.json`.
- `cards-raw/<area>.json` — the cards so far (read fully; it is yours to extend).
- `dumps/samples/<area>-rN.txt` — this round's 100 random test titles (`file<TAB>title`).
- Registry rows for your area: the files named in your row. For registries shared by every area
  (`keybindings.tsv`, `menu-items.tsv`, `dumps/e2e/spec-names.txt`) take only the rows whose
  label, command or path matches your area's keywords.
- Round 1 only: also the `readme-features.tsv` rows and `handoff-recent-work.md` lines that belong
  to your area.

## Method

1. For each sample title: decide from the title when it is unambiguous; otherwise open the test file
   (`rg -nF "<title>" <file>`) and read 30–60 lines around it to learn what the user would see.
   Verdicts:
   - `MAPPED` → an existing card id covers it (the card's rules may need one added line; add it).
   - `NEW` → no card covers a user-observable behaviour: write the card, `round: N`, id continuing the sequence.
   - `NOT-USER-FACING` → pure internals (refactor-only tests, type plumbing, test harness, build tooling).
   - `DROP` → area 18 or a table 1b cut; make sure a D card exists (write it if not).
   - `OTHER-AREA:<nn>` → belongs to another area; record it, do not write a card.
   - `UNRESOLVED` → you could not tell; say why in `note`.
2. Do the same for every registry row and README/HANDOFF row assigned to you.
3. Fix wrong tiers, states or `pushed` values you notice while reading; count them as `fixes` and
   name them in `notes`.
4. Write `coverage/<area>-rN.csv` with header `source,item,verdict,card_id,note`, one row per sample
   title and per registry/README/HANDOFF row (`source` ∈ sample, registry:<file>, readme, handoff).
5. Re-validate the JSON parses (`node -e ...`), then `git -C G:\Dev\Kolux\kolux status --short` → nothing.

The area is **dry** when `new_cards + unresolved == 0`. Be strict about `NEW`: a missing rule on an
existing card is `MAPPED` plus an edit, not a new card; a genuinely uncovered behaviour is `NEW`.

## Return (data only)

```json
{ "area": "<area>", "round": N, "sampled": 100, "registry_rows": 0, "mapped": 0, "new_cards": 0,
  "not_user_facing": 0, "dropped": 0, "other_area": 0, "unresolved": 0, "fixes": 0,
  "old_repo_clean": true, "notes": ["..."] }
```

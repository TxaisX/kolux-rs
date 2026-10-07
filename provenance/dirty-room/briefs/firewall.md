# Stage 3 — Firewall

**Goal:** `G:\Dev\kolux-rs\spec\<nn>-<area>.md` written in behaviour-only prose, a scrub report at
`provenance/dirty-room/firewall/<area>.md`, and `0 hit(s)` from the firewall script. You own those
two files only. You may read the old repo (to hunt copied text) and `cards-raw/<area>.json`.

## Method

1. Read `briefs/00-shared.md` fully (the firewall rules and the card markdown format are there),
   your row in `briefs/areas.json`, then `cards-raw/<area>.json` (final, after the critic rounds).
2. Write `spec/<nn>-<area>.md`:
   - H1 `# <nn> · <Area title>`; one paragraph of scope in plain words; a line
     `Tier counts: P0 n · P1 n · P2 n · H n · X n · D n`; a line `Related areas: …`.
   - `## Cards`, sorted by tier (P0, P1, P2, H, X, D), then `pushed`, then id. Card id is
     `<PREFIX>-<nnn>` using the number from `D-<nn>-<nnn>`. Use the exact card format from the shared
     brief: heading, `Tier · Pushed · State at 0.15.0`, `User does`, `User sees`, `Rules`,
     `Acceptance` checklist with at least two items, `Compat` (`—` when none), `Decision` (H and D
     only), `Source: D-<nn>-<nnn>`.
   - `## Dropped by default (tier D)` — one line per D card: id, name, reason.
   - `## Hidden or retired (tier H)` — one line per H card: id, name, date or flag, default decision.
3. Rewrite every sentence in your own words. Nothing from the forbidden list may remain: code;
   identifiers of any casing style; file names, paths, extensions; UI copy over six words; error
   messages; JSON keys or schemas; library names; test titles or HANDOFF prose. Describe what the
   user does and sees. Where the card quoted a label the user clicks, keep it to six words or fewer.
4. Run the check until it is clean:
   `powershell -NoProfile -File G:\Dev\kolux-rs\scripts\firewall-check.ps1 -Path G:\Dev\kolux-rs\spec\<nn>-<area>.md`
   Fix every hit by rewriting. You do not own `scripts/firewall-allowlist.txt`; if a hit is a
   legitimate interface token (a `kolux` flag, a hook event name, a keybinding id), rewrite around it
   for now and list it under `allowlist_candidates`.
5. Similarity hunt. For each card take up to three distinctive phrases of six or more consecutive
   words from its prose and search the old repo:
   `rg -iF "<phrase>" G:\Dev\Kolux\kolux\src G:\Dev\Kolux\kolux\tests G:\Dev\Kolux\kolux\docs G:\Dev\Kolux\kolux\README.md G:\Dev\Kolux\kolux\HANDOFF.md G:\Dev\Kolux\kolux\HANDOFF-HISTORY.md`
   Any match means copied text: rewrite the sentence, re-run step 4, count it.
6. Write `firewall/<area>.md`: cards written per tier; leaks found by category (path, identifier,
   UI copy, error text, schema, library, verbatim prose) and how each was fixed; similarity phrases
   checked and hits fixed; the final script line; allowlist candidates; residual risks (anything you
   are unsure is behaviour-only).
7. Last action: `git -C G:\Dev\Kolux\kolux status --short` → must print nothing.

## Return (data only)

```json
{ "area": "<area>", "spec_file": "spec/<nn>-<area>.md", "cards_written": 0,
  "by_tier": { "P0": 0, "P1": 0, "P2": 0, "H": 0, "X": 0, "D": 0 },
  "leaks_fixed": 0, "similarity_phrases": 0, "similarity_hits_fixed": 0, "check_hits_final": 0,
  "allowlist_candidates": ["..."], "residual": ["..."], "old_repo_clean": true }
```

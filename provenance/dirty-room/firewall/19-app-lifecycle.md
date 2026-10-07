# Firewall scrub report — 19 · App lifecycle & operations

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/19-app-lifecycle.json` (70 cards, after critic rounds r1 and r2)
- Output: `spec/19-app-lifecycle.md` (ids APP-nnn, number taken from D-19-nnn)

## Cards written per tier

| Tier | JSON | Spec |
|---|---|---|
| P0 | 13 | 13 |
| P1 | 28 | 28 |
| P2 | 13 | 13 |
| H | 13 | 13 |
| X | 0 | 0 |
| D | 3 | 3 |
| Total | 70 | 70 |

Sort order: tier, then pushed (null last), then id. Every card has a Source line (70/70 checked with grep).

## Leaks found and fixed (15)

| Category | Count | What was in the card JSON | Fix |
|---|---|---|---|
| Path / file name | 5 | update manifest file name (D-19-024 and D-19-059 compat), installer file name and its block-map extension (D-19-059 compat), `.env` (D-19-041), `.md` file (D-19-019 acceptance) | described as "the update manifest", "the Windows installer, its block map", "values from environment files", "a markdown file" |
| Identifier (SCREAMING_SNAKE) | 6 | KOLUX_RENDERER_HEAP_MB (D-19-022), DO_NOT_TRACK, KOLUX_TELEMETRY_DISABLED, KOLUX_DIAGNOSTICS_DISABLED (D-19-046), KOLUX_RELEASE_WORKTREE (D-19-059), KOLUX_STARTUP_DIAGNOSTICS (D-19-065) | described by purpose ("an environment variable sets …"); names listed as allowlist candidates |
| Library | 2 | package-manager name in the ship command (D-19-058 compat); framework term for the UI process ("renderer", D-19-022/039/040/042) | "the ship command … from the project's own package scripts"; "the interface process" |
| Schema / URL | 1 | full new-issue URL with its query-parameter names (D-19-037 compat) | "GitHub's own new-issue page with the title and body passed in its address" on repository TxaisX/kolux |
| Code keyword (script hit) | 1 | "must import into the rebuild" (APP-048 compat) tripped the code-keyword rule | reworded to "must carry over into the rebuild" |
| UI copy > 6 words | 0 | update tip text (D-19-026) was paraphrased, not quoted; all quoted labels are ≤ 4 words | — |
| Error text | 0 | none quoted | — |

Acceptance gaps filled by this stage (cards had one item or "n/a — decision item"): APP-018, 019, 021, 022,
027, 030, 053, 055, 056, 057, 061, 062 got a second check derived from their own rules; every H and D card
got two default-build / if-built checks in the style of the area 21 spec.

## Similarity hunt

- Per-card phrases: the three longest clauses of six or more words from each card (210 phrases) searched
  with `rg -iF` against old-repo src, tests, docs, README, HANDOFF, HANDOFF-HISTORY → 0 matches.
- Full sweep, stricter than the brief: every six-word window of the whole spec prose (about 3,800 windows)
  searched the same way → 9 matches on the first pass, all rewritten; 0 on the final pass.

| Matched six words | Old source (kind) | Card | Rewrite |
|---|---|---|---|
| until the workspace session is ready | test title + e2e helper comment | APP-002 | "holds off until the workspace session has finished loading" |
| while the update card is already | test title | APP-025 | "stays silent if the update card is on screen for that same update" |
| links open in the system browser | test title | APP-015 heading | "Web addresses go to the default browser" |
| it is not part of the | code comments | APP-062 | "the automatic release never runs it, so someone starts it by hand" |
| marker is written before the prompt | code comment | APP-043 | "the safe-graphics flag is saved before the user answers the prompt" |
| it is gone from the list | test comment | APP-051 | "the list no longer shows it" |
| own providers under their own accounts | README privacy section | APP-070 | "each agent CLI talks straight to the company behind it, signed in with that tool's account" |
| notes are the commit subjects since | release reference doc | APP-059 | "the release notes list the subject line of each commit since …" |
| a failed release is logged and | release reference doc | APP-059 | "when a release fails, the failure goes to the log and the ship itself still succeeds" |

Extra five-word pass against README, the release reference doc and HANDOFF only: 4 near-copies
(APP-024 heading, APP-060 rule and acceptance, APP-064 rule) reworded anyway; not counted as hits.

## Final script line

`firewall-check: 0 hit(s) across 1 file(s)`

## Allowlist candidates (not edited; owner decides)

- KOLUX_RENDERER_HEAP_MB — user-set UI memory limit (APP-022)
- DO_NOT_TRACK — cross-tool opt-out convention (APP-046)
- KOLUX_TELEMETRY_DISABLED, KOLUX_DIAGNOSTICS_DISABLED — opt-out variables (APP-046)
- KOLUX_RELEASE_WORKTREE — owner's release job checkout override (APP-059)
- KOLUX_STARTUP_DIAGNOSTICS — dev-only startup timing flag (APP-065)
- latest.yml — update manifest name that installed 0.15.0 copies poll for (APP-024, APP-059); needed only if
  the rebuild must update existing installs in place

## Residual risks

1. Update interval: the area brief says 15 minutes; the card (re-checked by critic r2 against 0.15.0) says
   30. The spec says 30. Owner to confirm.
2. In-place upgrade from 0.15.0 to the rebuild: the spec names the feed repository (TxaisX/kolux-releases)
   but withholds the manifest file name and format (old-app schema). The clean room cannot reproduce it
   without an owner decision (see latest.yml candidate).
3. Owner identifiers kept in Compat lines: TxaisX/kolux, TxaisX/kolux-releases and the former product name
   Nightshift (also used by spec/21). They are the owner's public names, not code; flag if the firewall
   should treat them otherwise.
4. Ship-command flags (`--main`, `--no-release`, `--merge`, `--dry-run`, `--model`, `--message`,
   `--no-publish`) belong to the owner's release tooling, not the `kolux` CLI; the generic flag rule
   accepts them.
5. APP-023 still mentions the GitLab CLI check although table 1b cuts GitLab; kept as the card states.
6. Second acceptance items and all H/D acceptance items were authored at this stage from the card rules,
   not from fresh evidence.
7. Five-word overlaps with src and tests were not swept (only README, release doc, HANDOFF).

## Wave 2 patch (2026-10-06)

Coverage gaps from the menu-items registry: two rows, one behaviour.

| Gap (registry row) | Result | Card |
|---|---|---|
| menu-items: darwin only, macOS app menu, Hide Others | amended: one rule line | APP-009 (D-19-009) |
| menu-items: darwin only, macOS app menu, Show All (unhide) | amended: same rule line | APP-009 (D-19-009) |

- Cards added: 0. Cards amended: 1 (APP-009 Rules now name the macOS hiding group: Hide, Hide Others,
  Show All, each the system's stock action). Tier counts unchanged (P0 13 · P1 28 · P2 13 · H 13 · X 0 · D 3).
- Evidence added to D-19-009 in cards-raw: both registry rows and register-app-menu.ts:157-159.
- Leaks fixed: none needed. Firewall check on the spec file: 0 hits.
- Six-word similarity hunt (rg -iF over src, tests, docs, README.md, HANDOFF.md, HANDOFF-HISTORY.md):
  "every other app's windows", "every hidden app comes back", "Kolux stays on screen", "hiding group",
  "stock action", "no logic of its own", "Hide Others" → 0 matches each.

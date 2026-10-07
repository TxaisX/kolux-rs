# Firewall scrub report · 21 H — retired, hidden, removed, dev-only

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/21-retired-hidden.json` (44 cards, generated 2026-10-06, all round 0;
  file time 11:08)
- Output: `spec/21-retired-hidden.md` (ids HID-nnn, number taken from D-21-nnn)
- Starting point: a spec draft for this area already existed (file time 11:19, written by an earlier,
  unfinished pass of this stage that left no scrub report). This pass did not trust it: every card was
  re-checked against the final JSON, the firewall script and the full similarity hunt were re-run, and
  every remaining copy was rewritten (see below).

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 0 | 0 |
| P2 | 0 | 0 |
| H | 35 | 35 |
| X | 6 | 6 |
| D | 3 | 3 |
| **Total** | **44** | **44** |

Mechanical checks run on the spec against the JSON (node script, all passed): one heading per raw id,
no duplicates, `Source:` equals the raw id for every card; Tier, Pushed (`—` for null) and State
match for every card; sort order is tier (H, X, D), then `pushed` (null last), then id; every card has
User does, User sees, Rules, Acceptance, Compat and Source; `Decision:` present on all 38 H and D cards
and absent on the 6 X cards (the X replace decision is stated in their Rules instead, per the shared
format); every card has at least two acceptance items.

Acceptance: all 44 raw cards carried only "n/a — decision item". The firewall stage wrote two
behaviour checks per card: one for the default build (feature absent, or old saved data ignored
without error) and, where meaningful, one prefixed "If revived" that applies only if the owner marks
the card **build** in DECISIONS.md.

## Leaks found and how each was fixed

Method: (1) a naive render of the raw card prose (title, user does, user sees, rules, compat,
decision; evidence column excluded) was run through `scripts/firewall-check.ps1` → **40 hit(s)**;
(2) the raw prose was put through the same six-word similarity hunt used on the spec (1,472 windows);
(3) manual read against the forbidden list for what the script cannot see.

| Category | Found | Where (raw card) | Fix |
|---|---|---|---|
| Identifier: stored setting keys (camelCase) | 36 | compat of D-21-004, 006, 007, 008, 010, 020, 024–032, 036 (036 repeats twelve) | Each key replaced by a plain description of the switch ("the pet switch", "the four sharing settings", "phone-pairing connection mode"…). HID-036's compat is a plain list of what each retired setting controlled; the rule given to the rebuild is to ignore saved settings it does not recognise. |
| Identifier: environment variables (SCREAMING_SNAKE) | 2 | D-21-005 compat | "two environment variables (the cloud address and a client id)". |
| Path / file name | 4 | D-21-037 compat: Nightshift repo config file, repo folder, plugin manifest, home folder | Described as "the Nightshift-named setup file, settings folder and plugin manifest" and "the settings folder in the home directory". Only `kolux.yaml` (allowlisted, user-facing) is named. |
| Identifier: internal improvement-card ids | 7 | D-21-005 (three), 009, 012 (two), 020 | Replaced by "an open improvement item" or dropped. |
| Identifier: orchestration address | 1 | D-21-004 rule 2 (the at-sign agent address) | "its orchestration address". |
| Verbatim prose (HANDOFF / README) | 7 phrases | D-21-002 (two, HANDOFF-HISTORY), D-21-012 (two, HANDOFF-HISTORY), D-21-017 (one, HANDOFF-HISTORY), D-21-020 (two, HANDOFF and README) | Sentences rewritten with different structure and vocabulary. Two of the seven had survived in the inherited draft (D-21-002 default-keys sentence, D-21-020 toggle-and-shortcut-row sentence) and were rewritten in this pass. |
| UI copy over six words | 0 | — | Labels kept short: Needs You, Working, Done, Idle, None, Runs, Inbox · Floor · Code, Kolux Account, Dev Tools, Kolux Mobile, Settings › Experimental, View › Appearance. |
| Error text | 0 | — | The phone page's not-available notice and the skill-sharing notice are described, never quoted. |
| Schema / JSON keys | 0 beyond the keys above | — | "settings schema still accepts the old nudge keys" became "the settings format still accepts the old nudge entries". |
| Library names | 0 | — | — |
| Evidence references | 44 cards' `evidence` arrays | all cards | Not rendered; they stay in cards-raw. Not counted as leaks. |
| Precaution | 1 | D-21-041 rule ("README privacy list") | Reworded to "the app's published privacy list" so the spec points at no old document. |

Leaks fixed (counted): 36 + 2 + 4 + 7 + 1 identifier/path tokens + 7 verbatim phrases = **57**.

## Firewall script

- Naive render of the raw prose: `firewall-check: 40 hit(s) across 1 file(s)` (36 camelCase, 2
  SCREAMING_SNAKE, 2 code-file).
- Inherited draft, first run in this pass: `firewall-check: 0 hit(s) across 1 file(s)`.
- Final run after the similarity rewrites: `firewall-check: 0 hit(s) across 1 file(s)`.

## Similarity hunt

- Formal pass (three per card, as the stage brief asks): the three most distinctive 6–8-word phrases
  from different fields of each card, plus the scope paragraph and the two summary lists → **141
  phrases**, searched with ripgrep fixed-string, case-insensitive, over `src`, `tests`, `docs`,
  `README.md`, `HANDOFF.md`, `HANDOFF-HISTORY.md` → 0 matches.
- Exhaustive pass: every six-word window inside each clause of the spec (2,459 unique windows),
  same ripgrep search, plus a whitespace-normalised substring search over README, both HANDOFF files
  and all markdown under `docs` (catches phrases split by line wraps or emphasis marks), plus the old
  `specs` folder as an extra.
- Matches in the inherited draft (exhaustive pass): **5**, all rewritten.
  - HID-002 rules, "Inbox and Floor lost their default" (HANDOFF-HISTORY) → "the stock keys for
    Inbox (Ctrl+Shift+1) and Floor (Ctrl+Shift+2) were unassigned".
  - HID-020 rules, "does nothing and its row is" (README and HANDOFF) → "running the toggle command
    has no effect and the shortcut list leaves that command out".
  - HID-010 title and H-list line, "window of its own, and the" (generic, unrelated e2e test) →
    "as a separate desktop window, plus its open-mode setting".
  - HID-004 rules, "falls back to a plain terminal" (generic, unrelated pane-header tests) → "opens
    as an ordinary terminal instead".
  - HID-041 acceptance, "with no icon of its own" (generic, unrelated browser favicon code) →
    "that lacks a bundled icon".
- Final state: 0 matches in all passes. A five-word check against README and both HANDOFF files
  leaves only feature names ("Search, Floor and Agent grid", "Floor and Agent grid pages", "panes in
  the main window"), which are names, under six words, and kept.

## Allowlist candidates

None. The keybinding command ids the spec names (view.inbox, view.floor, view.code, dashboard.toggle)
and the key form Mod+Shift+3 are written as plain text and pass the script; they are allowed
interface tokens under the shared brief. `kolux.yaml` and `DECISIONS.md` are already allowlisted.

## Residual risks

- Acceptance items are firewall-stage authorship, not evidence-backed: the raw cards had none. The
  "If revived" items bind only when the owner marks a card build.
- HID-019 says update checks run every 30 minutes (the 2026-10-06 record); the area-19 scope line still
  says 15 minutes. Area 19's spec should be reconciled with this.
- Compat lines name retired settings by what they did, not by stored name. A future importer of old
  Kolux profiles cannot match them key by key from the spec alone; the spec's rule (ignore any saved
  setting not recognised, without error) is written so that it does not need to.
- Third-party product and character names (OpenCode, OpenCode Go, MiMo Code, OpenClaude, Claudino,
  Gremlin, Copilot, Cursor, Devin, Qwen, Droid, Pi, Omp, Kilo, Aider, Ghostty, Warp, Zed, Jira, Linear,
  Google's favicon service) appear as names, because the H and X cards exist to say what to retire or
  replace. They are names, not copied text.
- Two raw-card UNKNOWNs carry into the spec as stated unknowns: what the fork-retired GitHub
  attribution setting did (HID-036), and the exact date the sidebar per-agent rows died (HID-038).
- Hunt limits: windows stop at clause punctuation, so a copy that spans a semicolon or full stop is
  checked only in its parts; strings in source and test code split across lines are not normalised
  (markdown is).

## Wave 2 patch (2026-10-06)

- Added HID-045 (D-21-045, round 4) · Shared message box under a workspace's panes, with an agent
  chooser and a permission chip · shipped in 0.5.0 and removed the same day (2026-09-15) in the
  sidebar trim. Source gap: registry row tags `v0.5.0|workspace composer with agent picker`. No
  existing card covered it: HID-015 is the later per-pane message bar (removed 2026-10-05), a
  different control. Placed after HID-015 in Cards and in the tier H list; tier counts now H 36.
- Evidence resolved from old-repo commits edfaac0be (added) and 124ee74b1 (removed), the
  HANDOFF-HISTORY entry at line 853, and the surviving per-workspace permission value read at load
  and at agent launch. Cross-reference to VIEW-054 (area 05) kept in the card.
- Cards amended: none.
- Firewall script: 0 hits on the spec file after the patch.
- Six-word hunt (rg -iF over old src, tests, docs, README, HANDOFF, HANDOFF-HISTORY), 27 phrases from
  the new card: one match, "one message box per workspace" (HANDOFF-HISTORY), in the first-draft
  title. Rewritten in the spec title, the tier H list line and the raw-card title as "Shared message
  box under a workspace's panes"; rechecked, 0 matches. The tooltip and HANDOFF wording about the
  permission chip applying to the next launch was paraphrased from the start ("changed only agents
  launched afterwards, never one already running").
- Open question for area 05 (not edited here): no current renderer control or CLI command sets the
  per-workspace permission override, so VIEW-054's "user sets or clears" may describe a control
  that left with this box. Recorded in the raw-card notes.

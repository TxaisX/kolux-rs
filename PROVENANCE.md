# PROVENANCE

Where every part of the Kolux RS spec came from. This file names source types, counts and dates
only. It holds no file names from the old repository, no code, no identifiers and no copied text.
The build loop reads it and appends to section 5. Written by the dirty-room team on 2026-10-06.

---

## 1. Method

### What a clean-room rebuild is

The old Kolux (version 0.15.0, owned by Txais Xiong) grew out of an MIT-licensed upstream app.
Code derived from that upstream is not his. Kolux RS rebuilds the app from scratch so that every
line is his. To make that provable, the people who read the old code never write the new code.
They write a description of behavior instead (what the user does and sees). A firewall checks that
description, and only then does the build loop see it. The builders work from the description
alone and never see the old code.

### The three rooms

| Room | Who | May read |
|---|---|---|
| Dirty room | The extraction team, on 2026-10-06 | The old repository, its test titles and group names, the registries pulled from it, the installed app's command-line help, and its release and handoff records. Also the owner's vault notes and, for the contracts only, two of his own profile files (see Wave 2). |
| Firewall | An automated token check, plus a phrase-similarity hunt against the old repository, run per area | The cards the dirty room wrote, compared against the old repository. |
| Clean room | The build loop | Only what LOOP.md section 0 allows: SPEC.md, the area spec files, PRIORITIES.md, COMPAT.md, DECISIONS.md, this file, the installed app used as a user, the owner's profile data, named vault pages, and public docs of other tools. Never the old repository and never the dirty-room record. |

The token check rejects:

- source paths and code-file names
- identifiers in any casing style
- code keywords and code blocks, except a `kolux` command
- the old app's library names

The phrase-similarity hunt compares every card sentence against the old repository's text. It
flags any matching window of words, which is then rewritten in plain words.

### Wave 1: how the cards were produced (2026-10-06)

1. **Evidence dump.** The old repository's test suite was dumped as test titles and group names
   only, with no test bodies, and sorted into the 21 areas by path:
   - 68,391 titles in 8,733 test files, of which 59,367 fall in the 20 carded areas.
   - Area 18 held 6,115 titles.
   - 2,893 titles in 373 files matched no area (the unmapped bucket).
   - 16 titles were tooling.

   Nine registries were pulled at the same snapshot:

   | Registry | Rows |
   |---|---|
   | Keybindings | 129 |
   | Menu items | 57 |
   | Settings sections | 34 |
   | Settings keys | 194 |
   | Views | 39 |
   | Agent catalogue | 35 |
   | Hook events | 123 |
   | Command manifest (built from the installed CLI's help) | 229 |
   | README features | 17 |

   Release records came from the old repository's history: 14 release tags and 360 commits. 352
   commits were kept after setting aside the base import, bulk renames and scrub commits. Handoff
   records came from the old project's handoff log and the owner's improvement cards (69 cards).
2. **One reader per area.** Each reader turned that area's evidence into cards. A card holds:
   - the tier
   - the theme it was pushed under
   - the state at 0.15.0
   - what the user does and sees
   - its rules
   - an acceptance checklist
   - any compatibility contract

   Readers looked at old source code only to settle a specific ambiguity. They recorded a pointer
   in the dirty-room record, never in a card.
3. **Up to three critic rounds per area.** Each critic mapped every registry row that touched the
   area, plus a sample of its test titles, to an existing card. Anything left over got a new card.
   Rounds stopped when a round added nothing, or at the third round.
4. **Firewall rewrite per area.** Each area was scrubbed until the token check reported 0 hits,
   then hunted for phrase similarity and rewritten. Each area's counts are in section 2.

### Wave 2: review and contracts (2026-10-06)

- **Priorities.** The first draft of PRIORITIES.md was attacked by two independent reviewers:
  - An effort lens refuted 4 claims, weakened 27 and named 11 missing items.
  - An owner-intent lens refuted 4, weakened 13 and named 11 missing.

  An arbiter settled each point, using the commit-by-theme record and the owner's vault notes
  (Kolux, Build Log, Kolux Improvements from BridgeMind, and the Universal AI IDE synthesis), and
  revised the file.
- **Contract extraction.** COMPAT.md was drawn from:
  - the command manifest and the installed CLI's help
  - the hook-event registry, checked against old source for five agents
  - the keybindings registry
  - the owner's own shortcuts file (13 Windows overrides)
  - the top-level key names and counts of his saved app data (no values)
- **Six registry-family coverage audits.** One audit per family: agents and hooks, CLI, docs and
  records, end-to-end specs, input (keys and menus), and settings and views. Each audit mapped
  every registry row to a card or a verdict. A separate pass triaged the unmapped test bucket by
  group name. Gaps were patched into six areas (02, 03, 04, 13, 19, 21) and re-scrubbed through
  the firewall.

### What was NOT used

- **No observation of the running app.** Nobody launched it, clicked through it, took screenshots
  or opened DevTools. Every card's "live" state comes from tests, source, records or the owner's
  notes. The only thing run was the installed command line, and only to print its help.
- **No copying of text.** Behavior is restated in plain words. User-facing labels appear only where
  the rebuild must match them, and by rule never as a run of more than six words.
- **No design files.** The redesign's design source was an external artifact. Only its index was
  read.
- **Nothing from the upstream app's own repository**, packages or forks.

---

## 2. Per area

All dates are 2026. For every area the record range is 09-10 to 10-06 (the old repository's
history starts when the fork was first brought in, on 2026-09-10), and the snapshot is 10-06.

### 2a. Sources used

The column headings mean:

- **Test titles (files):** the count from the dump index.
- **Registry families:** the registries the area's evidence and critics used.
- **Source pointers:** the number of times old source was read to settle an ambiguity.
- **Release refs / handoff entries:** release-record references, and handoff entries the critics
  checked.
- **CLI help:** direct reads of the installed command line's help. "Via manifest" means the area
  used it only through the command manifest, which was built from that help.

| Area | Test titles (files) | Registry families | Source pointers | Release refs / handoff entries | CLI help | Records · snapshot |
|---|---|---|---|---|---|---|
| 01 Projects, repos & worktrees | 6,460 (747) | README, command manifest, end-to-end, keybindings, menus, settings keys and pages, views | 22 | 3 / 9 | via manifest | 09-10→10-06 · 10-06 |
| 02 Sessions & launching | 1,249 (147) | README, agent catalogue, end-to-end, keybindings, menus, settings keys | 54 | 2 / 5 | none | 09-10→10-06 · 10-06 |
| 03 Terminals & panes | 11,360 (1,377) | README, command manifest, end-to-end, keybindings, menus, settings keys | 59 | 22 / 48 | via manifest | 09-10→10-06 · 10-06 |
| 04 Agent status, hooks & notifications | 4,753 (537) | README, agent catalogue, command manifest, end-to-end, hook events, keybindings, menus, settings keys and pages, views | 49 | 2 / 4 | via manifest | 09-10→10-06 · 10-06 |
| 05 Views & navigation | 4,043 (542) | README, end-to-end, keybindings, menus, settings keys, views | 37 | 18 / 45 | none | 09-10→10-06 · 10-06 |
| 06 Usage & limits | 740 (107) | end-to-end, settings keys and pages, views | 46 | 7 / 7 | none | 09-10→10-06 · 10-06 |
| 07 Accounts, sign-in & keys | 2,134 (280) | README, agent catalogue, command manifest, end-to-end, settings keys and pages | 50 | 1 / 24 | via manifest | 09-10→10-06 · 10-06 |
| 08 Orchestration | 6,440 (872) | README, agent catalogue, command manifest, end-to-end, keybindings, menus, settings keys and pages, views | 48 | 0 / 12 | 7 direct | 09-10→10-06 · 10-06 |
| 09 Automations | 1,213 (158) | README, command manifest, end-to-end, menus, settings keys and pages, views | 26 | 2 / 1 | 2 direct | 09-10→10-06 · 10-06 |
| 10 Plan review & protected actions | 133 (23) | README, end-to-end, hook events, settings keys and pages | 46 | 12 / 30 | none | 09-10→10-06 · 10-06 |
| 11 Git, source control & review | 5,410 (677) | README, command manifest, end-to-end, keybindings, menus, settings keys and pages, views | 47 | 9 / 3 | via manifest | 09-10→10-06 · 10-06 |
| 12 Editor & files | 2,065 (313) | README, command manifest, end-to-end, keybindings, menus, settings keys, views | 46 | 5 / 7 | via manifest | 09-10→10-06 · 10-06 |
| 13 Browser pane & computer use | 3,187 (428) | README, command manifest, end-to-end, keybindings, settings keys and pages, release tags | 88 | 7 / 2 | via manifest | 09-10→10-06 · 10-06 |
| 14 Native chat | 2,486 (288) | end-to-end, settings keys, views | 22 | 3 / 2 | none | 09-10→10-06 · 10-06 |
| 15 Skills, plugins & starter kits | 1,147 (180) | command manifest, end-to-end, settings keys and pages, views | 26 | 0 / 3 | via manifest | 09-10→10-06 · 10-06 |
| 16 Onboarding & guidance | 444 (72) | end-to-end, menus, settings pages | 85 | 0 / 4 | none | 09-10→10-06 · 10-06 |
| 17 Settings, appearance & input | 1,405 (232) | README, end-to-end, keybindings, menus, settings keys and pages | 78 | 18 / 21 | none | 09-10→10-06 · 10-06 |
| 18 Remote & hosts (dropped) | 6,115 (815), of them 65 end-to-end specs | settings sections, command manifest; read only to list what goes | not counted | owner's cut of 2026-10-05 | via manifest | 09-10→10-06 · 10-06 |
| 19 App lifecycle & operations | 3,428 (391) | README, command manifest, end-to-end, keybindings, menus, settings keys | 57 | 3 / 34 | via manifest | 09-10→10-06 · 10-06 |
| 20 The `kolux` CLI | 1,112 (151) | README, command manifest, end-to-end | 104 | 1 / 3 | 259 direct | 09-10→10-06 · 10-06 |
| 21 Retired, hidden, removed, dev-only | 158 (18) | README, improvement cards, settings pages, release tags, views | 69 | 39 / 0 | none | 09-10→10-06 · 10-06 |

Area 18 has no cards. Its inventory, used to write the drop decisions, lists:

- 52 dropped feature rows
- 20 items that looked remote but stay
- 17 kinds of saved data the importer skips
- 5 command groups (23 commands) and 2 global flags removed
- 4 settings sections removed

### 2b. Process per area

The column headings mean:

- **Critic rounds:** the number of critic rounds run. "Cap hit" means round 3 still added cards, so
  the area stopped at the limit rather than settling.
- **Token leaks fixed:** fixes made until the token check reached 0 hits.
- **Similarity fixes:** fixes from the phrase hunt, counted the way each area's scrub report counts
  them (matching windows, phrases or sentences).
- **Wave 2 patch:** cards added or amended after the registry audits, with the firewall result of
  that patch.

| Area | Cards | Critic rounds | Cap hit | Token leaks fixed | Similarity fixes | Wave 2 patch |
|---|---|---|---|---|---|---|
| 01 | 101 | 1 | no | 35 | 3 | none |
| 02 | 51 | 1 | no | 10 | 22 windows in 7 sentences | +1 card (SESS-051); 0 leaks |
| 03 | 137 | 3 | no (round 3 added nothing) | 55 | 37 windows | +3 cards (TERM-135, TERM-136, TERM-137); 0 leaks |
| 04 | 62 | 1 | no | 30 | 12 windows in 11 sentences | +2 cards (STAT-061, STAT-062), 3 amended (STAT-018, STAT-019, STAT-029); 0 leaks |
| 05 | 118 | 3 | no (round 3 added nothing) | 38 | 16 | none |
| 06 | 33 | 1 | no | 35 | 7 | none |
| 07 | 65 | 3 | no (round 3 added nothing) | 45 | 5 | none |
| 08 | 67 | 3 | no (round 3 added nothing) | 82 | 14 | none |
| 09 | 29 | 1 | no | 14 | 2 | none |
| 10 | 30 | 1 | no | 37 | 5 | none |
| 11 | 86 | 1 | no | 16 | 6 | none |
| 12 | 57 | 3 | **yes** | 50 | 11 windows in 10 sentences | none |
| 13 | 67 | 1 | no | 18 | 8 phrases in 6 sentences | +1 card (BROW-067); 0 leaks, 1 similarity fix |
| 14 | 44 | 1 | no | 17 | 4 | none |
| 15 | 41 | 1 | no | 19 | 9 | none |
| 16 | 42 | 2 | no | 7 | 19 windows in 14 passages | none |
| 17 | 62 | 3 | **yes** | 46 | 7 | none |
| 18 | 0 | none (dropped) | n/a | n/a | n/a | n/a |
| 19 | 70 | 2 | no | 15 | 9 | 1 amended (APP-009); 0 leaks |
| 20 | 56 | 1 | no | 24 | 33 | none |
| 21 | 45 | 0 (register area; covered by the Wave 2 audits) | n/a | 57 | 5 | +1 card (HID-045); 0 leaks, 1 similarity fix |
| **Total** | **1,263** | | 2 areas | **650** | 234 (mixed units) | **+8 cards, 4 amended** |

Every area ended its firewall pass at 0 token-check hits. That held for the spec as committed
(7dad8dd: spec/, SPEC.md and COMPAT.md re-checked 2026-10-13 with the unchanged allowlist, 0 hits),
but it no longer describes the spec of today: 41 later builder commits added "(Kolux RS ...)" notes
and amendments that carry 53 hits (Kolux RS's own file names, settings keys and public Claude Code
status-line field names; no old-app identifier is known among them, but the check cannot tell them
apart). Since T-541 those 53 are the recorded baseline in `scripts/firewall-baseline.txt`, and
`scripts/firewall-check.ps1 -Baseline` (CI and the merge gate) fails on any hit beyond it.

**Freeze (2026-10-13).** `scripts/firewall-allowlist.txt` and `scripts/firewall-baseline.txt` are frozen at the
freeze commit: the merge gate runs `-Baseline` only, and a change to either file is a coordinator commit with a
DECISIONS.md row, never a lane commit. The same commit removed `provenance/dirty-room` from the tree
(`git rm -r`; its last tracked content is git tree 452b1163bf3145a81420688ea0f4f0d74a6652e2, listed by
`git ls-tree <freeze parent> provenance/`). It stays in history for the legal record and nothing else: the clean-room
rule in LOOP.md section 0 forbids reading it from history as much as from disk.

The cards by tier:

| P0 | P1 | P2 | H | X | D |
|---|---|---|---|---|---|
| 228 | 564 | 199 | 140 | 12 | 120 |

The cards by state at 0.15.0:

| Live | Live-unverified | Half-done | Hidden | Retired | Dev-only | Dropped |
|---|---|---|---|---|---|---|
| 122 | 905 | 5 | 57 | 45 | 9 | 120 |

---

## 3. Known limits

1. **Most states are unverified.** 905 of the 1,263 cards are live-unverified: tests and source say
   the feature exists, but nobody watched it work, because the running app was never observed. The
   122 marked live are named by a handoff entry from 2026-10-05 or 2026-10-06, or by a recorded
   verification, not by a click-through done for this spec. The loop should treat "live" as
   "expected to work", and confirm it in the installed app when it builds the card.
2. **Hook-status mappings are only partly verified.** COMPAT.md's hook event-to-status table has 123
   rows:
   - 50 rows were checked against old source for five agents: Claude 13, OpenClaude 13, Codex 8,
     Gemini 6 and Cursor 10.
   - The other 73 rows come from the hook-event registry as captured.

   COMPAT.md also leaves two things UNKNOWN:
   - the result fields of each command (none of the 229 manifest rows declares them)
   - the exit code of a terminal wait that ends blocked
3. **Coverage.** The consolidated coverage matrix in the dirty-room record has 11,288 rows: 9,293
   from critic rounds, 1,413 from the six registry audits and 582 from the unmapped-bucket triage.
   - **0 rows are UNRESOLVED.**
   - **9 rows were marked GAP** at audit time (hook events 2, release tags 3, menu items 2, settings
     keys 1, unmapped tests 1). All nine are closed by the Wave 2 patches in section 2b. The
     verdicts are left as recorded.
   - The triage worked by test group name, not title by title. It covered 582 groups: 415 assigned
     to an area, 86 dropped, 81 not user-facing. Its group counts do not reconcile exactly with the
     dump index's count for that bucket.
4. **Cap-hit areas: 12 Editor & files and 17 Settings, appearance & input.** In both, the third
   critic round still added a card. A fourth round might have found more, so treat these two areas
   as the likeliest to hide a missing behavior.
5. **Area 21 had no critic round.** It is a register of retired and hidden items, checked only
   through the Wave 2 audits (which added one card).
6. **Similarity counts may be low.** In one area's scrub, the search tool silently dropped matches
   when given a very large pattern list. That area re-ran with a deterministic scan. Other areas'
   phrase-similarity counts may be under-counted, although their token checks are exact.
7. **Version skew in the CLI.** The installed command line reports 0.15.2 while the source snapshot
   is 0.15.0. 182 commands came from the installed help and 49 only from source command specs
   (231 in all, including 2 command-tree entries that are not manifest rows; the manifest has 229).
   macOS-only menu items could not be observed on this PC.
8. **Records the repository does not hold.** 17 of the owner's 69 improvement cards carry a
   "shipped" marker that lives only in his vault page and the handoff log. The redesign's design
   source was outside the repository, and only its index was read.
9. **Uncertainties flagged by the readers.** Each card file's notes carry these. Area 14 recorded
   none.

   | Area | What is uncertain |
   |---|---|
   | 01 | Whether pushing to the owner's fork goes with the fork-sync cut. |
   | 02 | Two different sets of quick launch counts exist. One agent's catalogue entry is stale. |
   | 04 | One agent's hooks are removed at quit while others are not. The setup-file key names are not verified. |
   | 05 | The default screen conflicts (Board or Terminals). The Floor page is unreachable. The phone page is carded D and needs Txais to confirm. |
   | 06 | The used/remaining switch affects only the Agents screen footer. |
   | 07 | No real browser sign-in was verified, so every sign-in card is live-unverified. WSL accounts are unclear. |
   | 08 | The wording of worker start modes is unclear. The keepalive interval comes from help text only. Whether bare-shell workers are reachable is unclear. Agent Teams is unsupported on Windows. |
   | 09 | Where Automations is opened from is UNKNOWN. Whether to keep or cut the Hermes and OpenClaw jobs is open. |
   | 10 | The protected-action pause was never checked against a real signed-in Claude session or the automatic permission mode. The area has no end-to-end tests. |
   | 11 | The rebase-from-base flow is unresolved. Whether the roadmap page is reachable, the star prompt, and git under WSL are all unclear. |
   | 12 | The inline-answer path was not verified at runtime. Search under WSL is unclear. |
   | 13 | Some browser settings have no place in the UI. A third-party automation helper is involved. Nothing was verified recently. |
   | 15 | Whether the Skills page is reachable is unclear. Where the kept CLI-skill panel lives is UNKNOWN. |
   | 16 | The newcomer checklist is unreachable. Explore progress is stored per browser. Setup rules under WSL are unclear. |
   | 17 | Nothing watches the shortcuts file for changes. The window background follows the operating system. |
   | 19 | The update check interval differs between the old code and the brief (30 or 15 minutes). Windows keep-awake behavior is UNKNOWN. An unsigned release stops at the signature check. Dev-server memory was not measured. |
   | 20 | The help text has drifted. The root help still advertises dropped groups. Open-by-address is ambiguous. One retirement date is unknown. |
   | 21 | What one retired attribution setting did is unclear. When the per-agent rows died is unknown. Where profiles are opened from is unclear. The pet is ambiguous. The origin of 9 notification sounds and 12 feature-wall animations is unknown. Who sets per-workspace permissions is unclear. |

   Some behaviors are carded in more than one area on purpose, once per surface. For example, keep
   the computer awake appears as TERM-122, VIEW-097, BROW-053 and APP-018. Build the behavior once
   and tick every card that names it.
10. **Source-key check.** Every spec card ends with a Source line that names its raw card.
    - There are 1,263 Source lines and 1,263 distinct ids, against 1,263 raw cards.
    - Spec ids missing from the raw cards: 0. Raw cards with no spec card: 0.
    - Malformed lines, cross-area citations, ids cited twice, and duplicate raw ids: 0 each.
11. **Firewall at hand-off.** All 20 area spec files, COMPAT.md, PRIORITIES.md and this file report 0
    token-check hits.

---

## 4. How the loop appends

When a pass uses a source this file does not already list, add one dated line to the end of
section 5. That covers:

- a click-through of the installed app
- the owner's profile data
- a vault page
- a public doc of another tool

Use one line per source per pass. Write the line in your own words, with no copied text, and
append it in the same commit as the work it informed. Never edit or delete an earlier line.

The line format is:

> YYYY-MM-DD · pass or task id · source type · what was looked at, in plain words · areas nn, nn · note

The source type is one of:

- installed app
- profile data
- vault page: page name
- public doc: tool and page name

Example:

> 2026-10-12 · T-014 · installed app · opened the Shortcuts settings page, recorded a chord, watched the clash warning · areas 17 · nothing copied, no DevTools

If a pass reads forbidden material, follow LOOP.md section 0: stop, then add a line in this form:

> YYYY-MM-DD · pass or task id · BREACH · what was read and how · code discarded: yes or no

---

## 5. Source log

> 2026-10-06 · Phase 1 · dirty room · the old repository, its test titles and group names, nine registries, the installed command-line help, release and handoff records, the owner's vault notes, the owner's shortcuts file and the top-level key names of his saved data · areas 01-21 · this file's sections 1 to 3

> 2026-10-07 � Phase 3 � T-001 � public Tauri 2 documentation and the create-tauri-app React/TypeScript template (config file shapes, capability file, Vite dev-server settings), the rusqlite and cargo-deny public docs � own icon art in `app-icon.svg` � src-tauri/, src/, package.json, vite.config.ts, deny.toml, scripts/license-check.mjs

> 2026-10-08 · T-002 · public doc: Tauri 2 (events from Rust to the page, window events), portable-pty (open a pty, spawn, read, write, resize, kill), xterm.js with the WebGL and fit addons (load, context loss, fit) · areas 03 · read through the context7 documentation service; nothing copied, no old-app material

> 2026-10-08 · T-003 · public doc: Tauri 2 dialog plugin (folder picker call, capability permission name) and the git command-line manual (worktree add/remove/list --porcelain, branch -D, rev-parse) · area 01 · read through the context7 documentation service; nothing copied, no old-app material. The evidence harness in scripts/evidence/ is own work from the T-002 pass.

> 2026-10-08 · T-003b · design/DESIGN.md: a pixel-measured description of the running Kolux 0.15.0 window, written on 2026-10-08 by a designer agent that only photographed the installed app from the outside (window captures, zoom crops in design/reference/; no code, no DevTools, no install folder) · public brand material: Anthropic's press kit (Claude Spark SVG, unaltered) and the OpenAI mark redrawn by hand, both recorded in src/assets/vendors/NOTICE.md; openai.com/brand was unreachable (HTTP 403) so its terms were not read · public doc: Tauri 2 window API (decorations, drag region, minimize/maximize/close permissions) through context7 · areas 03, 17 · nothing copied from old-app material

> 2026-10-08 · T-004 · `claude --help` output of the Claude Code CLI installed on this PC (v2.1.295), read only to confirm `--permission-mode` accepts `auto`; the Codex flag comes from spec/02 SESS-027 Compat

> 2026-10-08 · T-005 · design/icon/: the Kolux app icon and top-bar mark, Txais's own design (confirmed by him on 2026-10-08), recreated as SVG from pixels Windows drew on screen (the taskbar button and the earlier window capture in design/reference/); no file of the old app was read, see design/icon/ICON.md · public doc: Tauri 2 path API (home_dir) and the `tauri icon` CLI help · areas 17, 03 · the keybinding ids, defaults and file shape come from COMPAT.md section 4 and spec/17 only; Txais's own ~/.kolux/keybindings.json was read as profile data (allowed by LOOP.md) to check the loader against a real file, and restored byte for byte after the live checks

> 2026-10-09 · T-038 · the `windows-sys` 0.61.2 crate's own source in the local cargo registry (MIT/Apache-2.0), read only for the `CryptProtectData` / `CryptUnprotectData` / `LocalFree` signatures; Microsoft's public DPAPI and `icacls` documentation for behaviour

> 2026-10-09 · T-042-a · the Codex CLI installed on this PC (0.156.1), used as a user would: `codex app-server --help`, the JSON Schema it prints with `codex app-server generate-json-schema`, and its live replies to `initialize` / `account/read` / `account/rateLimits/read` with an empty and a throwaway CODEX_HOME; no Codex source read

> 2026-10-09 · T-043-a · the Claude Code CLI installed on this PC (2.1.x), used as a user would: `claude --help`, `claude setup-token --help`, `claude auth login --help` / `claude auth status --help`, and `/status` in a pane; the `codex login --help` output for the device-code flag; CLAUDE_CODE_OAUTH_TOKEN from Claude Code's public docs; no Claude Code or Codex source read

> 2026-10-09 · T-043-b · the Claude Code CLI installed on this PC, used as a user would: `claude auth login --help` and `claude auth status --help`; Claude Code's public docs (code.claude.com, through context7) for `claude auth status --json` exiting 0 when signed in, CLAUDE_CONFIG_DIR, and `.credentials.json` living in the config folder on Windows and Linux; the stand-in claude.exe for the live check was written for this task; no Claude Code source read

> 2026-10-09 · T-043-c · the Codex CLI installed on this PC (0.156.1), used as a user would: `codex --version` and `codex login --help`; OpenAI's public Codex docs (developers.openai.com/codex/auth and the developer-commands page, through context7) for `codex login --device-auth`, `cli_auth_credentials_store` and `auth.json` under CODEX_HOME; the stand-in codex.exe for the live check was written for this task; no Codex source read

> 2026-10-09 · T-044 · Claude Code's public setup page (code.claude.com/docs/en/setup) and OpenAI's public Codex CLI page (developers.openai.com/codex/cli) as the install pages opened by "Open install page"; `claude auth status` used as in T-043-b; the stand-in claude.exe and codex.exe for the live check were written for this task; no Claude Code or Codex source read

> 2026-10-09 · T-045 · `claude auth status --json` used as in T-043-b; `cli_auth_credentials_store` from OpenAI's public Codex auth docs as in T-043-c; the usage-error wording is that of the common Rust command-line parser as seen from outside (`--help` output), not Codex source; the stand-in claude.exe and codex.exe for the live check were written for this task; no Claude Code or Codex source read

> 2026-10-09 · T-053 · theme names and slider spans from the spec cards; the hue numbers, saturation and depth steps and the matched terminal palette were chosen for this task (no old-app colours exist beyond DESIGN.md's Classic); xterm.js `ITheme` and live `options.theme` from its public API docs; Tauri's `visible` window setting and `show()` from Tauri's public docs; no old Kolux source read

> 2026-10-09 · T-054 · page names, mode names and look rules from the spec cards; the light palette mapping and the field names were chosen for this task (DESIGN.md has no light theme); `prefers-color-scheme` with `matchMedia` change events, React `lazy` / `Suspense`, `scrollIntoView` and the DevTools `Emulation.setEmulatedMedia` call used for the live check from public web and React docs; no old Kolux source read

> 2026-10-09 · T-057 · rules from the spec card; the busy rule (program panes live while running, shells while they have a child) and the wording were chosen for this task; Win32 `CreateToolhelp32Snapshot` / `Process32FirstW` from Microsoft's public docs and the windows-sys crate docs, `pgrep -P` from its manual page, portable-pty `Child::process_id` from its crate docs; no old Kolux source read

> 2026-10-09 · T-055 · rules from the PROJ-070 card; `git worktree list --porcelain` (its `locked` line), `git worktree lock --reason` / `unlock` and `git status --porcelain` from the public Git documentation; the stamp and the field name were chosen for this task; no old Kolux source read

> 2026-10-09 · T-036 · rules from the SET-027 card; Tauri events (`emit` / `listen` from @tauri-apps/api/event) from the public Tauri documentation; the field names were chosen for this task; no old Kolux source read

> 2026-10-09 · T-037 · rules from the APP-054 card; Win32 CreateToolhelp32Snapshot, OpenProcess, K32GetProcessMemoryInfo, GetProcessTimes and GlobalMemoryStatusEx from the public Microsoft documentation through windows-sys; `ps -o` fields and /proc/meminfo from their public man pages; no old Kolux source read
> 2026-10-09 · T-090 · public docs: Tauri 2 updater plugin (configuration, `check`/`download`/`install`, signing with `tauri signer`, the `latest.json` shape, Windows install modes) through context7 · public crate source: tauri-plugin-updater 2.13.2 in the local cargo registry, read for the Windows installer arguments and the `restart_after_install` behaviour · area 19 · nothing from old-app material; the feed name and timings come from spec/19 and DECISIONS.md

> 2026-10-09 · T-091 · public docs: GitHub Actions workflow syntax (triggers, matrix, needs, job summary), the GitHub CLI's `gh run list` and `gh release create`, Vitest's `--shard`, Tauri 2's `bundle.createUpdaterArtifacts` and `tauri signer generate` · npm package yaml 2.9.1 (ISC) and its documented `parse` options, used by scripts/workflow-check.mjs · the NSIS tools (zlib licence) the Tauri bundler downloads by itself during `pnpm tauri build` (build time only, not shipped)

> 2026-10-09 · T-093-a · public docs: CodeMirror 6 reference manual and examples (EditorView, EditorState.lineSeparator, Compartment, update listeners, LanguageDescription, themes) through context7 and the codemirror.net pages · npm packages codemirror 6.0.2, @codemirror/state 6.7.6, @codemirror/view 6.43.14, @codemirror/language 6.13.1, @codemirror/language-data 6.5.2, @codemirror/commands 6.11.1 and @codemirror/theme-one-dark 6.1.3 (all MIT), used as dependencies and read through their type files in node_modules

> 2026-10-09 · T-093-b · public docs: Lexical documentation (createEditor, setRootElement, registerRichText, registerHistory, registerList, registerCheckList, registerMarkdownShortcuts, $convertFromMarkdownString, $convertToMarkdownString, update listeners and tags) through context7 · npm packages lexical, @lexical/rich-text, @lexical/markdown, @lexical/history, @lexical/list, @lexical/link, @lexical/code and @lexical/utils 0.52.0 (MIT), marked 18.1.0 (MIT) and dompurify 3.4.16 (MPL-2.0 OR Apache-2.0), used as dependencies and read through their type files in node_modules · the link colour #b2baf6 comes from design/DESIGN.md
> 2026-10-09 · T-093-c · npm package @codemirror/merge 6.12.2 (MIT): MergeView, unifiedMergeView, diff, getChunks, goToNextChunk / goToPreviousChunk, getOriginalDoc and originalDocChangeEffect, used as a dependency and read through its type file and dist source in node_modules · git's own documentation for status --porcelain=v1 -z and cat-file --filters
> 2026-10-09 · T-093-d · git's own documentation for diff --numstat -z and --raw -z --no-abbrev (line counts, binary marks and blob ids per changed file); unifiedMergeView's collapseUnchanged option from the @codemirror/merge type file in node_modules; the web platform's IntersectionObserver and CSS overflow-anchor (MDN)
> 2026-10-09 · T-094-a · the WAI-ARIA Authoring Practices tree view pattern (role tree and treeitem, aria-activedescendant, aria-expanded, aria-level); Rust std's fs::read_dir, DirEntry::file_type and fs::metadata (a junction or symlink reports as a link, metadata follows it)
> 2026-10-09 · T-094-b · the trash crate 5.2.9 (MIT) source in ~/.cargo/registry: delete, os_limited::list and restore_all, and TrashItem's name, original_parent and id (Windows lists a trashed file by its shown name, which drops the extension when Explorer hides extensions; the id keeps it); windows-sys 0.61.2 (MIT or Apache-2.0) bindings for OpenClipboard, EmptyClipboard, SetClipboardData, CloseClipboard and GlobalAlloc with CF_UNICODETEXT, used as Microsoft's public Win32 clipboard documentation describes; tauri 2.12.1's WebviewWindow::hwnd; Rust std's OpenOptions::create_new and fs::rename; MDN on the Clipboard API needing a focused document
> 2026-10-09 · T-094-b2 · @tauri-apps/api's webview.d.ts in node_modules (getCurrentWebview().onDragDropEvent and its enter, over, drop and leave payloads with a physical position); Rust std's fs::read_dir, symlink_metadata, FileType::is_symlink (a Windows junction counts), create_dir and OpenOptions::create_new for copies that never overwrite, and fs::rename for moves; the " copy" name suffix as the Windows and macOS file managers show it; MDN on pointer events and devicePixelRatio
> 2026-10-09 · T-094-c · ripgrep's public command-line options (--files, --hidden, --no-messages, --no-config, -g with gitignore-style globs, a trailing slash meaning folders) as shown by its --help, run against a portable 14.1.1 release from its public GitHub releases page used only to test; git's documented ls-files options; Rust std's process::Command and io::ErrorKind::NotFound and slice::sort_by_cached_key; natural order as file managers show it; the prefix, substring and letters-in-order ranking common to Go to File pickers, written from scratch
> 2026-10-09 · T-095-a · tauri 2.12.1's documented Builder::register_uri_scheme_protocol and UriSchemeContext (read in the crate's own doc comments in the cargo registry); windows-sys 0.61.2 bindings for ShellExecuteW and GetDriveTypeW and their constants; Microsoft's public Win32 docs for those calls; MDN on iframe sandbox, Content-Security-Policy and postMessage; the public FNV-1a hash; written from scratch
> 2026-10-09 · T-095-b · the line shape of Claude Code's own session transcripts (tool_use named Artifact, tool_result with toolUseResult url and path, timestamp, cwd, sessionId), seen in the user's own transcripts; Claude's public Artifact tool CDN allow-list; reqwest 0.13.5's crate features and docs in the cargo registry; the public days-from-civil date algorithm; written from scratch
> 2026-10-09 · T-097 · Rust std::os::windows::process::CommandExt::creation_flags docs and Microsoft's public process creation flag values (DETACHED_PROCESS, CREATE_NEW_PROCESS_GROUP); tauri 2.12.1's WebviewWindow unminimize, show and set_focus, and tao 0.37.1's set_focus in the cargo registry (read to see when focusing is skipped); COMPAT.md's KOLUX_USER_DATA_PATH and KOLUX_APP_EXECUTABLE rows; written from scratch

> 2026-10-11 · T-136-a · rules from the USAGE-009 card; the notification plugin (`tauri_plugin_notification::init`, `NotificationExt` builder `title` / `body` / `show`) from the public Tauri documentation via context7; Windows' toast history (`ToastNotificationManager.History.GetHistory`) from the public Microsoft documentation, used only by the live check; no old Kolux source read

> 2026-10-11 · T-145-a · rules from the TERM-098 card; the Tango Desktop Project palette (public domain) as published in the Tango icon theme guidelines; the dark/light mode detection sequences (DEC mode 2031, CSI ? 996 n, CSI ? 997 ; 1|2 n) from the public Contour terminal specification; xterm.js `parser.registerCsiHandler` and its own OSC 4/10/11 colour reports from the public xterm.js documentation and its MIT source in node_modules; no old Kolux source read

> 2026-10-12 · T-148-a · rules from the SET-023 and TERM-098 cards; scheme palettes from their public, permissively licensed projects (Solarized MIT, Dracula MIT, Nord MIT, Gruvbox MIT, One Half MIT, Campbell from Windows Terminal MIT, Tango public domain); the scheme JSON shape (name, background, foreground, cursorColor, black..brightWhite, purple for magenta) from the public Windows Terminal colour schemes documentation; no old Kolux source read

> 2026-10-12 · T-148-b · rules from the SET-016 and SET-018 cards; the installed font list via `System.Drawing.Text.InstalledFontCollection` from the public .NET documentation and `fc-list : family` from the public fontconfig man page; the HTML `<details>`/`<summary>` element and its toggle event from MDN; no old Kolux source read

> 2026-10-12 · T-148-c · rules from the SET-020 and VIEW-096 cards and DESIGN.md section 11; no outside source needed; no old Kolux source read

> 2026-10-12 · T-148-d · rules from the SET-023 card and DESIGN.md section 1; no outside source needed; no old Kolux source read

> 2026-10-12 · T-143 · rules from the SESS-009, SESS-001 and SESS-004 cards; no outside source needed; no old Kolux source read

> 2026-10-12 · T-096-a · rules from the SET-008 and SET-010 cards and the T-054 keymap; no outside source needed; no old Kolux source read

> 2026-10-12 · T-096-b · rules from the SET-009 card and COMPAT.md 4.1 (Writing) and 4.2; no outside source needed; no old Kolux source read

> 2026-10-09 · T-025-a · Claude Code's public hooks reference (code.claude.com/docs/en/hooks, through context7): the event names, the payload fields (hook_event_name, source, trigger, tool_name, tool_input, agent_id, prompt) and the settings.json hooks format; Txais's own `G:\Dev\claude-config\settings.json` read once for the shape of its existing hook entries (the old app's and his memory guard), nothing copied and nothing written.

> 2026-10-09 · T-025-b · Codex's public source through context7 (hook config and schema, the trust discovery and command runner, the app-server `hooks/list` call) for the hooks.json format, the event payloads and the trust-key shape; the installed codex-cli 0.156.1's own `app-server` answers on a scratch `CODEX_HOME` for the live keys and hashes; Txais's own `~/.codex/config.toml` and the ponytail plugin's `claude-codex-hooks.json` read once for the shape of existing trust entries, nothing copied and nothing written.

> 2026-10-09 · T-025-c · Claude Code's public hook input types through context7 (SubagentStart, SubagentStop, Stop with `last_assistant_message` and `background_tasks`, the `agent_id` rule, the teammate task events) and Codex's public source (SubagentStop and Stop inputs) for the field names; nothing else read.

> 2026-10-11 · T-026-a · The Tauri notification plugin's public docs through context7 (`NotificationExt`, builder, `init`) and crates.io for the crate itself (2.5.1); nothing else read.

> 2026-10-11 · T-026-b · Nothing read outside the repo: the vocabulary, glyphs, spinner timing and tooltip come from the card and the lane's own code; the browser's Web Animations `startTime` and CSS `steps()` are platform features.

> 2026-10-11 · T-026-c · Nothing read outside the repo: the Inbox's groups, rules and keys come from the card and COMPAT; the data is the lane's own hook state, `scm_status` and `agent_history`.

> 2026-10-11 · T-028-a · context7 /openai/codex `codex-rs/tui/src/keymap.rs` for the approval modal's default keys (y approves, n declines); Claude Code's dialog keys (Enter / Esc) from general knowledge of its public UI; nothing else outside the repo. T-027 read nothing outside the repo.

> 2026-10-11 · T-029, T-030 · deferred; nothing read outside the repo.

> 2026-10-12 · T-010-fix · Nothing read outside the repo.

> 2026-10-12 · T-013-fix-a · Nothing read outside the repo.

> 2026-10-12 · T-013-fix-b · crates.io for `unicode_names2` 4.0.0 (index entry, licence, repository; added as a dependency); nothing else outside the repo.

> 2026-10-12 · T-003b-fix-b · Nothing read outside the repo; the measurements are from the lane app's own window.
> 2026-10-12 · T-007-a-fix · The vendored `windows-sys` 0.61.2 source in the cargo registry (the RegGetValueW declaration, the RRF and HKEY constants and the feature list) and the machine's own registry Path value through PowerShell, to see it holds %SystemRoot% unexpanded. Nothing else outside the repo.
> 2026-10-12 · T-008-b-fix · Nothing read outside the repo beyond the 2026-10-09 review note's item 4 wording.
> 2026-10-12 · T-012-b-fix · context7 Tauri docs (WebviewBuilder on_navigation, on_page_load); the vendored `wry` 0.57.0 WebView2 source (NavigationStarting cancels before ContentLoading, so a cancelled navigation never counts as a page load) and `tauri` 2.12.1 webview builder (initialization_script is main-frame only); the lane app loaded example.com and iana.org over the network for the live proof. Nothing else outside the repo.
> 2026-10-12 · T-014-b-fix · Nothing read outside the repo beyond the 2026-10-09 review note's item 7 wording.
> 2026-10-12 · T-039-a · context7 `/anthropics/claude-code` hooks reference: the StopFailure hook input (`error` values, `error_details`) and the status-line JSON shape; the lane app's own `agent-hooks-endpoint.txt` for the live post. Nothing else outside the repo.
> 2026-10-12 · T-039-b · context7 `/anthropics/claude-code`: the status line's input shape from `mods/types/claude-code.d.ts` (`SessionContextUsage`, `SessionRateLimit` kind/percentUsed/resetsAt), `session.measure` timing, the `refreshInterval` changelog note and the hook-development skill's input docs; Txais's own `G:/Dev/claude-config/settings.json` for the `statusLine` settings shape (type command + a command string run through a POSIX shell). Nothing else outside the repo.
> 2026-10-12 · T-040-a · context7 `/anthropics/claude-code`: `mods/types/claude-code.d.ts` `ContextApiUsage` (input_tokens, cache_creation_input_tokens, cache_read_input_tokens) and the note that the status line's `current_usage` appears in the changelog. Nothing else outside the repo.
> 2026-10-12 · T-041-a · context7 `/openai/codex`: the `-c`/`--config key=value` override flag (`codex-rs/utils/cli/src/config_override.rs`) and the `--profile`/`-p` and `--oss` options (`shared_options.rs`). COMPAT.md 5.7 for the cap's variable and keys. Nothing else outside the repo.
> 2026-10-12 · T-041-b · Nothing outside the repo: the card (USAGE-007), COMPAT.md and the repo's own status, hooks and terminal modules.
> 2026-10-12 · T-042-b · Context7 `/openai/codex`: the TUI `/status` slash command (slash_dispatch.rs, status_controls.rs) and the app-server `account/rateLimits/read` response shape (`RateLimitSnapshot`, `rateLimitResetCredits`). Nothing else outside the repo.
> 2026-10-12 · T-043-d · Context7 `/anthropics/claude-code` (one query: the `claude auth` subcommands and where credentials are stored; nothing documents a renewal command or the keychain entry). The Claude Code CLI installed on this PC, used as a user would: `claude auth status --json` against an empty configuration folder (`loggedIn: false`).
> 2026-10-12 · T-017-c · Context7: `/github/copilot-cli` (two queries: configuration file locations and settings keys; `--allow-all-paths`), `/websites/cursor_cli` (two queries: global options incl. `--trust`, changelog on workspace trust), `/websites/cursor` (one query: workspace trust in the editor). None documents a trust file. Nothing else outside the repo.
> 2026-10-12 · T-018-c · Nothing outside the repo: the card (GIT-002) and the repo's own scm module.

> 2026-10-12 · T-105 · the CLI-023, CLI-026 and CLI-027 spec cards and the T-105 and T-185-b plan lines; the Tauri command type files in the cargo registry. The command shapes, messages and the layout report were written from the cards. Nothing from the old app.
> 2026-10-12 · T-104 · the ACCT-046, ACCT-047, ACCT-048, ACCT-049 and ACCT-065 spec cards and the T-104 plan line; the portable-pty CommandBuilder type files in the cargo registry; the public Windows documentation for ComSpec, chcp, subst and icacls. The shell order, the variable list and the folder messages were written from the cards. Nothing from the old app.
> 2026-10-12 · T-103-a · the VIEW-036 and VIEW-108 spec cards and the T-103 plan line; no app code changed; the cdp.mjs wheel command and the console-mouse stand-in program were written for this task, the latter from the public Windows console API documentation (SetConsoleMode, ReadConsoleInput). Nothing from the old app.
> 2026-10-12 · T-101-a · the TERM-002, TERM-005, TERM-007, TERM-009 and TERM-012 spec cards and the T-101 plan line; the seeding, empty-pane, focus and settings code was written for this task; the live test used stand-in scripts for Claude Code and Codex and a throwaway repository, written for it. Nothing from the old app.
> 2026-10-12 · T-100-a · the SESS-011, SESS-016, SESS-021, SESS-028 and SESS-029 spec cards and the T-100 plan line; Claude Code's public documentation (through context7) for --model, --effort, its effort levels and the fastMode setting; Cursor CLI's and Grok Build's public documentation for their model listings (read for T-100-b, nothing built from them yet); the option, lineup and start-line code was written for this task; the live test used stand-in scripts for Claude Code and Codex and two throwaway repositories, written for it. Nothing from the old app.
> 2026-10-12 · T-098 · the PROJ-055, PROJ-057, VIEW-046 and VIEW-037 spec cards, the T-098 plan line and the keybinding ids already in the keymap; the matching, history and palette code were written for this task; the live test used two throwaway repositories and a stand-in script for Claude, written for it. Nothing from the old app.
> 2026-10-12 · T-205 · the SKILL-006..010 spec cards, the T-205 plan line and COMPAT's results-folder and marker notes; Windows' own pseudo-console documentation for the cursor-position query a new console sends when it inherits the cursor; the seven rules' wording and the role prompts were written for this task; the live test used a stand-in script for each AI, written for it. Nothing from the old app.
> 2026-10-12 · T-204 · the SKILL-001..005 spec cards, the T-204 plan line and COMPAT's results-folder note; Tauri's own docs for the webview drag-drop event and the dialog plugin's open filters; the six kits' wording, prompts and sample data files (all fictional) were written for this task. Nothing from the old app
> 2026-10-12 · T-203 · the GIT-061 spec card and the T-203 plan line; Git's own documentation (git help for init, ls-files --others --exclude-standard -z, --git-dir and --work-tree, add --, commit --allow-empty); the secret-name list is common knowledge of credential file names (dotenv files, SSH and TLS key files, package-manager and netrc credential files), written for this task. Nothing from the old app
> 2026-10-12 · T-202 · the ACCT-015 spec card and the T-202 plan line; Grok Build's shipped user guide (02-authentication.md, already in the T-092-b throwaway GROK_HOME) for its sign-out command, `grok logout`; the public Codex CLI command reference (learn.chatgpt.com/docs/developer-commands, reached from developers.openai.com/codex/cli/reference) for `codex logout`, which removes saved credentials; Rust std docs (Arc::ptr_eq, Mutex::new in a static, fs::remove_dir_all). The stand-in codex.exe for the live check was written for it and never contacts OpenAI. Nothing from the old app
> 2026-10-12 · T-185-a · the CLI-006/010/038 spec cards and COMPAT 2.1/7; cmd's own documented batch syntax (%~dp0, %*, exit /b, if /i, goto) and Windows' default PATHEXT order; Rust std docs for io::ErrorKind::TimedOut/WouldBlock and Command on .cmd files; portable-pty 0.9's CommandBuilder::env_remove in the cargo registry; the tauri config schema in node_modules (bundle.resources as a source-to-target map); RFC 4122's version-4 UUID layout
> 2026-10-11 · T-099 · the SESS-002/003/006/008/010 spec cards; the windows-sys crate source in the cargo registry (RegGetValueW, RRF_RT_ANY) and this PC's own per-user registry (the Lxss key's DefaultDistribution value, read for its presence only); Git for Windows' default install folder (Program Files/Git/bin/bash.exe) and the shells' own command-line flags (powershell -NoLogo, bash --login -i)
> 2026-10-11 · T-092-b · Grok Build 1.0.50's own help text (`grok login --help`, `grok inspect --help`) and the authentication guide it ships (docs/user-guide/02-authentication.md, written into a throwaway GROK_HOME), plus what `grok login --device-auth` printed in that throwaway home before it was stopped; the binary was the portable download from WinGet's xAI.GrokBuild manifest, run from G:Temp and never installed
> 2026-10-11 · T-092-a · WinGet's public return-code list (github.com/microsoft/winget-cli, doc/windows/package-manager/winget/returnCodes.md); `winget show` for OpenAI.Codex, Anthropic.ClaudeCode and xAI.GrokBuild (package ids, x.ai/cli homepage) and WinGet 1.29's own printed progress, seen in a download-only run; windows-sys 0.61 RegGetValueW in the cargo registry

> 2026-10-12 · T-116-a-fix · moved this repo's own T-116-a code (SET-031 card) to the Settings page; no old Kolux source read

> 2026-10-12 · T-138-b · rules from the ACCT-019 card; no OpenAI token-claim source used (none is public), so the label is the user's own; no old Kolux source read.
>
> 2026-10-12 · note: while finding the ACCT-019 card I ran a recursive filename grep from the lane root (`grep -rln ACCT-019 --include=*.md .`), which also scanned the lane's own copy of `provenance/dirty-room/firewall/` and printed one matching file name (07-accounts-keys.md). Only the path was shown, no content was opened or displayed; later searches exclude `provenance/`.

> 2026-10-12 · T-146-a · rules from the VIEW-056 and VIEW-057 cards and DT-R17; Pointer Events setPointerCapture from MDN; no old Kolux source read

> 2026-10-12 · T-153-a · rules from the VIEW-067 and VIEW-116 cards; git restore and git clean behaviour from the public git documentation; no old Kolux source read

> 2026-10-12 · T-154-a · rules from the ACCT-010 and ACCT-011 cards; no outside source and no old Kolux source read

> 2026-10-12 · T-157 · rules from the SAFE-026 and ACCT-009 cards; no outside source and no old Kolux source read

> 2026-10-12 · T-200 · rules from the PROJ-002 card; no outside source and no old Kolux source read

> 2026-10-12 · T-201-a · rules from the SESS-017 card; no outside source and no old Kolux source read

> 2026-10-12 · T-209-a · rules from the ONB-036 card; TypeScript's compiler API (already a dev dependency) parses the scanned files; no outside source and no old Kolux source read

> 2026-10-12 · T-210-a · rules from the SET-017 card; the browser's Intl APIs (Collator, RelativeTimeFormat, DateTimeFormat) and navigator.languages from public MDN docs; no outside source and no old Kolux source read

> 2026-10-12 · T-211 · rules from the APP-023 card; Rust std::process and the gh manual's `gh auth status` (public cli.github.com docs); no outside source and no old Kolux source read

> 2026-10-12 · T-136-b · rules from the USAGE-012 / USAGE-013 cards (and USAGE-016 / 017 for counting once). Log shapes under Txais's option (a) (STATE.md Needs Txais, RESOLVED 2026-10-12): a throwaway script outside the repo printed only field names and value types, never a value, from 4 of his Claude Code transcripts ($CLAUDE_CONFIG_DIR/projects/*/*.jsonl; 51,031 records, none unparsable) and 3 Codex session files (~/.codex/sessions/**/*.jsonl; 123 records); the script and its output were deleted. Observed 2026-10-12:
>   Claude Code, one JSON record per line: type, timestamp (ISO text), sessionId, cwd, isSidechain (bool), uuid, parentUuid, requestId, apiBlockIndex (int), gitBranch, version, entrypoint, agentId; message.id, message.model, message.role, message.type; message.usage.input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens (int); message.usage.cache_creation.ephemeral_5m_input_tokens and ephemeral_1h_input_tokens (int); message.usage.output_tokens_details.thinking_tokens (int or null); message.usage.iterations[] (the same counters), service_tier, inference_geo, server_tool_use. apiBlockIndex means one reply can span several records, so replies are counted once by message.id.
>   Codex, one JSON record per line: timestamp (ISO text), type, payload (object), ordinal (int), metadata; payload.cwd, payload.model, payload.model_provider, payload.session_id, payload.id; payload.info.total_token_usage and payload.info.last_token_usage, each with input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, total_tokens (int); payload.info.model_context_window; the same counters also as payload.usage, payload.turn_token_usage and payload.thread_token_usage; payload.rate_limits.primary / secondary with used_percent, window_minutes, resets_at.
>   The parser reads only the fields it needs, ignores the rest, and skips a line, record or file that does not fit; the test fixtures and the live-check logs are invented records with these field names. That cached input is part of Codex's input count and reasoning part of output follows OpenAI's public usage-object docs. No outside source and no old Kolux source read.

> 2026-10-12 · T-137-a · rules from the USAGE-014 / USAGE-015 cards. Prices from two public pages read 2026-10-12: Anthropic's https://platform.claude.com/docs/en/about-claude/pricing (model table, cache multipliers, long-context section) and OpenAI's https://developers.openai.com/api/docs/pricing (Standard tier text-token table, short and long context, "Long context: >272K input tokens"). Model ids follow the public naming on those pages. No log value read (the stand-in logs are invented), no old Kolux source read.

> 2026-10-12 · T-206 · rules from the SKILL-011..015 cards; pulldown-cmark 0.13 API (Parser, Options, Event, Tag, html::push_html) from its public docs.rs pages via context7; sha2 0.10 public docs; no old Kolux source read

> 2026-10-12 · T-207 · rules from the ONB-001..005 cards; CSS backdrop-filter and prefers-reduced-motion from public MDN docs; no old Kolux source read

> 2026-10-12 · T-208 · rules from the ONB-006, 007, 008, 010 and 012 cards and DT-25; no outside sources; no old Kolux source read

> 2026-10-12 · T-201-b · rules from the SESS-017 and SESS-019 cards; no outside sources; no old Kolux source read

> 2026-10-12 · T-153-b · rules from the VIEW-089 and VIEW-099 cards; no outside sources; no old Kolux source read

> 2026-10-12 · T-154-b · rules from the ACCT-055 card; tauri-plugin-dialog 2.8.1 Rust API (FileDialogBuilder::blocking_pick_file, set_directory, set_title) read from its public crate source in the local cargo registry; no old Kolux source read

> 2026-10-12 · T-171 · rules from the ACCT-014 and ACCT-024 cards and COMPAT 5.7; no outside source used; no old Kolux source read

> 2026-10-12 · T-170 · rules from the USAGE-016 and USAGE-017 cards; log field names as recorded in section 5 (T-136-b); test records invented; no old Kolux source read

> 2026-10-12 · T-136-c · rules from the USAGE-011 card and SET-006; hook event names from this tree's own hooks.rs; no outside source used; no old Kolux source read

> 2026-10-12 · T-137-b / T-139-c · source check only: docs.x.ai/build/cli/reference and docs.x.ai/build/features/status-line read; neither documents Grok credit figures or a session-file format; nothing built or copied

> 2026-10-12 · T-339 · rules from SET-020, VIEW-011, VIEW-116, USAGE-010, ORCH-031 and ACCT-001 cards and DT-A6; no outside source used; no old Kolux source read
> 2026-10-12 · T-134-a · The cards CLI-024/CLI-025, COMPAT 2.1 rows for terminal read/send/wait, the xterm.js public typings in node_modules (`buffer.active`, `viewportY`, `translateToString`). Nothing from the old app.
> 2026-10-12 · T-139-b · The cards ACCT-023/ACCT-064 and the repo's own codex_accounts and terminal modules. Nothing from the old app.
> 2026-10-12 · T-145-b · The card TERM-098, the public win32-input-mode spec in microsoft/terminal's doc/specs (via context7) for the key-event sequence, the vendored portable-pty 0.9.0 source for the pseudoconsole flags. Nothing from the old app.
> 2026-10-12 · T-050 · The cards VIEW-015, VIEW-019, VIEW-021 and VIEW-024, and this repo's own sidebar rows, chooser pane and Board cells. Nothing from the old app.
> 2026-10-12 · T-028-b · The card VIEW-017 and this repo's own status vocabulary and Board chip. Nothing from the old app.
> 2026-10-12 · T-040-b · The cards USAGE-004, VIEW-018 and USAGE-025, and this repo's own meter, ring and pill code. Nothing from the old app.
> 2026-10-12 · T-144-a · The cards TERM-010 and TERM-024, DT-A7, and this repo's own grid and pane code; CSS container queries and pointer capture are platform features. Nothing from the old app.
> 2026-10-12 · T-102-a · The cards TERM-044, TERM-049 and TERM-045, COMPAT's tab.close / tab.closeAll rows, and this repo's own close question, grid and menu code. Nothing from the old app.
> 2026-10-12 · T-174-a · The cards ORCH-054 and ORCH-058, COMPAT 7, CLI-007 and this repo's own CLI, terminal and process code; taskkill, the Toolhelp snapshot and kill(1) are platform tools. Nothing from the old app.
> 2026-10-12 · T-058 · The cards SAFE-009..012, COMPAT 3.2 and the PreToolUse reply shape from Claude Code's published hook docs (context7), and this repo's own hook server and script. Nothing from the old app.
> 2026-10-12 · T-059-a · The cards SAFE-013 and SAFE-014, the hook input fields (`cwd`) from Claude Code's published hook docs (context7), PowerShell's and cmd's public switch names, and this repo's own protected module. Nothing from the old app.
> 2026-10-12 · T-060 · The cards SAFE-021 and SAFE-022, Windows' public path forms (UNC, long-path and device prefixes, 8.3 short names, alternate data streams), Explorer's /select switch and macOS open -R, and this repo's own files and artifacts modules. Nothing from the old app.
> 2026-10-12 · T-061 · The card GIT-003 and the app's own CloseAsk dialog; git's reset, checkout and pathspec-from-file behaviour as the unit test exercises it on this machine; no outside source.
> 2026-10-12 · T-062-a · The cards EDIT-044, EDIT-045 and EDIT-053 and the T-060 host refusal; Rust std `canonicalize` and Windows sharing-violation error codes as the unit tests exercise them on this machine; no outside source.
> 2026-10-12 · T-063 · The card BROW-051 and the app's own hooks and CLI servers; the Fetch standard's CORS and Sec-Fetch behaviour as the app's own web view showed it; no outside source.
> 2026-10-12 · T-064-a · The card APP-041 and the app's own secrets, terminal and settings modules; the token prefixes are the public formats of Anthropic, GitHub, Slack, AWS, Google, GitLab and npm keys as their documentation shows them; no outside source.
> 2026-10-12 · T-064-b · The card APP-070, the Send Feedback card's Compat line and the app's own update, artifacts and CLI modules; GitHub's new-issue address parameters (title, body) as its public documentation shows them; the WebView2 flag from Tauri's config reference (additionalBrowserArgs); no outside source.
> 2026-10-12 · T-065 · The card PROJ-067, DESIGN.md and the lane's own App.tsx/workspaces.ts; no outside source.
> 2026-10-12 · T-066 · The card SESS-030, Claude Code's public CLI/hook docs (`claude --resume <id>`, hook `session_id`) and the Codex CLI's public `resume` subcommand, read through context7; the lane's own hooks.rs, layout.ts and agents.rs.
> 2026-10-12 · T-067 · The four cards, DESIGN.md, the public typings of @xterm/xterm and @xterm/addon-webgl in node_modules and a grep of xterm's lib for mode 2026; the lane's own TerminalPane.tsx, grid.ts and App.tsx; no outside source.
> 2026-10-12 · T-166 · The five cards, DESIGN.md, xterm's public typings (IBuffer, isWrapped) in node_modules, the vendored portable-pty 0.9.0 (its ConPTY flags) and Microsoft's public SetConsoleCtrlHandler contract; the lane's own TerminalPane.tsx, terminal.rs, App.tsx and cli.rs; no outside source.
> 2026-10-12 · T-068 · The card, DESIGN.md, xterm's public typings (IBuffer, scrollLines, onWriteParsed, onKey) in node_modules, Microsoft's public ConPTY behaviour observed in my own panes; the lane's own terminal.rs, TerminalPane.tsx, App.tsx, main.tsx and layout.ts; no outside source.
> 2026-10-13 · T-541 · cargo-deny configuration docs (github.com/EmbarkStudios/cargo-deny, docs/src/checks: advisories ignore entries with a reason, bans, sources) and the public GitHub Action taiki-e/install-action, used by name with its tool input (installs cargo-deny on a Windows runner; nothing read from it); RustSec advisory RUSTSEC-2024-0370 as printed by cargo-deny; no code copied; no old Kolux source read
> 2026-10-13 · T-108-b · public docs read 2026-10-13: GSD's npm package get-shit-done-cc 1.42.3, file get-shit-done/references/worktree-path-safety.md (https://cdn.jsdelivr.net/npm/get-shit-done-cc@1.42.3/get-shit-done/references/worktree-path-safety.md): its executors run in Claude Code isolation worktrees on `worktree-agent-*` branches and write `gsd-spawn-toplevel` into the worktree's Git folder; and Claude Code's worktree page https://code.claude.com/docs/en/worktrees (`.claude/worktrees/` default folder, subagent isolation). Only the file name and folder facts were used; no GSD code was copied · area 01
> 2026-10-13 · T-109-b · public docs relied on from general knowledge (not opened this pass): the GitHub CLI manual for `gh issue list` and `gh pr list` (`--search`, `--json number,title,url`) at https://cli.github.com/manual/, and GitHub's search docs ("About searching on GitHub": queries longer than 256 characters are not supported) at https://docs.github.com/en/search-github/getting-started-with-searching-on-github/about-searching-on-github. Behaviour only, no text or code copied · area 02

> 2026-10-13 · T-112-a · public sources read 2026-10-13 for the two setup-file formats: Conductor's conductor.json docs (https://www.conductor.build/docs/core/conductor-json: scripts.setup, scripts.run, scripts.archive); the Codex app's local environments page (https://learn.chatgpt.com/docs/environments/local-environment: config lives in the project's .codex folder) and, for the file's key names, public example files at .codex/environments/environment.toml in public GitHub repositories (unpkg/unpkg, petyosi/react-virtuoso, sketch-hq/fig2sketch, ccusage/ccusage, akarras/ultros, read with `gh api` contents; keys version, name, [setup] script, [setup.windows] script, [cleanup] script) and public conductor.json files (vercel/next.js, RSSNext/Folo, tambo-ai/tambo). Only key names and meanings taken; no code.
> 2026-10-13 · T-542 · rules from the council consensus section 4 row E and the pass brief; selectors, IPC command names and the hook request shape from this tree's own src/, src-tauri/hooks.rs and scripts/evidence/cdp.mjs (read, not edited); no outside source used; no old Kolux source read

> 2026-10-13 · T-152 · rules from the STAT-004 and STAT-005 cards, COMPAT.md 3.4 (the Claude settings path) and DT-C1; public doc: https://docs.claude.com/en/docs/claude-code/settings (user settings live in ~/.claude/settings.json, or the CLAUDE_CONFIG_DIR folder) and https://docs.claude.com/en/docs/claude-code/hooks (hook entry shape, already used by STAT-001); Codex hook shape as already in this tree's hooks.rs; no old Kolux source or hook script read
> 2026-10-13 · T-120-a · rules from the STAT-002 and STAT-003 cards and T-036's card; public docs: https://docs.claude.com/en/docs/claude-code/hooks and https://docs.claude.com/en/docs/claude-code/settings (hooks and statusLine in settings.json) for what counts as Kolux's Claude Code entries; Codex hooks.json shape as already in this tree's hooks.rs; no old Kolux source or hook script read
> 2026-10-13 · T-167-a · rules from the STAT-006, STAT-030 and STAT-037 cards; public doc: https://docs.claude.com/en/docs/claude-code/hooks (hook commands get the event as JSON on stdin and a 0 exit with no output changes nothing); the batch-file techniques (setlocal DisableDelayedExpansion, for /f usebackq, %~z size test, set /p without a newline) are documented cmd.exe behaviour (https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/for, .../setlocal, .../set_1); curl flags from https://curl.se/docs/manpage.html; no old Kolux source or hook script read
> 2026-10-13 · T-128-a · rules from the ACCT-050 card and DT-C11; public docs: https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/nf-tlhelp32-createtoolhelp32snapshot (process table with parent ids), https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess (ProcessCommandLineInformation, a UNICODE_STRING), https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocess (PROCESS_QUERY_LIMITED_INFORMATION), https://docs.rs/portable-pty/latest/portable_pty/trait.MasterPty.html (process_group_leader) and proc(5) for /proc/<pid>/cmdline; agent matching reuses this tree's agents::credited_agent; no old Kolux source read
> 2026-10-13 · T-152-gate · rule from the coordinator's council C2 safety finding (a launch with the user-scope CLAUDE_CONFIG_DIR rewrote the real Claude settings); one setting read in this tree's own agent_hooks::sync; no outside source, no old Kolux source or hook script read
> 2026-10-13 · T-152-gate rework · coordinator brief: one key only (the existing agentStatusHooks switch, off with no saved value), the second key removed; this tree's own agent_hooks, hooks.rs and AgentsPage only; no outside source, no old Kolux source or hook script read
> 2026-10-13 · T-184 · public doc: Microsoft Learn Job Objects pages (CreateJobObjectW, SetInformationJobObject with JOBOBJECT_EXTENDED_LIMIT_INFORMATION and JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, AssignProcessToJobObject, IsProcessInJob, nested jobs) and the windows-sys 0.61 feature list and portable-pty 0.9 Child::as_raw_handle from the registry sources already in the tree · areas 03, 21 · council C2 consensus and DT-C27 for the shape; no old Kolux source read, nothing copied
> 2026-10-13 · T-542-b · rules from the council C2 answers (quit stops all, ACCT-051) and the pass brief; the quit path (plugin:window|close -> onCloseRequested -> WindowEvent::Destroyed -> Terminals::kill_all), the savedLayout shape, the needsStrip field and the hook install location from this tree's own src/, src-tauri/ and scripts/evidence/cdp.mjs (read, not edited); process tree via Win32_Process over PowerShell; no outside source used; no old Kolux source read

> 2026-10-13 · T-500 · council r1-security finding 4 answered with a live probe (`evidence/T-500-isolation.txt`); the rule for what a tab may open came from reading tauri 2.12.1's own source in the cargo registry (src/webview/mod.rs on_message, src/manager/mod.rs is_local_url, src/manager/webview.rs main_frame_script) and tauri-utils 2.10.1 config docs for csp/devCsp; nothing copied; no old Kolux source read
> 2026-10-13 · T-278 · ACCT-054 and ACCT-059 from spec/07-accounts-keys.md and the reliability-lane handover; the ack/high-low-water shape is the usual PTY flow control (xterm.js's own "flow control" guide on its public site describes the same write-callback acknowledgement); GlobalMemoryStatusEx from the Microsoft Learn page and the windows-sys 0.61 feature already in Cargo.toml · areas 03, 07 · no old Kolux source read, nothing copied
> 2026-10-13 · T-164 · TERM-047/071/090/107/108 from spec/03-terminals-panes.md and DT-C27 in DECISIONS.md; chunked paste and the ordered write chain are plain JavaScript; the restored mark reuses the TERM-106 restore flow; xterm 6 scroll behaviour observed live, nothing read from any old Kolux source · area 03 · no old Kolux source read, nothing copied
> 2026-10-13 · T-165 · TERM-109/110/111/112/113 from spec/03-terminals-panes.md and DT-C27 in DECISIONS.md; the error words, the exit overlay and the start stagger are plain TypeScript in src/terminal/errors.ts and TerminalPane.tsx; the GPU-context pool (TERM-103) and the scrollback profile (ACCT-059) are reused for TERM-112; startup order observed live with 20 saved tabs · area 03 · no old Kolux source read, nothing copied
> 2026-10-13 · T-281 reverted 02ca825 -> c0dff35 (council D1 job 1: the 60 s kill and app-wide cap of 8 on every git::run; re-land with long-running commands exempt and no app-wide cap)
> 2026-10-13 · reliability handover round 1 · T-073-a kind "stale" (d64c959), T-286 locked-record guard (d714e87), trust::write_whole re-read + .bak-kolux (f1fb9e6): rules from the council pre-merge review and gates audit and main's src/editor/buffers.ts isStale; git's own worktree lock behaviour (git help worktree, locked file); no outside source, no old Kolux source read
> 2026-10-13 · T-152 (acceptance rewrite) · coordinator brief (the six acceptance lines, council C2 safety rule); this tree's own hooks.rs and agent_hooks only; Rust std (fs::rename, File::sync_all, canonicalize) and the sha2 crate's docs; the proof file is synthetic, written from scratch, no real settings file read; no outside source, no old Kolux source
> 2026-10-13 · T-442-b · coordinator brief and the card line; this tree's own projects.rs, files.rs, terminal.rs output event and fence.rs; Tauri 2 command attribute (async) and event-listen docs; the timing harness, slowgit.rs and gh.rs stand-ins are throwaway scripts written from scratch under G:/Temp
> 2026-10-13 · T-144-b · spec TERM-078 / TERM-097 and this tree only (theme.ts, TopBar.tsx, AppearancePage.tsx, EditorPane.tsx, keys/actions.ts ids); xterm option names (fontFamily, fontSize, lineHeight, fontWeight, fontWeightBold) from @xterm/xterm typings already in node_modules; nothing copied; no old Kolux source opened
> 2026-10-13 · T-146-c · spec VIEW-006 / VIEW-009 and this tree only (theme.ts, App.tsx, TopBar.tsx, chrome/fullPage.ts, AppearancePage.tsx); nothing copied; no old Kolux source opened
> 2026-10-13 · T-441-c · council D2 MERGE 24 review (merge24-review.md) and coordinator brief; this tree's own trust.rs, state.rs, skill_delete.rs, projects.rs (origin records) and codex_accounts.rs read-then-compare pattern; Rust std fs only; tests synthetic under G:/Temp; nothing copied; no old Kolux source opened
> 2026-10-13 · T-076 · spec CLI-012 / CLI-005 and COMPAT 2.5 / 7; this tree's own cli.rs (open, read_endpoint, serve, serve_loop, scan) and local_cli.rs; Rust std only (TcpListener, AtomicBool, fs); the proof helpers st.sh / up.mjs are throwaway scripts written from scratch under G:/Temp/cli-t076-logs; nothing copied; no old Kolux source opened
> 2026-10-13 · T-287 · spec CLI-041; this tree's own cli.rs (status path, call, serve_loop, text_of), resources.rs (owners, total, imp::fill), sysmem.rs (PagefileUsage field layout) and src/status/ResourceManager.tsx / resources.ts / memory.ts (row shape and the MB/GB format, read only); Win32 PROCESS_MEMORY_COUNTERS.PagefileUsage via windows-sys already in Cargo.lock; proof helpers up.mjs / proof.mjs / noapp.sh are throwaway scripts written from scratch under G:/Temp/cli-t287-logs; nothing copied; no old Kolux source opened
> 2026-10-13 · T-550 (CLI part) · spec CLI-001 naming and the T-550 card; this tree's own cli.rs (STOP_GONE, no_terminal, await_layout, query_text, help()/named()), local_cli.rs (skills hint, agent-context text) and orchestration.rs (CLI const); council D2 merge35-review.md list of five hints. No outside source.
> 2026-10-13 · T-442-c · council D2 MERGE 26 review (merge26-review.md) and coordinator brief; this tree's own files.rs, kits.rs, fence.rs and projects.rs locate_repo/register_project; Tauri 2 command attribute (async); the timing harness (h.js) and stand-in git/gh are throwaway scripts written from scratch under G:/Temp/reliability-t441c; nothing copied; no old Kolux source opened
> 2026-10-13 · T-152-b · council D2 review of MERGE 23 (G:\Dev\claude-config\state\kolux-rs-council\d2\merge23-review.md) and the coordinator brief; this tree's own hooks.rs, agent_hooks and scripts/evidence/smoke.mjs only; Rust std (File::sync_all, fs::rename, canonicalize, Path::ancestors); the real-shape proof ran on the coordinator's copy of the current settings file (hashes, byte counts and key names only in evidence/T-152-b.txt); no outside source, no old Kolux source or hook script read
> 2026-10-13 · T-152-b (5) known race · write_atomic (hooks.rs) re-reads the file and then renames its temp file over it; a writer that lands between that re-read and the rename is overwritten. The window is one syscall, and Claude Code's own saves are whole-file renames, so the loser is at most one of its saves. A save caught by the re-read is read again and merged once more (install_claude_at); a second change fails with nothing written
> 2026-10-13 · T-278-c · council D2 MERGE 31 review (merge31-review.md) and coordinator brief; this tree's own terminal.rs, pty.rs, paste.ts, TerminalPane.tsx, flow.ts and scripts/evidence/{smoke,cdp}.mjs; Tauri 2 command attribute (async); Rust std Arc/Mutex; xterm's Clipboard.ts in node_modules for the CR-LF to CR rewrite and the bracket sequences; the live harness (c31-*.mjs/.ps1) and stand-in gh are throwaway scripts written fresh under the scratchpad; nothing copied; no old Kolux source opened
> 2026-10-13 · T-073 · spec/12-editor-files.md EDIT-003 and the coordinator brief (with the council addendum: the banner is advisory, the T-073-a hash check is the guard); this tree's own files.rs (write_checked, fence.allow), buffers.ts, EditorPane.tsx (saveFile, StaleNotice), DiffPane.tsx (read only: its MergeView two-column use) and scripts/evidence/smoke.mjs, cdp.mjs, shot.ps1; Rust std fs metadata and File::set_modified; @codemirror/merge MergeView, @codemirror/commands undo and isolateHistory (installed packages); tests synthetic under the system temp and G:/Temp/look-t073; nothing copied; no old Kolux source opened
> 2026-10-13 · T-123 · spec/04-agent-status-hooks.md STAT-024/025/027/028/029 and spec/10-plan-review-protected.md SAFE-001/007; the coordinator brief; this tree's own status.rs, hooks.rs, agent_hooks/saved.rs, lib.rs timer, App.tsx listener, terminal/status.ts, notify.ts, board/chip.ts; scripts/evidence/smoke.mjs + cdp.mjs + shot.ps1 as the model for the throwaway proof script (G:Temp scratchpad, not in the repo); Claude Code hook event field names as the existing hooks.rs tests already use them (background_tasks, session_crons, last_assistant_message, compact_summary, run_in_background); nothing copied; no old Kolux source opened; no ~/.claude/projects transcript read
> 2026-10-13 · T-551 · DECISIONS.md DT-C46 and PLAN.md T-551; spec/17 SET-027 and spec/02 SESS-027/051 (read only); this tree's own agents.rs (CATALOGUE, prompt_skips, line_for, start_line and their tests); the installed codex-cli 0.156.1 `codex --help` output (public CLI help, pasted raw in evidence/T-551.txt). Nothing copied from any other product.
> 2026-10-13 · T-033-b · spec GIT-001 / GIT-037 / GIT-038 and the coordinator brief; this tree's own scm.rs (status, the Tauri event pattern), git.rs (command()), diag.rs (diag::write) and the existing windows-sys use in this tree; Microsoft's Win32 documentation for ReadDirectoryChangesW, FILE_NOTIFY_INFORMATION and overlapped I/O, git's documentation for GIT_OPTIONAL_LOCKS and GIT_TRACE2, the Tauri 2 event API docs; the notify crate was weighed by its crates.io licence and advisory data only and not used (cargo-deny refuses it); tests synthetic under G:/Temp/rel-t033b; nothing copied; no old Kolux source opened
> 2026-10-13 · T-033-c · spec GIT-001 / GIT-037 / GIT-038, the coordinator brief and the council FIX-SOON notes; this tree's own scm.rs, git.rs, scm_watch.rs, App.tsx (openDiff, cellsOf, read only), SourceControlPanel.tsx, AllChangesPane.tsx and watch.ts; git's documentation for check-ignore (--stdin -z -v -n), diff --numstat / --name-status against a commit, merge-base and show <commit>:<path>; @codemirror/merge's MergeView / unifiedMergeView docs already in this tree; Rust std (Path::ancestors, Instant); nothing copied; no old Kolux source opened
> 2026-10-13 · T-547 survey (no code) · public vendor docs only, fetched 2026-10-13: code.claude.com/docs/en/statusline, /authentication, /legal-and-compliance; platform.claude.com/docs/en/manage-claude/usage-cost-api; learn.chatgpt.com/docs/app-server and /docs/auth (redirects from developers.openai.com/codex/...); openai.com/policies/terms-of-use (quoted via search, page 403); geminicli.com/docs/resources/quota-and-pricing; developers.google.com/gemini-code-assist/resources/quotas; antigravity.google/docs/plans; platform.kimi.ai/docs/api/balance; www.kimi.com/code/docs/en/kimi-code/membership.html; platform.minimax.io/docs/m-plan/faq.md and /usage-rules.md and /docs/llms.txt. No installed binary, config folder, credential file, network capture, source mirror or old-app material read; third-party tool pages seen in search results were not used. The Gemini CLI terms page fetch was refused by the session tooling and is marked not assessed.
> 2026-10-13 · T-278-d · council D2 MERGE 32 review (G:\Dev\claude-config\state\kolux-rs-council\d2\merge32-review.md) and the coordinator brief; this tree's own paste.ts, paste.test.ts, TerminalPane.tsx and scripts/evidence/{smoke,cdp}.mjs (read for the CDP patterns); xterm.js 6 public API (buffer, modes) and the Chrome DevTools Protocol docs for the live proof. No other source.
> 2026-10-13 · T-151 · spec/03-terminals-panes.md:611-663 (TERM-003, TERM-031, TERM-046, TERM-069) and the coordinator brief; this tree's own paste.ts, TerminalPane.tsx, chrome/Ask.tsx, App.tsx (read only, for the merge hunks), hooks.rs and agent_hooks (hook event → pane state, endpoint gate), terminal.rs (terminal_busy), scripts/evidence/*.mjs (CDP patterns); xterm.js 6 public API (modes, buffer); readline / ConPTY bracketed-paste behaviour observed live in the dev app. No Orca source, no dirty-room material.
> 2026-10-13 · T-123-c · spec/04-agent-status-hooks.md STAT-028 and the council review G:/Dev/claude-config/state/kolux-rs-council/d2/merge34-review.md (F1, rules a/b/c); the coordinator brief; this tree's own status.rs (Session, apply_lead, cancel, settle_cancel and the stat_028 tests as the model for the two new ones) and hooks.rs tests for the tool_use_id field name; scripts/evidence/cdp.mjs + shot.ps1 and the previous pass's proof-t123.mjs as the model for the throwaway proof script (G:/Temp/hooks-t123c-logs, not in the repo); nothing copied from the old app.
> 2026-10-13 · T-124 · spec/04-agent-status-hooks.md STAT-032/033/034/035/042; the coordinator brief; this tree's own status.rs (Session, quiet_check and settle_cancels as the model for the settle pass, the stat_024 tests), lib.rs 2 s tick, terminal/status.ts + test, TerminalPane.tsx (xterm onTitleChange / parser.registerOscHandler, from xterm's own typings in node_modules), status/useAgentStatus.ts, board/chip.ts (stale word), settings/NotificationsPage.tsx and general.ts (read only, for what T-124-b still needs); scripts/evidence/cdp.mjs + shot.ps1 and proof-t123c.mjs as the model for the throwaway proof script (G:/Temp/hooks-t123c-logs, not in the repo); nothing copied from the old app.
> 2026-10-13 · T-123-d · spec/04-agent-status-hooks.md STAT-027 and SAFE-006; the coordinator brief; this tree's own hooks.rs (ask_of, plan_of, claude_change), status.rs (fit_plan, the stat_027 test), board/chip.ts + chip.test.ts, status/useAgentStatus.ts (read, and edited only locally for the proof), terminal/TerminalPane.tsx (read only: where chip.line is drawn), theme.ts (the appearance keys); scripts/evidence/cdp.mjs + shot.ps1 and proof-t124.mjs as the model for the throwaway proof script (G:/Temp/hooks-t123d-logs, not in the repo); Claude Code's AskUserQuestion input field names as the existing hooks.rs tests already use them (questions, question); nothing copied from the old app.
> 2026-10-13 · T-262 · spec/08-orchestration.md ORCH-060 and PLAN.md T-262; this tree's own terminal.rs (Terminals every/layout, read only), App.tsx reportLayout (read only), cli.rs terminal_rows/peers (read only) and agents.rs credited_agent. Nothing copied from any other product.
> 2026-10-13 · T-279 · spec/08-orchestration.md ORCH-035 (ORCH-057/059 read to split them to T-279-b) and PLAN.md T-279; this tree's own orchestration.rs (dispatch_check, task_update, finished, terminal_of and their tests). Nothing copied from any other product.
> 2026-10-13 · T-073-e · council D2 MERGE 33 review (merge33-review.md, items A1/A2/cost) and the coordinator brief; this tree's own diskChange.ts (+test), EditorPane.tsx, files.rs (read only: file_write / fence.allow) and scripts/evidence/{smoke,cdp}.mjs plus the lane's own T-073-run.mjs / T-073-proof.mjs drivers as the model for T-073-e-run.mjs / T-073-e-proof.mjs; live run on the scratch repo under G:/Temp/look-t546; nothing copied; no old Kolux source opened

> 2026-10-13 · T-546 · the OD-09 control tower card (PLAN.md line 770) and DT-C32..C37 in DECISIONS.md plus the coordinator brief; this tree's own board/chip.ts (chipOf, Chip, Lane, LANES), usage/plan.ts (planOf, Plan, PlanFigures, tone), inbox/inbox.ts (moveSelection, settle) and InboxView.tsx / Board.tsx as the model for the rows, StatusGlyph, VendorMark, Ring, programWord, folderName, span; hooks.rs (the curl route, gate headers) and status.rs (event -> state) read only for the stand-in; scripts/evidence/{smoke,cdp}.mjs + shot.ps1 and the lane's T-073-e-run.mjs / T-073-e-proof.mjs as the model for T-546-run.mjs / T-546-proof.mjs. Nothing copied from any other source.

> 2026-10-13 · T-546-b (2) · the T-546-b PLAN line (item 2) and the OD-09 card; this tree's own tower.ts / TowerView.tsx / tower.css / tower.test.ts, usage/plan.ts and usage/meter.ts (planOf, PlanFigures), terminal/layout.ts (the account field a saved pane keeps) and the lane's T-546-run.mjs / T-546-proof.mjs plus scripts/evidence/smoke.mjs launch() as the model for T-070-run.mjs / T-070-proof.mjs; live run on a scratch profile under G:/Temp/look-t070 with a stand-in claude.cmd; nothing copied; no old Kolux source opened
> 2026-10-13 · T-076-b · PLAN card T-076-b (council D2 MERGE 35 FIX-SOON) and spec CLI-012; this tree's own cli.rs (call, status_of, status_line, serve_loop, the cli012 tests); Rust std TcpStream::set_read_timeout; the held-connection helper (hold.mjs) and the launch/proof scripts under G:/Temp/cli-t076b-logs are throwaway scripts written from scratch; no outside source, no old Kolux source opened.
> 2026-10-13 · T-079-b · PLAN card T-079-b and spec TERM-125; this tree's own cli.rs (terminal.read/send/wait/show dispatch and text, wait_for_terminal, the T-134-a tests) and the T-134-a evidence format; the proof script (t079b.sh) under G:/Temp/cli-t076b-logs is a throwaway written from scratch; no outside source, no old Kolux source opened.
> 2026-10-13 · T-313 · spec GIT-008 / GIT-013 / GIT-014 and the coordinator brief; this tree's own scm.rs (remote, failure_kind, parse_status, check_paths), links.rs (reveal, open_path) and SourceControlPanel.tsx; git's documentation for status --porcelain=v2 (the submodule field S<c><m><u>), pull --rebase / --no-rebase and the pull.rebase / pull.ff settings, and GIT_CONFIG_NOSYSTEM; the live harness is a throwaway script outside the repo
> 2026-10-13 · T-033-f · council D2 merge48-review.md FIX-SOON 1 and the coordinator message; this tree's own scm_watch.rs (Ignores, ask_git, matters, counts, Places::watches) and git.rs; git's documentation for check-ignore, ls-files -z and gitignore (the info/exclude file lives in the repository's common directory, shared by linked worktrees)
> 2026-10-13 · T-123-c-b · the council MERGE 40 review finding (hooks lane, FIX-SOON) as given in the coordinator brief; the public Claude Code hook reference code.claude.com/docs/en/hooks (Stop does not run on a user interrupt; a cancelled tool fires no PostToolUseFailure); this tree's own status.rs (apply_lead, fresh_tool, cancel, settle_cancel and the stat_028 tests); the proof harness reuses this lane's own T-123-d proof script. No other source.
> 2026-10-13 · T-124-c · the council MERGE 40 review finding (hooks lane, AFTER) as given in the coordinator brief; this tree's own board/chip.ts + chip.test.ts, terminal/status.ts + status.test.ts (titleState), status.rs (status_inband, agent_answer, Session, the child permission path), terminal/TerminalPane.tsx (read only: where chip.answer gates Approve/Deny); the proof harness reuses this lane's own T-123-d proof script. No other source.
> 2026-10-13 · T-033-c · spec GIT-001 / GIT-037 / GIT-038, the coordinator brief and the council FIX-SOON notes; this tree's own scm.rs, git.rs, scm_watch.rs, App.tsx (openDiff, cellsOf, read only), SourceControlPanel.tsx, AllChangesPane.tsx and watch.ts; git's documentation for check-ignore (--stdin -z -v -n), diff --numstat / --name-status against a commit, merge-base and show <commit>:<path>; @codemirror/merge's MergeView / unifiedMergeView docs already in this tree; Rust std (Path::ancestors, Instant); nothing copied; no old Kolux source opened
> 2026-10-13 · T-547 survey (no code) · public vendor docs only, fetched 2026-10-13: code.claude.com/docs/en/statusline, /authentication, /legal-and-compliance; platform.claude.com/docs/en/manage-claude/usage-cost-api; learn.chatgpt.com/docs/app-server and /docs/auth (redirects from developers.openai.com/codex/...); openai.com/policies/terms-of-use (quoted via search, page 403); geminicli.com/docs/resources/quota-and-pricing; developers.google.com/gemini-code-assist/resources/quotas; antigravity.google/docs/plans; platform.kimi.ai/docs/api/balance; www.kimi.com/code/docs/en/kimi-code/membership.html; platform.minimax.io/docs/m-plan/faq.md and /usage-rules.md and /docs/llms.txt. No installed binary, config folder, credential file, network capture, source mirror or old-app material read; third-party tool pages seen in search results were not used. The Gemini CLI terms page fetch was refused by the session tooling and is marked not assessed.

> 2026-10-13 · T-260 · PLAN card T-260 and spec VIEW-013, VIEW-111; this tree's own activity.rs (note, end, the usage_011 tests), status.rs terminal_of and the hook state names (read only), terminal.rs Terminals::started (read only), notifications.rs; tauri-plugin-notification 2.6 builder and show() from its public docs root https://docs.rs/tauri-plugin-notification; no outside source copied.
> 2026-10-13 · T-140 · PLAN card T-140 and spec AUTO-014; this tree's own automations.rs (follow, finish, the auto012 tests), terminal.rs OutputLog/strip_ansi (read only), token_usage.rs Row and usage/pricing.ts estimate (read only); no outside source.
> 2026-10-13 · T-287-b · PLAN card T-287-b and spec CLI-041 (via the T-287 PLAN line); this tree's own resources.rs Usage shape, status/resources.ts, ResourceManager.tsx and memory.ts formatMemory; the column widths were measured on the dev app over CDP; no outside source.
> 2026-10-13 · T-273 · PLAN card T-273 and spec PROJ-087; this tree's own capture.rs claude_dir and trust.rs real_path; public Claude Code docs (docs.anthropic.com) for the per-project history folder under the config folder; the folder-name rule checked against a scratch config folder only; no outside code.
> 2026-10-13 · T-146-b · PLAN card T-146-b and spec VIEW-056 / VIEW-057; this tree's own RightSidebar.tsx, its tests and the menu classes in styles.css (read only); React docs (react.dev) for error boundaries; tab widths measured on the dev app over CDP; no outside code.
> 2026-10-13 · T-288 · PLAN card T-288 and spec PROJ-036, COMPAT 5.6 (kolux.yaml issueCommand and the .kolux override); this tree's own setup.rs (scripts_entry, setup_line) and projects/model.ts SetupLine; no outside source
> 2026-10-13 · T-110-a · PLAN card T-110 (split) and spec STAT-055, COMPAT 5.5 (setup variables) and 5.6 (kolux.yaml scripts.archive); this tree's own setup.rs (setup_line, scripts_entry) and projects.rs workspace_remove (read for the hunk); no outside source
> 2026-10-13 · T-123-c-c · the council MERGE 44 review finding (hooks lane, FIX-SOON) as given in the coordinator message; the public Claude Code hook reference code.claude.com/docs/en/hooks; this tree's own status.rs (goes_on, cancel, settle_cancel, CANCEL_GRACE_MS and the stat_028 tests); the proof harness is this lane's own T-123-c-b proof script. No other source.
> 2026-10-13 · T-269 · PLAN card T-269 and spec BROW-006 / BROW-011; this tree's own browser.rs and BrowserPane.tsx; the earlier lane WIP of my own lane (colour helper); Tauri 2 WebviewBuilder background colour and Webview set background colour (docs.rs/tauri root); CSS container queries (developer.mozilla.org root).
> 2026-10-13 · T-188 · PLAN card T-188 and spec TERM-126; this tree's own cli.rs (terminal.send, the T-134-a submit watch and tests) and status.rs activity / state_of (read only) and scripts/evidence/smoke.mjs (the stand-in pattern); Rust std only; the stand-in claude.cmd, poster.mjs (node:http), standin-on.mjs (CDP) and t188.sh under G:/Temp/cli-t188-logs are throwaways written from scratch; no outside source.
> 2026-10-13 · T-287-c · PLAN card T-287-c (council AFTER, MERGE 38 review) and spec CLI-041; this tree's own resources.rs (total, memory_now, Usage) and cli.rs (memory_text, the cli041 test); Rust std only; no outside source.
> 2026-10-13 · T-076-c · PLAN card T-076-c (council AFTER, MERGE 43 review) and spec CLI-012; this tree's own cli.rs (serve_loop, status_answer, status_of, status_line, the cli012 tests); Rust std only; no outside source.
> 2026-10-13 · T-314-a · PLAN card T-314 and spec GIT-044, GIT-054, GIT-055; this tree's own tasks/model.ts (taskQueries, presets), TasksPage.tsx, settings/useSettings.ts and scm.rs (gh_program, gh_run, scm_repo_labels) as the model for github.rs; GitHub's public search qualifiers (review-requested:, reviewed-by:, is:) and REST fields (repos/{owner}/{repo} fork + parent, /assignees) as documented under https://docs.github.com/; the stand-in gh, live.mjs and proof314.mjs are throwaway scripts written from scratch outside the repo; no old Kolux source opened.
> 2026-10-13 · T-560 · coordinator card T-560; this tree's own scripts/evidence/smoke.mjs and scripts/ship.test.mjs; Node.js fs docs (nodejs.org) for rmSync maxRetries / retryDelay and vitest docs (vitest.dev) for describe options timeout; no outside code.
> 2026-10-13 · T-561 · council MERGE 52 finding on resources.rs and PLAN card T-287-c's wording; this tree's own resources.rs, src/status/resources.ts and ResourceManager.tsx; figures read from the scratch dev app over CDP; no outside code.
> 2026-10-14 · sessions-FIX-1 · council d2 review of lane/sessions 4262cdd (Send to build session 1-5); this tree's own resources.rs (main's T-287-c side, read only), status/resources.ts, ResourceManager.tsx, sessions.rs and scripts/evidence/smoke.mjs; Win32 SetWindowPos flags from learn.microsoft.com; no outside code.
> 2026-10-14 · T-153-e · PLAN card T-153-e and spec VIEW-099, VIEW-116; this tree's own status/ResourceManager.tsx, resources.ts, inventory.rs session_tabs (read only), chrome/StatusBar.tsx and App.tsx (read only, for the hunk); no outside source.

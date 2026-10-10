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

Every area ended its firewall pass at 0 token-check hits.

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

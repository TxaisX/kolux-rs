# Firewall scrub report · 03 Terminals & panes

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/03-terminals-panes.json` (134 cards, generated 2026-10-06, file last written 16:41)
- Output: `spec/03-terminals-panes.md` (ids TERM-nnn, number taken from D-03-nnn)
- Method: the JSON (without its `evidence` column) was rendered to the card markdown format by a scratch script that applies a per-card override table (rewrites, compat restatements, added acceptance checks). The rendered draft was then run through the firewall script, a full six-word similarity hunt and a manual read against the forbidden list; every finding went back into the override table and the spec was re-rendered. No spec draft for this area existed before this pass.

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 25 | 25 |
| P1 | 62 | 62 |
| P2 | 33 | 33 |
| H | 8 | 8 |
| X | 1 | 1 |
| D | 5 | 5 |
| **Total** | **134** | **134** |

Structural check (scratch node script over the spec and the JSON): every D-03-nnn has exactly one TERM-nnn card and every Source line names its own D-03-nnn; tier, pushed and state match the JSON on all 134 cards; sort is tier, then pushed (null last), then id; field order is User does, User sees, Rules, Acceptance, Compat, (Decision), Source; Decision appears on the 8 H and 5 D cards only; every card has at least two acceptance items; no "n/a" acceptance remains. The `Tier counts` line and the D (5) and H (8) summary lists match.

Acceptance items added by this stage (not in cards-raw):
- 109 P0/P1/P2 cards had a single acceptance item; each got a second check derived from that card's own rules (for example TERM-012: previous from the first of three panes goes to the last).
- 14 H, D and X cards carried only "n/a"; each now has two checks on what the default build must and must not show (for example TERM-129: the Windows shell menu lists no WSL distributions).

## Leaks found and how each was fixed

| Category | Found | Where | Fix |
|---|---|---|---|
| Identifier (camelCase keybinding command ids) | 33 tokens in 19 Compat lines | TERM-006, 009, 012, 013, 014, 027, 030, 040, 041, 044, 047, 050, 051, 052, 059, 060, 065, 067, 085 | Each Compat line names the commands in plain words and says the exact ids are held back until allowlisted. Dotted ids without inner capitals stay as typed: tab.close, tab.rename, sessions.add, sessions.remove, terminal.paste, terminal.clear, terminal.search, zoom.in, zoom.out, zoom.reset. |
| Path / file name | 2 | TERM-093 acceptance quoted an example source path with a code extension; TERM-119 named the Windows command shell by its executable file name | Path described as "a printed relative path followed by a colon and 42"; shell called Command Prompt. All 134 cards' `evidence` references stay in cards-raw and are never rendered. |
| Identifier-shaped hyphenated compounds | 13 tokens | floating-workspace (TERM-059), focus-follows-mouse (TERM-018, 099), needs-you (TERM-021, 029, 030), new-tab (TERM-040, 041, 042), pinned-tab (TERM-044), quick-commands (TERM-038), remote-host (TERM-128), select-all (TERM-067), status-bar (TERM-122), non-git (TERM-022), old-version (TERM-108), half-typed (TERM-106), brand-new (TERM-005) | Hyphenated-token sweep: every lower-case hyphenated token in the draft (103) was searched in old `src` as a quoted string literal; these 13 matched and were rewritten as ordinary words (for example "attention tone", "new tab menu", "settings section for the floating panel"). Common English words that also occur quoted in old code (built-in, middle-click, right-click, multi-line, third-party) were kept; CLI flags were kept as typed. The 5 new hyphenated tokens introduced by this stage were swept the same way: 0 matches. |
| Old app's internal tracker ids | 1 (two ids) | TERM-070 rules cited two old work-item numbers written with this spec's own prefix, which would collide with TERM-008 and TERM-009 | Removed; the sentence now just says those two pastes are not shipped. |
| Implementation jargon | 6 | "mounted" / "mount" (TERM-112, 113, 134), "renderer" (TERM-117), the shell line-editing library named as such (TERM-079), a UI-library palette colour name (TERM-010) | Rewritten as "stays fully loaded", "load only the tabs", "when the pane first opens", "drawing and GPU events", "the shell's own Ctrl editing chords", "neutral grey tones". |
| UI copy over six words | 0 | — | Quoted or capitalised labels are all six words or fewer: Copy terminal diagnostics, Continue in new session, Fork Agent Session, Copy Context, Copy Session ID, Copy Terminal ID, Copy Pane ID, Set Title, Clear Pane Title, Close Pane, Clear Screen, Tab Color, Change Title, Pin Tab, Unpin Tab, Close to the right, Close to the left, Close others, Zoom In, Zoom Out, Reset Size, Equalize. No quotation marks remain in the spec. |
| Error text | 0 | — | Error and failure notices are described by meaning only. |
| Schema / stored keys | 0 | — | Saved history, layout and settings described as behaviour; no keys, no file formats of the old app. Compat file formats named are public third-party ones (Ghostty config and theme files, Warp theme YAML). |
| Library names (script list and manual scan) | 0 | — | Manual scan for terminal-emulator, UI-framework, store and IPC vocabulary found only public protocol or tool names (kitty keyboard protocol, OSC 8, OSC 52, tmux, Zellij, Neovim, Git Bash, WebGL). |
| Verbatim prose (comments, test titles, HANDOFF) | 37 six-word windows | See similarity hunt | Rewritten. |

Total non-similarity leaks fixed: 55 (33 identifiers + 1 path flagged by the script, 1 file name found by hand, 13 compounds, 1 tracker reference, 6 jargon terms).

## Similarity hunt

Scope: `src`, `tests`, `docs`, `README.md`, `HANDOFF.md`, `HANDOFF-HISTORY.md` of the old repo, i.e. the 22,024 files ripgrep searches by default. Old files were read only as `rg` output piped into a scratch script.

Method, stricter than the three-phrases-per-card sample: every six-word window of the spec, taken within clauses (split at hard punctuation), lower-cased with punctuation and hyphens folded to spaces, was compared against the old text normalised the same way, with each old file's lines joined so wrapped comments and multi-line strings are caught. Final run: 6,237 distinct windows checked.

1. First pass on the raw render: 34 matching windows across 16 cards, all rewritten:
   - TERM-004 preset count list; TERM-006 split shortcuts per platform (two rules); TERM-036 failed-copy wording; TERM-045 card title; TERM-055 badge priority order; TERM-058 live agent identity outranking a saved record; TERM-074 drop target rule; TERM-081 Option-as-Alt auto rule; TERM-090 scroll-position wording; TERM-103 single GPU failure rule; TERM-106 fresh shell wording (three sentences); TERM-114 glyph cache rule; TERM-124 dormant-window wording; TERM-125 CLI subcommand rules (three) and the flag list order in Compat; TERM-132 full-screen ownership rule; TERM-134 three size-sync clauses.
   - Sources of the matches: unit and e2e test titles (most), CLI help specs (TERM-125), HANDOFF entries (TERM-103, TERM-124), code comments and settings types (TERM-004, TERM-081).
2. Second pass: 3 windows in 2 acceptance checks written by this stage (TERM-079, TERM-118), rewritten.
3. Third and final pass after the jargon rewrites: 0 matches.

Similarity hits fixed: 37 windows (34 on the first render, 3 in checks added by this stage).

## Final script line

`firewall-check: 0 hit(s) across 1 file(s)`

## Allowlist candidates

Keybinding command ids (user-facing, typed into `~/.kolux/keybindings.json`) that the camelCase rule rejects. Suggested fix: allow dotted keybinding ids inside backticks with one regex, for example `re:^(terminal|terminals|tab|floatingTerminal|floatingWorkspace)\.[A-Za-z]+(\.[\w-]+)?$`, then restore them in the Compat lines.

terminal.splitRight, terminal.splitDown, terminal.closePane, terminal.expandPane, terminal.copySelection, terminal.equalizePaneSizes, terminal.focusNextPane, terminal.focusPreviousPane, terminal.setTitle, terminal.clearPaneTitle, terminal.selectAll, terminal.switchInputSource, terminals.focusNextNeedsYou, tab.newTerminal, tab.newBrowser, tab.newMarkdown, tab.openMarkdown, tab.newAgent, tab.newAgent.<agent id>, tab.closeAll, tab.reopenClosed, tab.previousRecent, tab.nextSameType, tab.previousSameType, tab.nextAllTypes, tab.previousAllTypes, tab.nextTerminal, tab.previousTerminal, tab.selectByIndex, floatingTerminal.toggle, floatingWorkspace.maximize, floatingWorkspace.minimize.

## Residual risks

1. Exact ids for 32 keybinding commands are held back (see above); until the allowlist decision, the clean room can rebuild the commands but not the old ids, which matters only for importing a user's existing keybindings file.
2. Numeric tuning values carried over as behaviour: narrow-header widths (about 344, 264, 204, 134 px), corner radius and gaps (14 px, 8 px), divider 3 px, fade 140 ms, wheel speeds 1.15 / 5 / 1, font size 14 and line height 1, 6 GPU contexts, 10 reopenable tabs, 30-minute hibernation, 12-pane cap. The reader notes these are tunable; the order and the limits are the behaviour.
3. Menu labels are kept in the old app's title case (all six words or fewer). They are what the user clicks, so allowed, but they mirror the old UI wording exactly.
4. The 123 acceptance checks authored here were derived from each card's rules without re-reading old code; a few assume a default implied by the card (for example the yen key typing a yen sign with the option off, Ctrl+D on a Greek layout).
5. The similarity hunt catches word-for-word runs of six or more words; a close paraphrase with changed words, or a run spanning a clause break, would not be caught.
6. TERM-125, TERM-126 and TERM-127 keep `kolux terminal` subcommands and flags as typed, including the flag value tui-idle; this is allowed CLI interface, and the flag list is ordered alphabetically rather than in the old help order.
7. Third-party product and protocol names stay (Ghostty, Warp, tmux, Zellij, Neovim, Git Bash, kitty keyboard protocol, OSC 8 and 52, YAML, PowerShell 7). They are public names of tools the user runs, not the old app's dependencies.

## Wave 2 patch (2026-10-06)

Input: three coverage-critic gaps for area 03. None was covered by an existing card, so all three became new cards (round 4) in `cards-raw/03-terminals-panes.json` and in `spec/03-terminals-panes.md`. Cards now 137 (P0 25 · P1 62 · P2 35 · H 8 · X 1 · D 6); `Tier counts`, the area intro and the D summary list updated.

| Gap (registry row) | Result | Placement |
|---|---|---|
| settings-keys `openLinksInAppPreferencePrompted` | Added D-03-135 / TERM-135 · First web link click asks where links open (P2, pushed —) | End of the P2 block, after TERM-133 |
| e2e `mobile-banner.spec.ts` (area 18 inventory #45) | Added D-03-136 / TERM-136 · Phone control of a desktop terminal (D, area 18 decision line) | After TERM-130; added to the D summary list |
| unmapped-triage `zsh wrapper dir written by mixed builds` | Added D-03-137 / TERM-137 · Shell hooks from different Kolux builds coexist (P2, pushed 9) | P2 block, after TERM-095 (pushed 9) and before TERM-036 (pushed 11) |

Amended cards: none. TERM-092 (web links) was checked for gap 1 and does not mention the first-click question, so the question got its own card rather than a rule line. TERM-130 (web client and paired runtimes) was checked for gap 2; phone control of a desktop pane is a separate area 18 item, so it got its own D card so the Dropped list names it.

Design note carried into the spec: the old first-link dialog sent the user to the browser settings section, which table 1b cuts. TERM-135 puts the link destination switch on the Terminal & sessions page beside the other link options; the owner may prefer another home.

Leaks:
- Firewall script on first render of the patch: 0 hits. No identifiers, paths or keys were written into the spec; evidence (source lines, test lines, registry keys) stays in cards-raw only.
- Six-word similarity hunt: all 405 six-word windows of the three new cards and the edited intro (split at clause punctuation) searched with `rg -i -F -f` over `src`, `tests`, `docs`, `README.md`, `HANDOFF.md`, `HANDOFF-HISTORY.md`, then again as regexes tolerant of hyphens, line breaks inside a window's spaces and curly apostrophes: 0 matches both times (a canary phrase from the old dialog copy matched, so the hunt was live).
- New hyphenated tokens (start-up, modifier-click) searched as quoted literals in old `src`: 0 matches.
- Leaks fixed: 0.

Final script line: `firewall-check: 0 hit(s) across 1 file(s)`

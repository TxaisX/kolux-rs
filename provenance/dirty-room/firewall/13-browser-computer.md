# Firewall scrub report · 13 Browser pane & computer use

Stage 3 (Firewall), 2026-10-06. Input: `cards-raw/13-browser-computer.json` (66 cards, all round 0;
critic round 1 changes are already folded into the cards, see its notes). Output:
`G:\Dev\kolux-rs\spec\13-browser-computer.md`, prefix BROW, number taken from D-13-nnn.

A spec file from an earlier firewall pass on this area (11:22, after the final JSON at 11:09) was
already on disk with no scrub report. This pass did not trust it: every card was checked against the
JSON by script (id ↔ Source, tier, pushed, state, all fields present, acceptance items ≥ 2 and ≥ the
JSON count, Decision only on H/D, sort order P0 → D then pushed then id), the whole file was read
for leaks the script cannot see, and the similarity hunt was run exhaustively. Fixes below.

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 7 | 7 |
| P1 | 35 | 35 |
| P2 | 11 | 11 |
| H | 0 | 0 |
| X | 0 | 0 |
| D | 13 | 13 |
| **Total** | **66** | **66** |

Structure check: 66 headings, 66 unique `Source: D-13-nnn`, no tier/pushed/state mismatch, no
missing field, order correct. Rule counts match the JSON except D-13-003, where two Kagi rules were
merged into one clause (content complete). D-13-053 (keep computer awake) is kept for count parity;
its Compat line says area 03 owns it (critic r1 duplicate note).

## Leaks found and how each was fixed

Counted against a naive render of the raw cards' prose fields (title, user_does, user_sees, rules,
acceptance, compat, decision) run through the firewall script (26 hits) plus a manual read.

| Category | Found | Where (raw card) | Fix |
|---|---|---|---|
| Identifier: settings keys (camelCase) | 5 | D-13-021 retention budget key; D-13-033 proxy address and bypass keys; D-13-053 two keep-awake keys | Described in words ("the old setting that switched it", "proxy address and bypass list", "an older on/off switch"); no stored names. |
| Identifier: keybinding ids with inner capitals | 6 | D-13-001 new browser tab, D-13-003 focus address bar, D-13-005 hard reload, D-13-018 previous recent tab, D-13-019 reopen closed tab, D-13-035 grab element | Written as "keyboard command for …, default …" with the id named an allowlist candidate. Dotted all-lowercase ids (browser.back, browser.forward, browser.reload, browser.find, zoom.in, zoom.out, zoom.reset, tab.close) kept: keybinding ids are an allowed interface. |
| Identifier: CLI flags in prose | 2 tokens, 4 hits | D-13-048 cookie flags with inner capitals | Kept only inside the typed `kolux cookie set …` syntax, where the check accepts them as command flags. |
| Identifier: brand casing | 1 | D-13-003 search engine name with inner capitals | Written as "Duck Duck Go"; candidate for the allowlist's everyday-words list. |
| File names | 2 | D-13-039 preview acceptance (an index page file), D-13-040 a stylesheet file | "an HTML document", "a stylesheet from elsewhere in the workspace". |
| Schema / stored values | 1 | D-13-003 compat: the lowercase stored values of the four search engines | Display names only (Google, Duck Duck Go, Bing, Kagi). |
| Library name | 1 | D-13-022 acceptance query naming a UI library | Query changed to "docs rust". |
| Verbatim prose (old repo) | 16 phrase hits in the raw cards; 8 still in the earlier spec | see Similarity hunt | All rewritten; final hunt 0. |
| Paths / identifiers in evidence | 562 `evidence` references | every card | Evidence is not rendered; it stays in cards-raw. Not counted as leaks. |
| UI copy over six words | 0 | — | Labels the user clicks kept, all ≤ 5 words and unquoted: New Tab, Stop, Reload, Retry, Open Externally, Import Cookies, From File…, New Profile…, Viewport Size, Default, Grab page element, Copy Screenshot, Attach to AI, Annotate page element, Draw on screenshot, Open Link In Kolux Browser, Open Link In Default Browser, Copy Link Address, Open Page In Default Browser, Browser Settings…. A sign-in button label in D-13-015 acceptance was replaced by "start a sign-in with GitHub". |
| Error text | 0 | — | Failure notices described ("invalid-address notice", "a gone notice"), never quoted. |
| False positives reworded | 9 | the word "import" followed by a noun tripped the code-keyword rule | Phrasing uses "bring cookies over", "imports cookies", "Import Cookies". Not counted as leaks. |

Distinct leaks fixed: 18 (5 + 6 + 2 + 1 + 2 + 1 + 1). Manual sweep of the final file for implementation
words (webview, guest, renderer, preload, partition, IPC, devtools protocol, the automation helper's
name, websocket, store, process names, platform automation tools) found none.

## Firewall script

First run on the inherited file: `firewall-check: 0 hit(s) across 1 file(s)`.
Final run after this pass's rewrites: `firewall-check: 0 hit(s) across 1 file(s)`.

## Similarity hunt

Method: exhaustive instead of three phrases per card. Every 6-word window of the spec's prose
(headings, user does/sees, rules, acceptance, compat, decision, summary lists; backtick `kolux`
syntax excluded as interface), in two forms: words only (punctuation stripped) and as written
(punctuation kept). Searched with `rg -iF -o -f <list>` over the old repo's src, tests, docs,
README.md, HANDOFF.md and HANDOFF-HISTORY.md.

| Run | Phrases | Hits |
|---|---|---|
| Raw cards (reference) | 8,604 | 16 |
| Inherited spec | 9,747 | 8 phrases in 6 sentences |
| Final spec | 9,762 | 0 |

Hits in the inherited spec and the rewrite (card · old source kind · fix):

| Card | Matched phrase source | Rewritten as |
|---|---|---|
| BROW-051 | research close-out note | "the endpoint's self-description is likewise hidden behind that secret path" |
| BROW-021 (3 phrases) | retention module comment and a test title | "pages under agent control and pages with a download in progress are spared" |
| BROW-047 | CLI usage summary (property list) | prose "returns one property … (its text, markup, value, address, title, match count or bounding box)"; the typed values moved into the backticked `kolux get --what …` syntax; same for `kolux is` |
| BROW-019 | e2e test comment | "Close the last remaining tab of a worktree" |
| BROW-013 | unrelated code comment | "two downloads that start together under one name each end up with a distinct name" |
| BROW-057 | unrelated test title | "a worktree that lived on an SSH machine, inside WSL or on a remote runtime" |

Precautionary rewrites of 5-word near-copies found by the raw-card hunt: BROW-039 copy-path rule
("in the form the host system uses") and BROW-005 retry rule ("during an automatic retry of a
failed page"). Not counted as hits.

## Allowlist candidates

Keybinding command ids the user can see and rebind in the keybindings file, written around for now:
`tab.newBrowser`, `browser.focusAddressBar`, `browser.hardReload`, `browser.grabElement`,
`tab.reopenClosed`, `tab.previousRecent`. Everyday brand word: `DuckDuckGo`.

## Residual risks

- Device preset names and sizes (Mobile S 320×568, Mobile M 375×667, Mobile L 425×812, Tablet,
  Laptop, Laptop L) are carried as data; they are user-visible menu labels, treated as interface.
- Cookie-import sources list Chromium alongside Chrome, Edge, Brave, Helium, Firefox, Comet, Arc and
  Safari; it is a browser name the user picks, not a dependency.
- BROW-028 Compat describes the accepted cookie file in words (name, value, domain, optional path,
  secure, HTTP-only, same-site, expiry). It is an input the user supplies; exact field spelling is
  left to the clean room ("to confirm").
- The CLI Compat lines reproduce the old `kolux` usage syntax (allowed interface). The `kolux exec`
  pass-through and the element-command set follow a third-party automation helper the old app
  wrapped; the spec names no helper and flags the choice as an owner decision.
- BROW-062 Compat lists the dropped `kolux computer` subcommand words; they are command words, D tier.
- The hunt is substring-based per line: text wrapped differently in the old sources, or a close
  paraphrase under six words, is not detected.
- Notes in the JSON (proxy and search-engine settings lose their only screen; helper dependency;
  terminal link routing assumed carded by 03) surface in the spec only as owner-decision Compat lines.

## Wave 2 patch (2026-10-06)

Coverage gaps from the tags registry (`v0.4.0|workspace preview pane`, `v0.4.1|Preview button enables on Windows`).
No existing card covered the dev-server Preview button (BROW-039 and BROW-041 are HTML document
previews, VIEW-078 in area 05 is the ports list), so one new card takes both rows.

| Card | Change | Source rows |
|---|---|---|
| BROW-067 (D-13-067, round 4) | Added, tier P1, state live-unverified: Preview button in the focused split's toolbar opens the workspace's dev server as a browser tab, reuses an existing tab for the same origin, arrow menu for further candidates, greyed out when none; Windows attribution through the address a terminal printed folded in as a rule | tags v0.4.0, tags v0.4.1 |

Cards amended: none. Tier counts line updated to P1 36; one intro sentence added.

Leaks found and fixed:

- Similarity hunt (16 phrases from BROW-067 over src, tests, docs, README, HANDOFF, HANDOFF-HISTORY):
  one hit, a five-word run matching a code comment in the preview-candidate ranking file; the
  ranking rule was rewritten in both the spec and the JSON, and the new wording rechecked at 0 hits.
- UI copy kept to the one-word button label Preview; the tooltip, tab-title pattern, error toast and
  test titles are described, not quoted.

Firewall script on `spec/13-browser-computer.md` after the patch: 0 hit(s) across 1 file(s).

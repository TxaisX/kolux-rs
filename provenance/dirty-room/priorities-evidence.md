# PRIORITIES.md evidence (dirty room, never read by the clean room)

Written 2026-10-06 by the PRIORITIES drafter. One line per claim in `G:\Dev\kolux-rs\PRIORITIES.md`,
keyed by section and item. Abbreviations:
- HO = `G:\Dev\Kolux\kolux\HANDOFF.md` (last updated 2026-10-05/06)
- HH = `G:\Dev\Kolux\kolux\HANDOFF-HISTORY.md`
- REC = `G:\Dev\kolux-rs\provenance\dirty-room\dumps\records\`
- DR = `G:\Dev\kolux-rs\provenance\dirty-room\`
- VB = `G:\Dev\Projects\Txais Brain\03 - Wiki\Syntheses\Kolux Improvements from BridgeMind.md`
- VK = `G:\Dev\Projects\Txais Brain\06 - Projects\Kolux\Kolux.md`
- VL = `G:\Dev\Projects\Txais Brain\06 - Projects\Kolux\Build Log.md`
- LOG = `git -C G:\Dev\Kolux\kolux log --format="%h %ad %s" --date=short` (360 commits, REC\_summary.json); NM = the same with `--no-merges` (266 commits, 17 distinct dates).

## Method lines
- Theme commit counts = `grep -ciE '<pattern>'` over NM subjects; days = distinct dates of matches. Patterns (word-boundary, case-insensitive), run 2026-10-06:
  - T1 `\b(terminals?|panes?|grid|tabs?|scrollback|splits?)\b` → 80 commits, 17 days (2026-09-10..10-06)
  - T2 `\b(worktrees?|isolation|isolated)\b` → 16, 8
  - T3 `\b(status|hooks?|notifications?|inbox|stopped|quiet|plan review|review the plan|glow|attention|needs you)\b` → 26, 9
  - T4 `\b(accounts?|sign-in|signin|usage|limits?|forecast|auto-resume|context cap|200k)\b` → 30, 6
  - T5 `\b(protected|security|redact(or|ion)?|audit|trust|key vault|encrypt(ed)?)\b` → 19, 6
  - T6 `\b(starter kits?|kits?|onboarding|business|first run|first-run|jargon|connect cards?|plain-language|newcomer)\b` → 35, 5 (first 2026-09-28)
  - T7 `\b(redesign|design|new look|look|board|views?|themes?|colour|rounded|top bar|pane header|screen [0-9]+)\b` → 40, 9; per day 09-14:1, 09-23:2, 09-24:1, 09-28:2, 09-29:1, 09-30:6, 10-04:5, 10-05:21, 10-06:1 (10-04+10-05 = 26)
  - T8 `\b(release[sd]?|updates?|updater|ci|ship|smoke)\b` → 38, 12
  - T9 `\b(restore|daemon|reliab(le|ility)|lost|persist(ed|ence)?|durab(le|ility)|recover(y)?)\b` → 10, 6
  - T10 `\b(rename[ds]?|nightshift|originality|scrub(bed)?|license|upstream|branding)\b` → 12, 5
  - T11 `\b(orchestrat(ion|or)|automations?|runs view|workers?|routing|dispatch)\b` → 9, 3
  - Superseded substring counts (inflated, REC\_summary.json note): DR\commits-by-theme.csv rows 2–12 = 86, 18, 30, 37, 20, 24, 55, 56, 10, 73, 35.
- P0 per theme: `grep -h "^Tier: P0" G:\Dev\kolux-rs\spec\*.md` grouped by Pushed → 1:19, 2:21, 3:42, 4:22, 5:21, 6:4, 7:24, 8:7, 9:20, 10:0, 11:31, none:16; total 227, themed 211. All cards 1,255.
- States: same files grouped by "State at 0.15.0" → live 122, live-unverified 899, half-done 5, hidden 57, retired 44, dev-only 9, dropped 119.
- X cards: theme 10: 11, none: 1.
- Area churn: DR\churn.csv line 5 `03-terminals-panes,90,...`; line 19 `17-settings-appearance,91,...` (the two busiest areas).

## §0
- "Ranks never change tiers" / theme 7 builds fifth: own ranking decision; tier rule in DR\briefs\00-shared.md:93 assigns P0 by theme ids 1–5, so theme 5 cards stay P0 and theme 7 P0 cards are P0 via 09-22+ handoff entries (00-shared.md:93).
- Agrees with LOOP.md §2: `G:\Dev\kolux-rs\LOOP.md:102-115`.

## §1 Rank 1 · Theme 1
- 17 of 17 commit days: T1 method line.
- ~90 commits in area 03, area 17 has 91: DR\churn.csv lines 5, 19.
- Call 2026-09-16 every new session own pane: HH:768-772 ("Owner's call", commits 8a19ef2a, d1d386e6).
- Call 2026-09-17 one session per pane, sessions back in sidebar: HH:668-670 ("on the owner's call"); LOG 26dfb46ca 2026-09-17.
- Call 2026-10-05 pane footer removed entirely: HH:41-45 (Txais chose full removal); LOG 28991c4b0.
- One-window-per-terminal reverted same day: HH:747-750 (superseded by 0.7.0, 2026-09-15); HH:717-722; tags v0.6.0 and v0.7.0 both 2026-09-15 (REC\tags.csv).
- Three straight releases: REC\tags.csv v0.6.0 (d4d9b9743), v0.7.0 (96f3018c6), v0.8.0 (9822695b1, 2026-09-16).
- Four 10-05 entries: HO:18 (resource wave, hidden tabs under graphics cap), HO:19 (headers always show title + usage), HO:21 (footer removed), HO:23 (message bar removed).
- At 0.15.0: rounded panes, controls, expand/restore HO:20 + HH:29-38; headers HO:19 + HH:23-27; no footer/message bar HO:21, HO:23; layout presets HO:112-120 (Known gaps); hidden tabs graphics cap HO:18 + LOG b7cc17785.

## §1 Rank 2 · Theme 2
- One-sentence promise: HO:51-53 ("each in its own git worktree").
- Decision 2026-09-24 default for 2+ seats: VB:27.
- First item of 0.12.0 headline: REC\tag-messages.md:51-54; LOG 070c3e368 2026-09-28; VK:90.
- 16 commits: T2 method line.
- 09-22 entry is build workflow: HO:45 ("one worktree per agent, pnpm ship does the git work"); HH:585-589.
- At 0.15.0 shapes Solo/Pair/Workbench/Swarm, roles, saved shapes: DR\briefs\00-shared.md:66 (area 02 scope); LOG d9f8f5bdf 2026-09-29 (saved named shapes, launch memory); Review changes: tag message REC\tag-messages.md:54.

## §1 Rank 3 · Theme 3
- 42 P0 cards: P0 method line.
- 0.11.0 plan review: LOG 4b76b9dce 2026-09-24; HH:389-445; HO:38.
- 0.12.0 Stopped state, quiet-agent alerts, sign-in expiry notices: REC\tag-messages.md:54.
- 10-05 pane header glow: HO:28; HH:168-191.
- At 0.15.0 hook states and Inbox: DR\briefs\00-shared.md:68 (area 04 scope).

## §1 Rank 4 · Theme 4
- 0.9.0 headline browser sign-in: LOG 2048806e3 2026-09-21; HH:657-664.
- Call 2026-09-28 self-refresh default with opt-out: HH:367-372; HO:35; LOG f63658609 2026-09-28.
- 0.14.0 headline: LOG b5e2d4bef 2026-10-05.
- Three 10-05 entries: HO:29 (usage meter), HO:31 (auto-resume), HO:32 (200k cap).
- Weekly pill: HO:20; HH:29-38. Connect cards: LOG 6acbb9f36 (0.13.0).

## §1 Rank 5 · Theme 7
- 40 commits, 26 on 10-04/10-05: T7 method line.
- Six of fifteen 10-05 entries: HO:18-32 are the 15 entries dated 2026-10-05; theme 7 ones HO:19, HO:20, HO:24, HO:26, HO:27, HO:28.
- 0.14.0 headline (new look, colour themes, pane header): LOG b5e2d4bef.
- Design canvas created 2026-09-29, Txais's chosen boards: REC\design-source.md:4, :8-15, :18 ("Chosen: Board (B) + Terminals (C)").
- Workspace views 09-29/09-30: LOG 59e7908a6 (09-29), 6b4f0eb05, a9c0cbe67, de420e71b, 989ecb30a, a24218187 (09-30).
- Five new-look screens 10-04: LOG 37ddfe741, ee4750508, ab025f083, db85dc8fe, 5a23c1ac8.
- Redesign landed 10-05: HH:85-94; HO:24.
- Existing profiles opt in: HH:93 ("existing profiles must pick Settings › Views & sessions").
- 16 themes Classic default: HO:27; HH:139-166. No flash: HO:26; HH:119-137.

## §1 Rank 6 · Theme 5
- 19 commits: T5 method line.
- 0.13.0 headline ends with sign-ins encrypted at rest: LOG 6acbb9f36 2026-09-28.
- Protected actions from his improvement list 2026-09-29: HO:33 (PROD-7); HH:262-295; LOG dc0eef205; REC\improvement-cards.md (PROD-7 shipped marker).
- Audit 2026-10-04 and fix wave 2026-10-06: HH:6-13 (scope = audit-2026-10-04 doc); HO:17.
- At 0.15.0 network-share refusal, masking, bypasses closed: HH:9; LOG a3987cf13, 442550557 (10-06), 924a95d9e (10-05).

## §1 Rank 7 · Theme 9
- 10 commits: T9 method line.
- Packaged restore check run twice 2026-09-29: HH:297-365 (build 0.13.0, a48603ed7; cold restore fix a3831fbe9; LOG a58b30500).
- Dictation never lost in 0.12.0 headline: REC\tag-messages.md:54.
- Measured rebuild target: G:\Dev\kolux-rs\LOOP.md:125.
- File durability 10-05: LOG 929c4db92.
- Conversation resume not checked: HH:297-365 (agent-conversation resume not run).

## §1 Rank 8 · Theme 11
- 31 P0, 9 commits over 3 days: P0 and T11 method lines.
- His skills call the CLI: DR\briefs\00-shared.md:84 (skills kolux-cli, kolux-run, orchestration depend on it).
- 0.11.0 headline: LOG 4b76b9dce.
- Routing tiers 09-22: HO:44; HH:575-583; LOG 5644bb462 (dated 09-23 in log).
- Event automations, Runs view 09-23: HO:41; HH:540-556; HH:497-499; LOG 23250567c.
- Read-only Runs view: HO:121-125.

## §1 Rank 9 · Theme 8
- 38 commits over 12 days: T8 method line. 14 tags: REC\tags.csv.
- 7 P0: P0 method line.
- Loop never publishes: G:\Dev\kolux-rs\LOOP.md:141-142.
- v0.1.0, v0.2.0 2026-09-14: REC\tags.csv rows 2, 6. v0.9.0: LOG 2048806e3.
- CI green 2026-09-24: HO:37; HH:379-387 (red since 09-11, ~50 min vs 30 min timeout).
- Release gate 2026-09-29: LOG 1181eb69f.
- Automatic public releases 2026-10-06, 0.15.1 and 0.15.2: HO:17; HH:10; REC\releases.txt lines 2-3.
- 30-minute checks since 10-06, 15 before: HH:10 ("App checks every 30 min"), HH:13; 15-minute: LOG 2048806e3.
- Unsigned, Windows only: HO:93-96.

## §1 Rank 10 · Theme 6
- 35 commits on 5 days from 09-28: T6 method line; day split NM 09-28:14, 09-29:15, 09-30:3, 10-04:2, 10-05:3 (looser pattern, 37 hits).
- Owner decisions 2026-09-28: REC\business-frame.md:6 (MAP "Owner decisions (2026-09-28)"); modules :78-85.
- 0.13.0 never published: REC\releases.txt (no 0.13.0 in either repo); VL:26 ("0.13.0 to 0.15.0 not yet released").
- 4 P0: P0 method line.
- Purpose 2026-09-29 own tool and portfolio piece: VK:36-38.
- Newcomer checklist half-done: spec ONB-013 (cards-raw 16-onboarding.json D-16-013).

## §1 Rank 11 · Theme 10
- 0 P0 cards, 11 X cards: P0 and X method lines.
- Rename 2026-09-21/22: LOG 9baa8d307 (09-21), 7f3326473 (0.10.0, 09-22); HH:591-656; VK:88.
- Scrub 2026-10-05: HO:22; HH:47-77; DR\churn-excluded.csv (0ca8bbf45, e8ecaa97d).
- Cloud-only features removed: HH:47-77.

## §2 Timeline rows
- 09-10–09-11 held at 0.0.0, handoff doc, lint: LOG 21231c88b (base import 09-10), 22c5243b7, 40c79a7a1, 2849056b9.
- v0.1.0 09-14 releases from tags: REC\tags.csv row 2; REC\releases.txt (published 2026-09-14T16:35Z).
- v0.2.0/v0.2.1: LOG 739f604bf, 6df367477; tags.csv rows 6-7.
- v0.3.0 three-mode shell: LOG b0272c6d5; REC\tag-messages.md:16.
- v0.4.0/v0.4.1: LOG 1764379a4, f38b9e88c; REC\tag-messages.md:24, :32.
- v0.5.0 composer, dropped next day: LOG 2362b9462; HH:704-708 (dropped 2026-09-16).
- v0.6.0, reverted same day: LOG d4d9b9743; HH:747-750.
- v0.7.0: LOG 96f3018c6; HH:717-722.
- 0.7.1 untagged: LOG 12a25f527 (no tag in REC\tags.csv).
- v0.8.0: LOG 9822695b1; HH:768-772, HH:790-793 (owner's calls).
- 09-17 untagged: HH:668-670; LOG 26dfb46ca.
- v0.9.0: LOG 2048806e3; release published 2026-09-21T14:05Z (REC\releases.txt).
- v0.10.0: LOG 7f3326473; HH:591-656.
- v0.11.0 incl. OpenCode removal, CI green, quieter sidebar (HO:43, LOG 72cc77940), graphics fallback (HO:42, LOG 3cfa5c430), routing (HO:44, LOG 5644bb462; providers never mix HH:575-583); all three first contained in v0.11.0 per `git tag --contains`: LOG 4b76b9dce; REC\tag-messages.md:3-9; HO:36-39; HH:447-455 (owner's call: frontier-lab agents).
- 09-24 decisions: VB:27-29.
- v0.12.0: LOG 070c3e368; REC\tag-messages.md:51-54; VB:31.
- 0.13.0 untagged, never published: LOG 6acbb9f36; REC\releases.txt.
- 09-29–09-30: LOG dc0eef205 (protected actions), a58b30500 + a3831fbe9 (restore check), 1181eb69f (release gate), 59e7908a6 / 6b4f0eb05 / a9c0cbe67 / de420e71b / 989ecb30a / a24218187 (workspace views); REC\design-source.md:4 (canvas 2026-09-29).
- 10-04: LOG 37ddfe741, ee4750508, ab025f083, db85dc8fe, 5a23c1ac8; audit HH:8 (audit-2026-10-04 doc).
- 0.14.0 untagged: LOG b5e2d4bef.
- 0.15.0 untagged: LOG da055d166 (version bump 10-05); HO:18-32; resource wave HH:15-21; owner cuts DR\briefs\00-shared.md:116-137 (2026-10-05).
- 10-06 0.15.1/0.15.2: REC\releases.txt lines 2-3; HO:16-17; HH:6-13; LOG 3674def6a (artifacts), 442550557, a3987cf13, 8fdc22e02, c697f1065 (Thought rows).
- Count: 14 tags (REC\tags.csv, 14 rows; all 14 published in old repo per REC\releases.txt), 2 public releases, 4 untagged bumps, 5 versionless rows = 22 rows.

## §3 header
- 122 live / 899 live-unverified / 5 half-done: states method line.

## §3a Verified in the running app
- V1 09-16 own pane: HH:768-789 (verified at runtime 09-16).
- V2 09-16 add project picked folder only: HH:790-800 (verified at runtime).
- V3 09-22 quieter sidebar: HH:568-573 (HH:572 "Verified in the dev app ... CDP DOM checks").
- V4 09-22 routing tiers: HH:575-583 (HH:581 dev app over CDP; live worker-start not driven).
- V5 09-23 plan review, injected status: HH:389-445.
- V6 09-23 event automations editor: HH:540-556 (HH:555 dev app isolated profile).
- V7 09-23 launcher refresh, layout presets, Runs view: HH:466, HH:491, HH:499 (runtime-verified 2026-09-23); HO:112-125.
- V8 09-29 packaged restore, cold-restore fix, re-run PASS: HH:297-365 (HH:305 build 0.13.0 commit a48603ed7, dist exe); fix a3831fbe9.
- V9 10-05 auto-resume live Claude pane: HH:221-243 (live dev-app Claude 2.1.289 pane).
- V10 10-05 usage meter real data: HH:193-210 (real POST in dev app).
- V11 10-05 pane header: HH:168-191 (dev app CDP).
- V12 10-05 colour themes: HH:139-166 (dev app CDP).
- V13 10-05 no flash: HH:119-137 (dev app CDP).
- V14 10-05 new look top bar, Agents/Board no classic sidebar: HH:94 (dev app screenshots).
- V15 10-05 rounded windows etc., resize drag unverified: HH:29-38.
- V16 10-05 headers always on, stepper/status-bar usage gone: HH:23-27 (dev app CDP).

## §3b Shipped but unverified
- U1 09-21 browser sign-in in installed build: HH:657-664; HH:526; HO:143-144.
- U2 09-22 graphics fallback, tests only: HH:558-566; LOG 3cfa5c430.
- U3 09-24 packaged smoke = CLI --version/--help + profile migration, UI never booted: HH:530-538.
- U4 09-28 0.12.0 set: REC\tag-messages.md:54; no HH entry verifies these (grep "0.12.0" in HH returns no verification entry); VB:31 confirms shipped by tag message only.
- U5 09-28 0.13.0 frame: LOG 6acbb9f36; no HH verification entry (grep for starter kit / Connect card / key vault / guided first in HH: only line 173, a branch title).
- U6 09-29 protected actions not verified live: HH:293 (entry HH:262-295).
- U7 10-05 200k cap: HH:245-260 (mechanism and gaps, no runtime check recorded).
- U8 10-05 weekly pill real data not verified: HH:29-38.
- U9 10-05 hidden tabs graphics cap, memory: HH:15-21; HO:18.
- U10 10-06 audit fixes: HH:9-11 (tests + lint, no runtime line).
- U11 10-06 public release on every ship, 30-min checks, restart prompt; installed update not recorded: HH:10; REC\releases.txt lines 2-3.
- U12 10-06 artifacts library: HH:12; LOG 3674def6a.
- U13 10-06 Thought rows + card-style agents (the two open redesign items HH:93): LOG c697f1065.

## §3c Known gaps
- G1 no Kolux account sign-out: HH:109 (entry HH:96-117).
- G2 usage meter local, Codex/Grok plan only: HH:207-208 (entry HH:193-210).
- G3 auto-resume Claude only: HH:221-243.
- G4 cap skips native chat, WSL revive path, Grok: HH:255 (skips Grok), HH:259-260.
- G5 protected actions not Codex: HH:291.
- G6 conversation resume after restore not run: HH:315, HH:364-365.
- G7 existing profiles opt in: HH:93.
- G8 two tests fail on main too: HH:9 ("Gates" line: managed-hook-stdin-lifecycle, kolux-runtime).
- G9 unsigned; Mac/Linux not released: HO:93-96.
- G10 agent dashboard off, shortcut silent: HO:126-130 (Known gaps, agent dashboard bullet).
- G11 orchestration split, read-only view: HO:121-125.
- G12 layout presets not exercised with scrollback / WebGL / menu click: HO:112-120.
- G13 suite noisy on Windows, rely on Linux CI: HO:134-137.

## §3d Half-done
- H1 VIEW-118: G:\Dev\kolux-rs\spec\05-views-navigation.md; DR\cards-raw\05-views-navigation.json D-05-118 (code pointers only).
- H2 ACCT-032: spec\07-accounts-keys.md; cards-raw D-07-032 (code pointers only).
- H3 GIT-057: spec\11-git-review.md; cards-raw D-11-057 (code + two test files).
- H4 ONB-013: spec\16-onboarding.md; cards-raw D-16-013 (code + tests).
- H5 APP-061: spec\19-app-lifecycle.md; cards-raw D-19-061; LOG 1181eb69f (09-29 gate); HO:141-142 (smoke script could only be reviewed, not executed).

## §3e Retired, hidden, removed
- One window per terminal 09-15: HH:747-758. Composer launcher 09-16: HH:704-715.
- Sidebar rows + mode switch 09-22: HH:568-573; LOG 72cc77940.
- OpenCode 09-23: HH:447-455; LOG 7fd3282d7; churn-excluded a4ea33c71.
- Cloud features hidden 09-28 (VB:28, decided 09-24; tag message REC\tag-messages.md:54), removed 10-05 (HH:47-77). Mobile app links 09-29: DR\briefs\00-shared.md:85.
- Pop-out and Agent Map 10-05: HH:212-219; HO:30.
- Voice/dictation, Kolux Account, Input settings 10-05: HH:96-117 (dev app CDP); HO:25.
- Footer and message bar 10-05 tests only: HH:41-45, HH:79-83; stepper + status-bar usage: HH:23-27 (dev app CDP).
- Update nudge, scrub 10-05: HH:47-77 (hidden dev app).
- Flags off / dev-only: DR\briefs\00-shared.md:145.
- Owner cuts 10-05: DR\briefs\00-shared.md:116-137.

## §4 Build-order rules
- Rules 1–8: LOOP.md:104-113.
- Rule 9: own rule; consistent with 00-shared.md:93 tier rule.
- Rule 10: own rule; key vault encrypted at rest is 0.13.0 behaviour (LOG 6acbb9f36), accounts are theme 4.
- Rule 11: own rule; HH:93 shows the old app kept two looks and made existing profiles opt in.
- Rule 12: own rule; LOOP.md:149-150 lets the loop pick sensible defaults and record them.

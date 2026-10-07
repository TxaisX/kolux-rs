# PRIORITIES refutation 1 · effort lens

Refuter 1 of 2, written 2026-10-06. Lens: effort (commit counts, churn per week, dates and sizes of
changes, test and app records). Every theme rank, every timeline row and every status-list item
in PRIORITIES has a row below. Verdicts: STANDS, WEAKENED (softer wording given) or REFUTED
(correction and dated evidence given). Where my evidence was not stronger than the draft's, the
row says STANDS.

How the effort figures were made: the draft's own eleven word patterns, re-run over the old
repository's commit subjects at its 2026-10-06 head. That head has 252 non-merge commits and 360
commits in all (108 merges) over 17 commit days. Line counts come from the dirty room's churn
tables (per area and per ISO week: W37 09-07..09-13, W38 09-14..09-20, W39 09-21..09-27, W40
09-28..10-04, W41 10-05..10-11).

## Recount used below

| Theme | Draft commits / days | Non-merge recount | All commits incl. merges |
|---|---|---|---|
| 1 | 80 / 17 | 76 / 16 | 85 / 17 |
| 2 | 16 / 8 | 16 / 8 | 20 / 9 |
| 3 | 26 / 9 | 25 / 9 | 29 / 9 |
| 4 | 30 / 6 | 26 / 6 | 35 / 7 |
| 5 | 19 / 6 | 16 / 6 | 22 / 6 |
| 6 | 35 / 5 | 32 / 4 | 38 / 5 |
| 7 | 40 / 9 | 34 / 9 | 48 / 9 |
| 8 | 38 / 12 | 34 / 12 | 42 / 12 |
| 9 | 10 / 6 | 9 / 5 | 10 / 6 |
| 10 | 12 / 5 | 11 / 5 | 12 / 5 |
| 11 | 9 / 3 | 5 / 2 | 10 / 3 |

The draft's figures match neither set. The order of effort barely moves (themes 7 and 8 tie at
34), so no rank changes on the counts alone.

## Section 0 and section 1 header

| # | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| S1 | 266 non-merge commits over 17 commit days, 09-10 to 10-06 | REFUTED | Old repo git log at its 10-06 head: 252 non-merge commits, 360 in all; 17 distinct commit days confirmed (09-10 to 10-06) | "252 non-merge commits over 17 commit days" |
| S2 | 227 P0 cards (211 themed, 16 without) | WEAKENED | Spec recount 2026-10-06: four spec files were saved after PRIORITIES was saved (same minute, 17:30). Recount gives 228 P0 cards (212 themed, 16 without) and 1,263 cards (the evidence record says 1,255); theme 1 now has 20 P0 cards, not 19 | Recount P0 per theme when the spec freezes; theme 1 is 20 today |
| S3 | Rank table, Commits / days column | WEAKENED | Recount table above (old repo git log, 10-06) | Replace with the non-merge recount and say merges are excluded |
| S4 | Rank-move sentence (themes 7 and 9 up two, 11 up three; 5, 8, 10 down one; 6 down four) | STANDS | Arithmetic matches the rank table | none |

## Section 1 · themes

| # | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| R1 | Theme 1 ranks first | STANDS | Widest spread (16 days non-merge; next is theme 8 at 12); terminals area is the largest by changed lines (90 commits, about 22k lines); three headlines in a row (tags 09-15, 09-15, 09-16) | none |
| R1a | Only theme touched on every one of the 17 commit days | WEAKENED | Non-merge recount: 16 of 17 days, with no match on 09-23. It reaches 17 only when merge commits are counted (old repo git log, 10-06) | "Touched on 16 of 17 commit days, more than any other theme" |
| R1b | One of the two busiest areas, about 90 commits each | STANDS | Area churn: terminals 90 commits, settings 91 | none |
| R1c | His calls: own pane (09-16), one session per pane with sidebar list (09-17), strip under panes removed (10-05) | STANDS | Handoff history entries 09-16 and 09-17; 10-05 entry records his choice of full footer removal | none |
| R1d | Led 0.6.0, 0.7.0, 0.8.0; one window per terminal reverted the same day | STANDS | Tags 09-15, 09-15, 09-16; 0.7.0 brought panes back on 09-15 | none |
| R1e | At 0.15.0 list | STANDS | Matches V15, V16 and U9 | none |
| R2 | Theme 2 ranks second | STANDS | Owner decision 09-24 (vault improvement page); first item of the 0.12.0 version commit (09-28) | none |
| R2a | The product's one-sentence promise in the old description | STANDS | Description present since the import (09-11). Note that it was inherited text, and the launcher defaulted to shared seats from 0.7.0 (09-15) until 0.12.0 (09-28) | none (see R2c) |
| R2b | Decided as default 09-24; first item of 0.12.0 | STANDS | Vault improvement page, decision dated 09-24; 0.12.0 version commit 09-28 | none |
| R2c | Effort is modest (16 commits) because the plumbing was inherited | WEAKENED | Only 16 subjects match, but the sessions-and-launching area had 23 commits and about 10.8k changed lines in W40 alone. The 09-28 shapes-and-roles commit changed about 1.3k lines, and the 09-29 launch-memory and saved-shapes commit about 1.7k. Before 09-28 the launcher defaulted to shared seats (0.7.0, 09-15; a 09-16 commit launched agents as panes rather than new worktrees) | "Few commits name it, but making it the default was a large launcher rework on 09-28 and 09-29; before that, agents shared one checkout by default" |
| R3 | Theme 3 ranks third | STANDS | 42 P0 cards (recount 42); 25 matches over 9 days; plan review led 0.11.0 (09-24); Stopped state, quiet alerts and expiry notices in 0.12.0 (09-28) | none |
| R3a | Evidence and At 0.15.0 lines | STANDS | Handoff history 09-23 (plan review) and 10-05 (pane header); V5, V11 | none |
| R4 | Theme 4 ranks fourth | STANDS | Led 0.9.0 (09-21 version commit, first item browser sign-in) and 0.14.0 (10-05 version commit, first three items) | none |
| R4a | Led two headlines (0.9.0; 0.14.0) | STANDS | Same as R4 | none |
| R4b | A recorded call: on 09-28 Txais kept self-refreshing Claude sign-in as the default, with an opt-out | REFUTED | The handoff history entry of 09-28 (sign-in opt-out) states the default as a decision of the session that built it and names no owner. The vault improvement page (dated 09-24) still lists the sign-in approach under decisions only Txais can make, with no answer. The first-cut plan (10-06) lists it as an open decision | "On 09-28 the build kept self-refreshing sign-in as the default and added an opt-out; whether Kolux should do this at all is still a call for Txais." No rank change: the rank rests on the two headlines |
| R4c | Evidence and At 0.15.0 lines | STANDS | V9, V10, U7, U8; 10-05 handoff entries | none |
| R5 | Theme 7 ranks fifth (moved up from 7) | STANDS | 34 matches (tied for second); his screen picks on the design canvas; rank holds on effort and his picks even after R5a, R5b and R5d | none |
| R5a | The most concentrated push of the whole project | WEAKENED | Theme 6 is at least as concentrated: 31 of its 32 non-merge matches fall on 09-28 to 09-30 (14, 14, 2), against 21 of 34 for theme 7 on 10-04 and 10-05 (old repo git log, 10-06) | "One of the two most concentrated pushes, with theme 6" |
| R5b | Of its 40 commits, 26 landed on 10-04 and 10-05 | WEAKENED | Non-merge recount: 5 on 10-04 and 16 on 10-05, so 21 of 34 | "21 of its 34 commits" |
| R5c | Six of the fifteen 10-05 handoff entries are this theme | STANDS | Not contradicted by any record I found | none |
| R5d | It led the 0.14.0 headline | REFUTED | The 0.14.0 version commit (10-05) lists the context cap, limit auto-resume and usage meter first (theme 4, as rank 4 itself says); the new look is the fourth item. The 10-05 handoff history entry on the redesign landing says the full redesign was missing from 0.14.0 because it had not been merged yet | "It filled the second half of the 0.14.0 headline and landed in full only in 0.15.0" |
| R5e | He picked the target screens on a canvas started 09-29 | STANDS | Design source record lists the chosen boards; creation date taken from that record, not re-checked | none |
| R5f | At 0.15.0 line, incl. existing profiles had to opt in | STANDS | V12 to V14; G7; 10-05 handoff history | none |
| R6 | Theme 5 ranks sixth | STANDS | 16 matches over 6 days; closed the 0.13.0 headline; the missing 10-05 owner call (see Missing M2) strengthens it, but theme 7 has twice the effort | none |
| R6a | Steady but smaller effort (19 commits) | WEAKENED | Non-merge recount 16 over 6 days | "16 commits" |
| R6b | Closed the 0.13.0 headline; drove the 10-06 audit wave | STANDS | 0.13.0 version commit 09-28 ends on sign-ins encrypted at rest; 10-06 handoff entries | none |
| R6c | Protected actions came from his own improvement list (09-29) | WEAKENED | The list is the vault competitor-lessons page dated 09-24, written by Claude, where guarding irreversible commands is a P1 card; the card is marked shipped 09-29. No separate owner call is recorded | "Protected actions came from the 09-24 competitor-lessons list (a P1 card) and shipped 09-29" |
| R6d | Evidence and At 0.15.0 lines | STANDS | U6, U10; audit dated 10-04 | none |
| R7 | Theme 9 ranks seventh | WEAKENED | Of its three reasons, R7b is wrong and R7c and R7d are weak. On the draft's own method it has the second-lowest effort and no recorded owner call. Its place rests on 20 P0 cards and one packaged check | "Seventh because restore is a P0 promise and the only behaviour checked on a packaged build", not because of a double proof or a headline |
| R7a | Few commits (10) | WEAKENED | 9 non-merge matches. Only about 5 are on topic (10-05 file durability, 09-29 cold restore fix, 09-29 packaged restore check, 09-29 background-service cleanup safety, 09-17 background-service host move). Others are false matches (persisted view setting, dictation recovery). The 10-06 audit wave had a data-safety lane the patterns miss | "About 5 on-topic commits, plus a data-safety lane in the 10-06 audit wave" |
| R7b | The one theme Txais had proved on a packaged build twice (09-29) | REFUTED | Handoff history 09-29 restore-check entry: two runs with identical results, and both failed cold restore of plain shell output. It was fixed the same day and passed on one packaged re-run. Agents ran the check under the coordinator, not Txais; plain shells stood in for agents; conversation resume was not run. The check came from a P1 competitor-lessons card (vault, 09-24) | "The one theme checked on a packaged build (09-29): it failed twice, was fixed, and passed once on re-run; agents ran it" |
| R7c | Appears in the 0.12.0 headline as dictation that is never lost | WEAKENED | True of the 0.12.0 version commit (09-28), but desktop voice and dictation were removed 10-05 (3e). A 09-28 unfinished commit shows a 09-24 attempt to remove them was set aside only because 0.12.0 kept dictation | "Its only headline item is for a feature removed on 10-05; it should not lift the rank" |
| R7d | He set it as a measured target for the rebuild (phase 4 of the loop) | WEAKENED | The loop's phase 4 targets (memory, cold start, 16 panes, no lost work) apply only after every P0 and P1 card passes, and the no-lost-work target names dictation, which was removed 10-05 | "Phase 4 measures it after all P0 and P1 cards pass; that argues for a later check, not an earlier build" |
| R7e | Evidence and At 0.15.0 lines | STANDS | 10-05 file-durability commit; G6 says conversation resume was never checked | none |
| R8 | Theme 11 ranks eighth | STANDS | 31 P0 cards; light in lines | none |
| R8a | Large P0 set (31), mostly the `kolux` command surface | STANDS | Recount 31 | none |
| R8b | Light effort (9 commits over 3 days) | WEAKENED | Non-merge recount: 5 matches over 2 days (09-23: 4, 09-24: 1). But area churn shows the orchestration area changed in every ISO week from W37 to W41 (1, 9, 4, 10, 7 commits; 31 in all, about 3.7k lines) | "Light in lines (about 3.7k) but steady across all five weeks; commit subjects undercount it" |
| R8c | It led the 0.11.0 headline (event automations, routing, Runs view) | WEAKENED | The 0.11.0 version commit (09-24) lists plan review first (theme 3, as rank 3 itself says); theme 11 holds items two to four | "It filled most of the 0.11.0 headline after plan review" |
| R8d | Evidence and At 0.15.0 lines | STANDS | V4, V6, V7; G11 | none |
| R9 | Theme 8 ranks ninth (moved down from 8) | WEAKENED | By the draft's own method it has effort tied for second (34), a recorded owner call (09-24: publish once the installed build passes its checks, vault improvement page) and two headlines (0.1.0 and 0.2.0, 09-14). Theme 11 has 5 matches and no lead. The demotion rests only on the rule that the rebuild loop never publishes | "Ninth because the rebuild never publishes. This overrides its effort, a 09-24 owner call and two headlines" |
| R9a | High, steady effort (38 commits over 12 days, 14 tags) | WEAKENED | Non-merge recount 34 over 12 days; 14 tags confirmed | "34 commits over 12 days, 14 tags" |
| R9b | Most of it was plumbing for the old repository | WEAKENED | Of the 34 matches, about 12 are updater behaviour the user sees: update button 09-14, download at once 09-15, 15-minute checks 09-20, packaged update checks 09-23, release notes 09-28, install-outcome notice 09-29, background builds and silent ready notice 10-05, update notice rework 10-06. About 12 are CI and release plumbing, and about 10 are false matches (handoff updates, the ship workflow) | "About a third was updater behaviour he sees; a third was CI and release plumbing; the rest are false matches" |
| R9c | At 0.15.0 and after (30 minutes since 10-06, 15 before; unsigned; Windows only) | STANDS | 10-06 handoff history entry gives 30 minutes; 0.9.0 (09-21) gave 15. The current handoff still says once a day, but that line dates from 09-22 and is stale | none |
| R10 | Theme 6 ranks tenth (moved down from 6) | STANDS | 4 P0 cards; the 09-29 purpose note; see R10c for a pending change | none |
| R10a | 35 commits on 5 days, all from 09-28 | WEAKENED | Non-merge recount: 32 on 4 days (09-28: 14, 09-29: 14, 09-30: 2, 10-04: 1); 38 on 5 days with merges | "32 commits on 4 days, all from 09-28" |
| R10b | One short, intense push that led 0.13.0 | STANDS | 0.13.0 version commit 09-28. By changed lines it was among the biggest: the starter-kit and onboarding areas had 39 commits and about 19.6k lines in W40, the largest week | none |
| R10c | On 09-29 he said Kolux is his own tool and portfolio piece for now, not a product for others | WEAKENED | Vault Kolux note: the 09-29 purpose note supports "for now". A new 10-06 note in the same file records a direction question: making Kolux usable by marketing, sales, finance and support staff, with decisions pending Txais | Add: "On 10-06 he reopened the question of non-coding users; decisions are pending, so this rank may move" |
| R11 | Theme 10 ranks last | STANDS | 0 P0 cards (recount 0); the rename and scrub commits are among those the churn tables exclude as mechanical | none |
| R11a | Evidence and At 0.15.0 lines | STANDS | v0.10.0 rename 09-22; 10-05 originality cleanup entry | none |

## Section 2 · timeline

| # | Row (date, version) and its Why | Verdict | Evidence | Correction |
|---|---|---|---|---|
| T01 | 09-10 to 09-11, none: start from working code, agents pick up cold | STANDS | Import 09-10; first commits 09-10 and 09-11 | none |
| T02 | 09-14 v0.1.0: installed copies update themselves | STANDS | Tag and 09-14 commit on publishing Windows releases from tags | none |
| T03 | 09-14 v0.2.0, v0.2.1: update on demand | STANDS | Tags 09-14; update button commit 09-14 | none |
| T04 | 09-14 v0.3.0: three-mode shell | STANDS | Tag 09-14; handoff history entry on the three-mode shell | none |
| T05 | 09-14 v0.4.0, v0.4.1: preview pane | STANDS | Tags 09-14 | none |
| T06 | 09-15 v0.5.0: composer, dropped next day | STANDS | Tag 09-15; composer dropped 09-16 | none |
| T07 | 09-15 v0.6.0: one window per terminal, reverted same day | STANDS | Tags v0.6.0 and v0.7.0 both 09-15 | none |
| T08 | 09-15 v0.7.0: panes back; launcher on shared seats | STANDS | Tag 09-15. This row conflicts with rank 2's "inherited plumbing" framing (see R2c) | none |
| T09 | 09-15 0.7.1 untagged: sidebar trimmed | STANDS | Untagged version commit 09-15 | none |
| T10 | 09-16 v0.8.0: his calls, one pane per session, no surprise folders | STANDS | Tag 09-16; V1, V2 | none |
| T11 | 09-17 none: one session per pane, his call after using it | STANDS | Handoff history 09-17 | none |
| T12 | 09-21 v0.9.0: browser sign-in, 15-minute checks, Opus default | STANDS | 0.9.0 version commit 09-21 | none |
| T13 | 09-22 v0.10.0: rename, the app becomes his | STANDS | Tag 09-22; rename on 09-21 | none |
| T14 | 09-24 v0.11.0: plan review, automations, routing, OpenCode removed, CI green | STANDS | 0.11.0 version commit 09-24; CI shard commits 09-24 | none |
| T15 | 09-24 none: his three calls | STANDS | Vault improvement page, three decisions dated 09-24 | none |
| T16 | 09-28 v0.12.0: isolation and knowing what agents do | STANDS | 0.12.0 version commit 09-28; latest tag in the old repo (published 09-28) | none |
| T17 | 09-28 0.13.0 untagged, never published: business frame | STANDS | Version commit 09-28; no tag; public releases list starts at 0.15.1 | none |
| T18 | 09-29 to 09-30 none: protected actions, restore check, release gate, workspace views | STANDS | Commits 09-29 and 09-30. The restore check failed twice before passing (see R7b) | none |
| T19 | 10-04 none: five new-look screens, audit | STANDS | Five theme 7 matches on 10-04; audit dated 10-04 | none |
| T20 | 10-05 0.14.0 untagged: cap, auto-resume, meter, new look, themes, pane header | STANDS | The 0.14.0 version commit lists exactly these. The 10-05 handoff history adds that the full redesign was not yet merged into it (see R5d) | none |
| T21 | 10-05 0.15.0 untagged: redesign in full, trims, cuts | STANDS | Version commit 10-05 has no headline of its own; contents from 10-05 handoff entries | none |
| T22 | 10-06 0.15.1, 0.15.2: audit close, hands-off updates | STANDS | Public releases 10-06 (08:51 and 15:48 UTC); 10-06 handoff entries | none |
| T23 | Count line: 14 tags, 2 public releases, 4 untagged bumps, 5 milestones, 22 rows | STANDS | Tag list re-checked; 22 rows counted | none |

## Section 3 · where 0.15.0 stands

| # | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| H0 | 122 live, 899 live but unverified, 5 half-done | WEAKENED | Spec recount 2026-10-06 after later spec saves: live 122, live-unverified 905, half-done 5 | "905 live but unverified" (recount at freeze) |
| V1 | 09-16 own pane per new session [app] | STANDS | Handoff history 09-16 runtime check | none |
| V2 | 09-16 add project takes only the picked folder [app] | STANDS | Handoff history 09-16 runtime check | none |
| V3 | 09-22 quieter sidebar [app] | STANDS | Handoff history 09-22 | none |
| V4 | 09-22 routing tiers shown and chosen [app] | STANDS | Handoff history 09-22; worker launch not driven, as stated | none |
| V5 | 09-23 plan review sheet, simulated status [app] | STANDS | Handoff history 09-23 | none |
| V6 | 09-23 event-started automations [app] | STANDS | Handoff history 09-23 | none |
| V7 | 09-23 launcher refresh, layout presets, Runs view [app] | STANDS | Handoff history 09-23 runtime check of the launcher refresh | none |
| V8 | 09-29 restore across quits, packaged; failed, fixed, passed on re-run [app, packaged] | STANDS | Handoff history 09-29. The wording is accurate; add that agents ran it and plain shells stood in for agents | none |
| V9 | 10-05 limit auto-resume continued a live pane [app] | STANDS | 10-05 handoff history entry | none |
| V10 | 10-05 usage meter with real data [app] | STANDS | 10-05 handoff history entry | none |
| V11 | 10-05 pane header details [app] | STANDS | 10-05 handoff history entry | none |
| V12 | 10-05 sixteen themes, Classic default [app] | STANDS | 10-05 handoff history entry | none |
| V13 | 10-05 no theme flash [app] | STANDS | 10-05 handoff history entry | none |
| V14 | 10-05 new look top bar, Agents and Board [app] | STANDS | 10-05 handoff history entry with dev app screenshots | none |
| V15 | 10-05 rounded windows, pane controls; resize drag not checked [app] | STANDS | 10-05 handoff history entry, which states the drag and the weekly pill were not checked | none |
| V16 | 10-05 headers show title and usage [app] | STANDS | 10-05 handoff history entry | none |
| U1 | 09-21 browser sign-in in an installed build [handoff] | STANDS | 09-21 handoff history; no runtime record of the installed flow | none |
| U2 | 09-22 graphics fallback after three strikes [test] | STANDS | 09-22 commit and tests | none |
| U3 | 09-24 packaged command-line smoke and profile migration; window never opened [test] | STANDS | Handoff history 09-24: smoke passed on a packaged build, the interface was not booted | none |
| U4 | 09-28 the 0.12.0 set [commit] | STANDS | 0.12.0 version commit 09-28 | none |
| U5 | 09-28 the 0.13.0 set [commit] | STANDS | 0.13.0 version commit 09-28 | none |
| U6 | 09-29 protected actions, never tried live [test] | STANDS | Handoff history: protected actions not checked live | none |
| U7 | 10-05 200k cap on by default [handoff] | STANDS | 10-05 handoff history: no runtime check | none |
| U8 | 10-05 weekly pill with real data [handoff] | STANDS | 10-05 entry says the weekly pill was not checked | none |
| U9 | 10-05 hidden tabs count toward graphics limit; lower memory [handoff] | WEAKENED | 10-05 resource-wave entry has measured numbers. With ten tabs and one visible, graphics memory fell from 732 to 627 MB. The larger drop (3.5 to 2.3 GB peak) is in the developer build tool, not the app | "Hidden tabs share the graphics limit; app graphics memory measured 732 to 627 MB with ten tabs [measured]. The bigger saving was in the dev tooling, not the app" |
| U10 | 10-06 audit fixes [test] | STANDS | 10-06 close-out: full suite, lint and type check green except two known failures | none |
| U11 | 10-06 public release on every ship, 30-minute checks, restart prompt; installed update not recorded [handoff] | STANDS | 10-06 handoff history gives 30 minutes and the restart notice; public releases 10-06. The current handoff's once-a-day line is stale text from 09-22 | none |
| U12 | 10-06 Artifacts library [handoff] | STANDS | 10-06 handoff entry; it captures published artifacts locally and is unrelated to the removed Kolux account | none |
| U13 | 10-06 folded Thought rows, card-style agents [commit] | STANDS | 10-06 close-out ran the full suite, lint and type check (two known failures), so [test] fits better than [commit]. It is still unverified in the app | Optional: relabel [test] |
| G1 | 10-05 no way to sign out of a Kolux account after the page was trimmed [handoff] | WEAKENED | The 10-05 settings-trim entry says sign-in still worked from the Artifacts page. The originality cleanup, later the same day, removed that Artifacts row and pane, and a hidden dev app check that day showed no Artifacts row. 3e itself says the Kolux account was removed on 10-05 | "Moot after the 10-05 originality cleanup removed the last Kolux-account sign-in path"; move to 3e |
| G2 | 10-05 usage meter local only; Codex and Grok plan usage only | STANDS | 10-05 handoff history | none |
| G3 | 10-05 auto-resume Claude only | STANDS | 10-05 handoff history | none |
| G4 | 10-05 cap skips native chat, one revive path, Grok | STANDS | 10-05 handoff history | none |
| G5 | 09-29 protected actions skip Codex | STANDS | 09-29 handoff history | none |
| G6 | 09-29 conversation resume after restore never run | STANDS | 09-29 restore-check entry | none |
| G7 | 10-05 existing profiles must opt in to the new look | STANDS | 10-05 handoff history open items | none |
| G8 | 10-06 two tests fail on main too [test] | STANDS | Handoff history 10-06; current handoff 10-06 close-out | none |
| G9 | 10-05 releases unsigned; Mac and Linux not released | WEAKENED | Line-level history of the current handoff dates these lines to 09-14 and 09-21; 10-05 is only the date the file was last updated. Still true on 10-06 | Date it "since 09-14 (unsigned) and 09-21 (Mac and Linux), still true 10-06" |
| G10 | 10-05 agent dashboard off by default, its shortcut silently does nothing | WEAKENED | Line-level history dates these lines to 09-11 and 09-23. The dashboard pop-out was retired on 10-05 and no later record re-checks the shortcut | Date it "09-11 / 09-23, not re-checked after the 10-05 pop-out retirement" |
| G11 | 10-05 orchestration split: app read-only, work from the command line | WEAKENED | Line-level history dates these lines to 09-23 (Runs view added read-only) | Date it 09-23 |
| G12 | 09-23 layout presets not tried with scrollback, acceleration or menu click | STANDS | 09-23 handoff lines | none |
| G13 | 10-05 full suite noisy on Windows; checks rely on Linux CI | WEAKENED | Line-level history dates these lines to 09-24, when CI was split into shards. The 10-06 load run (297 failures in 68 files, 64 passing on re-run) still supports it | Date it "since 09-24, seen again 10-06" |
| H1 | as of 10-05 multi-file stage or unstage half-done [commit] | STANDS | Spec half-done state | none |
| H2 | as of 10-05 live model list unused by picker [commit] | STANDS | Spec half-done state | none |
| H3 | as of 10-05 roadmap timeline possibly unreachable [test] | STANDS | Spec half-done state | none |
| H4 | as of 10-05 newcomer checklist [test] | STANDS | Spec half-done state | none |
| H5 | 09-29 release gate written but its check could not be run where it was built [handoff] | WEAKENED | The cited lines are dated 09-23 and concern the earlier command-line smoke, which then passed on a packaged build on 09-24 (U3). No record says whether the 09-29 terminal check itself ever ran. The 09-29 restore check reused its launch helper on a packaged build, and two public releases went out on 10-06; whether the gate step ran for them is UNKNOWN | "Release gate written 09-29; no record of its terminal check running, though its launcher was used on a packaged build the same day" |
| E1 | Reverted: one window per terminal (09-15), composer (09-16) | STANDS | Tags 09-15; 09-16 handoff | none |
| E2 | Sidebar search, timeline, grid, mode switch removed 09-22 [app] | STANDS | 09-22 handoff history | none |
| E3 | OpenCode removed 09-23 [app] | STANDS | 09-23 commits; churn exclusions record a 580-file removal that day | none |
| E4 | Cloud features hidden 09-28, removed 10-05; mobile links removed 09-29 | STANDS | 0.12.0 version commit; 10-05 cleanup entry | none |
| E5 | Dashboard pop-out and Agent Map retired 10-05; drawer behind experimental flag | STANDS | 0.14.0 version commit 10-05 | none |
| E6 | Voice, dictation, Kolux account, input settings removed 10-05 [app] | STANDS | 10-05 handoff history: his choice, dev app screenshots. An earlier 09-24 attempt was set aside on 09-28 (see Missing M8) | none |
| E7 | Footer and message bar removed 10-05 [test]; stepper and status-bar usage removed [app] | STANDS | 10-05 handoff history: message bar not checked in the app, stepper checked | none |
| E8 | Update nudge removed and upstream names scrubbed 10-05 [app] | STANDS | 10-05 originality cleanup entry | none |
| E9 | Off by default: native chat, pet, Activity, dashboard; dev-only profiles | STANDS | Spec hidden and dev-only states | none |
| E10 | Cut by Txais 10-05: remote hosts and 33 settings sections | STANDS | 10-05 records; remote area churn is mostly deletions | none |

## Section 4 · build-order rules

| # | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| B1 | Rules 1 to 12 | STANDS | Outside the effort lens. Rule 3's count of 16 unthemed P0 cards matches the recount. Rule 2's order inherits the rank corrections above (R7, R9), which do not change it | none |

## Missing

Facts the draft leaves out that would change a rank, a reason or a status list. Each is dated.

- **M1 · Older runtime checks absent from 3a.** These would add three to four V rows (themes 1, 2 and 3), all dev builds:
  - Handoff history 09-15: two Claude panes launched, typing reached the terminal, and agent status arrived.
  - Handoff history 09-21: the renamed app launched with its new title, profile migration worked, and the `kolux` command's help ran.
  - Handoff history 09-23: the updater state was seen in a dev build.
  - An older, undated handoff history section: the agent picker end to end, the sidebar session badge, the launch lineup and Tidy were seen in the running app.
- **M2 · A recorded 10-05 owner call on safety.** Txais asked for auto permission mode instead of bypass for Claude sessions, and Claude now defaults to auto. Sources: handoff history 10-05 rounded-windows entry and the current handoff, 10-05 line. This adds a recorded call to theme 5, which the draft gives none.
- **M3 · A 09-24 owner call on releases.** His call to publish once the installed build passes its checks (vault improvement page, 09-24) is in timeline row T15, but rank 9's reasons do not count it (see R9).
- **M4 · Effort by week, not just by subject.** W40 (09-28 to 10-04) was the largest week by far: 340 area-commits and about 108k changed lines. W38 had 177 and 43k; W41 had 219 and 41k. W40 carried 0.12.0, 0.13.0, protected actions, the restore check and workspace views. Ranking on commit subjects alone understates themes 2 and 6, whose work was large in lines (R2c, R10b).
- **M5 · Settings effort reversed by his own cut.** Settings was the busiest area by commits (91; 48 commits and about 11.9k lines in W40), yet Txais cut 33 settings sections on 10-05. Effort there should carry no rank weight. This supports the draft's choice not to rank on raw area churn.
- **M6 · The 10-06 direction note.** The vault Kolux note dated 10-06 asks how Kolux could serve marketing, sales, finance and support staff, with decisions pending Txais. If he decides yes, theme 6 moves up (R10c).
- **M7 · Measured resource numbers, 10-05.** The resource wave recorded before and after figures (U9). These are the only measured performance numbers in the old project, and they set a baseline for the loop's phase 4 memory target.
- **M8 · Dictation flip-flop.** An old repo commit of 09-28, marked unfinished, records a 09-24 attempt to remove account, mobile, voice and input settings, set aside because 0.12.0 kept dictation. Voice and dictation were then removed on 10-05. This undercuts R7c and R7d.
- **M9 · Theme 9 work the subject patterns miss.** The 10-06 audit fix wave included a data-safety lane (handoff history 10-06 audit-wave entry), and on 09-29 commits made background-service cleanup safe.
- **M10 · Stale update cadence.** The current handoff still says the app checks once a day. That line dates from 09-22 and is contradicted by 15 minutes (0.9.0, 09-21) and 30 minutes (10-06). Any reader of the old handoff should ignore it.
- **M11 · No run record for the release gate.** Nothing shows the 09-29 gate's packaged terminal check running. Two public releases went out on 10-06 (08:51 and 15:48 UTC), and whether they passed through the gate step is UNKNOWN. This affects H5.

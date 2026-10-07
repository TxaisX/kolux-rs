# PRIORITIES arbiter report (dirty room, never read by the clean room)

Written 2026-10-06 by the PRIORITIES arbiter. Inputs: `G:\Dev\kolux-rs\PRIORITIES.md` (draft, 305 lines,
backed up to the session scratchpad before editing), `priorities-evidence.md`, `priorities-refute-1.md`
(R1, effort lens: 4 REFUTED, 27 WEAKENED, 11 MISSING), `priorities-refute-2.md` (R2, owner-intent lens:
4 REFUTED, 13 WEAKENED, 11 MISSING). Output: `PRIORITIES.md` revised in place (371 lines), firewall 0 hits.

Rules applied: change a claim when both refuters REFUTED it, or both WEAKENED it in the same direction,
or one REFUTED and one WEAKENED with compatible corrections. Where they disagreed (one STANDS, or
silent), I checked the dated evidence myself and decided; those rows say "checked". A MISSING item was
added when both listed it, or when one listed it with a dated source I verified. Theme numbers 1-11
are unchanged; no rank changed (neither refuter proposed a rank change).

## Arbiter's own checks (all read-only, 2026-10-06)

- `git -C G:\Dev\Kolux\kolux log`: 360 commits; `--no-merges` 252; subjects not starting "Merge" 266;
  17 distinct commit days. The draft's 266 was the subject-filter set, not the true non-merge set.
- Theme patterns from `priorities-evidence.md` re-run over the 252 set: T1 76/16 (no match on 09-23),
  T2 16/8, T3 25/9, T4 26/6, T5 16/6, T6 32/4 (09-28:14, 09-29:14, 09-30:3, 10-04:1), T7 34/9
  (10-04:5, 10-05:16), T8 34/12, T9 9/5, T10 11/5, T11 5/2. Both refuters' recounts match exactly.
- Spec recount (`grep '^Tier:' G:\Dev\kolux-rs\spec\*.md`): 1,263 cards; 228 P0 (212 themed, 16 none);
  P0 per theme 1:20 2:21 3:42 4:22 5:21 6:4 7:24 8:7 9:20 10:0 11:31; live 122, live-unverified 905,
  half-done 5, hidden 57, retired 45, dev-only 9, dropped 120. No `spec\18-*.md` exists.
- `git blame` of `HANDOFF.md` lines 90-145 (dates of the known-gap lines).
- HANDOFF-HISTORY.md lines 6-21, 29-38, 85-117, 468-476, 617-628, 700-760, 1007-1012.
- Vault: Kolux Improvements from BridgeMind (frontmatter date 2026-09-24, decisions lines 27-29, PROD-7
  row 69 is P1); Kolux.md lines 34-49; Universal AI IDE synthesis lines 1-6, 12, 34, 73-76, 177;
  Build Log.md lines 1-41.
- `dumps/records/design-source.md` line 18; `dropped-18-inventory.md` lines 1-9; `churn-by-week.csv`
  (week totals W37 41/6.5k, W38 177/43.1k, W39 85/13.1k, W40 340/108.1k, W41 219/40.8k; area 08 per
  week 1, 9, 4, 10, 7); `G:\Dev\kolux-rs\LOOP.md` lines 119-125.
- Commits read with `git show -s`: 2d29a6548 (2026-09-29 usage forecast; no tag contains it; no
  handoff verification found), 32a7b25c6 (2026-10-05 Claude default permission mode auto),
  dab33254d (2026-09-28 WIP: 09-24 wave removal of Account, Mobile, Voice, Input settings,
  superseded by 0.12.0 which kept dictation), 1181eb69f (2026-09-29 release gate).

## Changes applied (39)

| # | Claim (PRIORITIES section) | R1 | R2 | Basis | Change made |
|---|---|---|---|---|---|
| C1 | §1 header: 266 non-merge commits | S1 REFUTED | A1 WEAKENED | Compatible: both say the true non-merge set is 252; verified | "252 non-merge commits ... merge commits are left out" |
| C2 | §1 rank table, Commits / days column | S3 WEAKENED | A1 WEAKENED | Both same direction; recount verified | Column replaced with the 252-set recount |
| C3 | §1 header and table P0 counts (227/211/16; theme 1 = 19) | S2 WEAKENED | A2 WEAKENED, M11 | Both; recount verified | 228 / 212 / 16; theme 1 = 20; "recount if the spec changes" |
| C4 | Rank 1: every one of the 17 commit days | R1a WEAKENED | B1 STANDS (same note as "minor") | Checked: T1 has no non-merge match on 09-23 | "16 of the 17 commit days, more than any other theme" |
| C5 | Rank 2: effort modest because plumbing inherited | R2c WEAKENED | B3 STANDS + M6 | Checked: HH:717-722 (0.7.0 default Shared checkout), VB:27 (09-24 decision); W40 area 02 23 commits / 10.8k lines | Reversal of the 0.7.0 shared-checkout default added; "large launcher rework on 09-28 and 09-29" replaces "plumbing inherited"; evidence line gains v0.7.0 and the launcher commits |
| C6 | Rank 4: Txais's recorded call on self-refreshing sign-in | R4b REFUTED | B6 WEAKENED | Compatible (no decider named; still open) | "the build kept ... no owner call is recorded"; moved to Open owner questions; evidence relabelled "handoff entry (sign-in opt-out)" |
| C7 | Rank 5: the most concentrated push of the whole project | R5a WEAKENED | silent (B8 covers adjacent claims) | Checked: T6 has 31 of 32 matches on 09-28..09-30; T7 21 of 34 on two days | "one of the two most concentrated pushes (with theme 6)" |
| C8 | Rank 5: 26 of 40 commits on 10-04/10-05 | R5b WEAKENED | B8 STANDS, but A1 recount gives 34 | Checked per-day recount (5 + 16) | "21 of its 34 commits" |
| C9 | Rank 5: it led the 0.14.0 headline | R5d REFUTED | B7 WEAKENED | Compatible; HH:87 confirms 0.14.0 lacked the redesign | "in the 0.14.0 headline after the theme 4 items; full redesign landed later on 10-05, after the 0.15.0 bump" |
| C10 | Rank 6: 19 commits | R6a WEAKENED | A1 (16 on true set) | Both | "16 commits" |
| C11 | Rank 6: protected actions came from his own improvement list (09-29) | R6c WEAKENED | B10 STANDS | Checked: vault list dated 2026-09-24, PROD-7 is a P1 card (row 69), shipped marker 09-29 (`improvement-cards.md:32`) | "came from the 2026-09-24 competitor-lessons improvement list (a second-priority card there) and shipped 2026-09-29" |
| C12 | Rank 7: overall reasons for seventh | R7 WEAKENED | B11, B12 WEAKENED | Both weaken the reasons; rank kept | Why rewritten: 20 P0 cards, the only packaged-build check, no owner call; dictation and target no longer lift it |
| C13 | Rank 7: few commits (10) | R7a WEAKENED | A1 (9 on true set) | Checked the 9 subjects: about 5 on topic (10-05 durability, 09-29 cold restore, 09-29 restore check, 09-29 daemon-host prune safety, 09-17 daemon host move) | "9 subject matches, about half of them on topic" |
| C14 | Rank 7: proved by Txais on a packaged build twice | R7b REFUTED | B11 WEAKENED | Compatible | "agents ran a restore check twice; both failed cold restore of plain shell output; fixed the same day; passed on one re-run" |
| C15 | Rank 7: dictation in 0.12.0 headline as a reason | R7c WEAKENED | B12 WEAKENED | Both same direction | "belongs to a feature Txais removed on 2026-10-05, so it adds no weight" |
| C16 | Rank 7: he set it as a measured rebuild target | R7d WEAKENED | B12 says keep it | Checked LOOP.md:119-125 (phase 4 only after every P0 and P1 card passes; the target names dictation). Compromise: keep the fact (R2), state the timing (R1), drop it as a reason for the rank | "The rebuild loop also names no lost work as a measured target, but checks it only in its last phase" |
| C17 | Rank 8: light effort (9 commits over 3 days) | R8b WEAKENED | B15 STANDS, A1 gives 5/2 | Checked recount and churn-by-week area 08 (1, 9, 4, 10, 7 commits; about 3.7k lines) | "light by commit subject (5 over 2 days), though the orchestration part of the code changed in every week in small steps" |
| C18 | Rank 8: it led the 0.11.0 headline | R8c WEAKENED | B14 WEAKENED | Both same direction | "It shared the 0.11.0 headline: three of its items followed plan review" |
| C19 | Rank 9: reasons for ninth | R9 WEAKENED | B16 STANDS + M7 | R1's override framing plus the 09-24 owner call both reviewers want (M3 / M7) | Why states effort tied for second, the 09-24 call and the first two releases, then the single overriding reason (the loop never publishes) |
| C20 | Rank 9: 38 commits over 12 days | R9a WEAKENED | A1 (34) | Both | "34 commits over 12 days, 14 tags" |
| C21 | Rank 9: most of it was plumbing | R9b WEAKENED | B16 STANDS | Checked the 34 subjects: about 11-12 user-visible updater changes, about 12-13 CI and release plumbing, about 10 false matches | "About a third updater behaviour he sees, a third CI and release plumbing, the rest false matches" |
| C22 | Rank 10: 35 commits on 5 days | R10a WEAKENED | B18 STANDS, A1 gives 32/4 | Checked recount | "32 commits on 4 days, all from 2026-09-28, and large in size" |
| C23 | Rank 10: not a product for others (09-29) | R10c WEAKENED | B17 REFUTED | Compatible; VK:36-42 (09-29 note: own tool and portfolio piece, no pricing or launch; 10-06 direction note, decisions pending) | Phrase removed; 09-29 note restated accurately; 10-06 direction added; "this rank may move up"; evidence adds vault direction note 2026-10-06 |
| C24 | §3 header: 899 live but unverified | H0 WEAKENED | D0 WEAKENED | Both; recount verified | "905 ... (recounted 2026-10-06)" |
| C25 | U9 hidden tabs / lower memory | U9 WEAKENED (+ M7) | U9 STANDS | Checked HH:17-18: GPU process 732 to 627 MB (10 tabs, 1 visible); dev-server peak 3.5 to 2.3 GB is tooling | Measured figure added; "larger saving was in the developer tooling, not the app"; tag "[handoff, measured]" |
| C26 | U4 includes push-to-talk on mouse buttons | U4 STANDS | U4 WEAKENED | Checked HH:96-102: desktop dictation UI removed 10-05; 3e already lists it | Push-to-talk dropped from U4 |
| C27 | G1 no Kolux account sign-out | G1 WEAKENED | G1 WEAKENED | Both same direction (move to 3e) | G1 removed from 3c (count 13 to 12, ids kept); sign-out note added to the 3e voice/account line as moot |
| C28 | G9 dated 10-05 | G9 WEAKENED | G9 STANDS | Checked blame: HANDOFF.md L93, L95-96 dated 2026-09-14, L94 2026-09-21. R1 dated Mac/Linux 09-21; blame puts that sentence (L96) on 09-14 | "since 2026-09-14, still true 2026-10-06" |
| C29 | G10 dated 10-05 | G10 WEAKENED | G10 STANDS | Checked blame: L126-127 2026-09-11, L128-130 2026-09-23 | "2026-09-11, restated 2026-09-23 ... not re-checked since the pop-out was retired on 2026-10-05" |
| C30 | G11 dated 10-05 | G11 WEAKENED | G11 STANDS | Checked blame: L121-125 2026-09-23 | Dated 2026-09-23 |
| C31 | G13 dated 10-05 | G13 WEAKENED | G13 STANDS | Checked blame: L134-137 2026-09-24; HH:9 (10-06 load run, 297 failures) | "since 2026-09-24, seen again 2026-10-06" |
| C32 | H5 release gate check could not be run where built | H5 WEAKENED (+ M11) | H5 STANDS | Checked blame: the cited HANDOFF.md L141-142 are dated 2026-09-23 and concern the earlier release smoke script; no record of the 09-29 terminal check running found | "gate written that day, but no record shows its terminal check running, including for the two public releases of 2026-10-06"; tag [handoff] to [commit] |
| C33 | §2 v0.5.0 why: dropped the next day | T06 STANDS | C6 REFUTED | Checked HH:704-721: an unmerged rewrite branch on the 0.5.0 base was dropped 09-16; 0.7.0 re-mounted the composer as in 0.5.0 | "Faster launching from one place; a later rewrite of this launcher was dropped unmerged on 09-16, and the composer stayed" |
| C34 | §2 v0.7.0 why: separate windows were worse | T08 STANDS | C8 WEAKENED | Checked HH:717-758: no reason recorded; the windows were later made to work | "Back to one grid in the main window (no reason recorded)" |
| C35 | §2 0.15.0 row: remote hosts and 33 settings sections cut | T21 STANDS | C21 REFUTED | Checked `dropped-18-inventory.md:7-9` (every area 18 row still in the 0.15.0 code) and `briefs/00-shared.md:116` (cuts are rebuild scope) | Removed from the row; added as a note under the table ("Not a release ... cut from the rebuild's scope"); row count stays 22 |
| C36 | §2 0.15.0 row: redesign landed in full | T21 STANDS | C22 WEAKENED | Checked HH:93 (open items: Agents rail, folded Thought rows) and U13 (finished 10-06) | "Redesign landed (its two open items finished 10-06)" |
| C37 | §3e: workspace composer launcher reverted 09-16 | E1 STANDS | E1 REFUTED | Same check as C33 | "A rewrite of the 0.5.0 launcher was dropped unmerged on 2026-09-16; the workspace composer itself stayed" |
| C38 | §3e: remote hosts and 33 sections cut as D cards | E10 STANDS | E10 WEAKENED | Checked: no spec file for area 18; `00-shared.md:82` ("No cards"), `:133-136` (some features kept with fixed defaults) | "Cut ... for the rebuild, not removed from the old app; remote hosts listed by name in DECISIONS.md rather than as cards; some features become D cards, others keep fixed defaults or command-line flags" |
| C39 | §2 09-29 row: restore checked on a packaged build | T18 STANDS (notes the failures) | C18 STANDS (asks for "checked, failed, fixed, re-checked") | Both reviewers asked for the same wording in their notes; needed for consistency with C14 | "a restore check on a packaged build (failed, fixed, passed on re-run)" |

## MISSING items added (14)

| # | Item | Listed by | Verified source | Where it went |
|---|---|---|---|---|
| M-a | Owner call 2026-10-05: Claude in auto permission mode instead of bypass | R1 M2, R2 M3 | HH:31 ("Txais wanted ... auto mode instead of bypass"), HH:37; commit 32a7b25c6 (2026-10-05) | Rank 6 why, evidence and At 0.15.0; 0.15.0 timeline row |
| M-b | Owner call 2026-09-24: publish when checks pass on the installed build | R1 M3, R2 M7 | VB:29 (dated 2026-09-24) | Rank 9 why and evidence |
| M-c | Dictation flip-flop (09-24 wave removal set aside 09-28; removed 10-05) | R1 M8, R2 M9 | commit dab33254d message (2026-09-28); HH:96-99 | §3e voice/account line |
| M-d | 2026-10-06 direction: non-coding staff as users, decisions pending | R1 M6, R2 (B17 and M1) | VK:40-42; VU:1-6, 12 | Rank 10 why and evidence; Open owner questions |
| M-e | Custom-agent builder is cut (D) but the 10-06 department agents are written for it | R2 M1 | VU:34, VU:73-76, VU:177 (decided in principle 2026-10-06); `00-shared.md:131` | Open owner questions (new subsection at end of §1) |
| M-f | The chosen design direction centres the Agents screen on user-built agents | R2 M2 | `design-source.md:18` (canvas 2026-09-29, chosen direction names user-built agents); HH:88 (board 8 Agents chat) | Merged into the M-e open question |
| M-g | His own draft post for the week of 2026-10-05 lists the safety checks as a highlight | R2 M4 | Build Log.md entry #1, dated 2026-10-05, status "draft, not posted" | Rank 6 why and evidence (worded as a draft, not yet posted) |
| M-h | Usage forecast with one-time 80 % / 95 % alerts (2026-09-29) | R2 M5 | commit 2d29a6548 (2026-09-29); no handoff verification found | Rank 4 At 0.15.0 and evidence; 09-29 timeline row; new U14 [commit] (3b count 13 to 14) |
| M-i | 0.7.0 shared-checkout default reversed by the 09-24 owner call | R2 M6 (R1 R2c correction) | HH:717-722; VB:27 | Rank 2 why and evidence (with C5) |
| M-j | 0.11.0 also shipped update checks in the installed app | R2 M8 | VK:44-49 (dated 2026-09-24); HH:469-474 | 0.11.0 timeline row |
| M-k | Mobile kept in the 10-05 trim, then cut the same day for the rebuild | R2 M10 | HH:97-99 (Txais chose to keep Mobile); `00-shared.md:82, :116-127` | §3e voice/account line |
| M-l | Older runtime checks missing from 3a (part) | R1 M1 | HH:737-741 (2026-09-15: Launch 2 gave two Claude panes, typing reached the pty, hook status arrived); HH:619-621 (2026-09-21: renamed app launched, legacy profile migrated, `kolux --help` ran) | New V17, V18 appended (3a count 16 to 18; appended out of date order to keep V1-V16 stable) |
| M-m | Theme 9 work the subject patterns miss | R1 M9 | HH:8-9 (10-06 data-safety lane: corrupt primary kept aside, durable writes, fsync); commit subject 2026-09-29 "Safety: daemon-host prune ..." | Rank 7 why and evidence |
| M-n | Effort by week: W40 was by far the largest | R1 M4 | `churn-by-week.csv` week totals (W40 340 / 108.1k vs W38 177 / 43.1k) | §1 method paragraph |

Covered by applied changes rather than counted as additions: R1 M7 (measured resource numbers, see C25),
R1 M11 (no run record for the release gate, see C32), R2 M11 (spec count drift, see C3 and C24).

## Proposed changes rejected (7)

| # | Proposal | From | Why rejected |
|---|---|---|---|
| X1 | Add the 2026-09-23 dev-build updater check and the undated "What is verified" section (agent picker, session badge, lineup, Tidy) to 3a | R1 M1 (parts) | The undated section fails the "dated source" test. The 09-23 check verified a development build's update message, which the 2026-10-06 update rework replaced, and no later check exists, so it says nothing about 0.15.0 |
| X2 | Note that settings churn was reversed by the owner's 10-05 cut | R1 M5 | It confirms the draft's choice not to rank on raw area churn; nothing in PRIORITIES needs to change |
| X3 | Warn readers that the old handoff's once-a-day update line is stale | R1 M10 | PRIORITIES already gives 15 then 30 minutes; the clean room never reads the old handoff |
| X4 | Relabel U13 from [commit] to [test] | R1 U13 (optional, verdict STANDS) | The row's verdict is STANDS from both reviewers; optional, not forced by the rules |
| X5 | Footnote on the 0.12.0 timeline row that push-to-talk and dictation were later removed | R2 C16 (verdict STANDS) | The row is accurate as history; the reversal is now recorded once, in 3e (M-c) |
| X6 | Do not cite commit db7485d83 as the cloud-removal date | R2 E4 (verdict STANDS) | Concerns the evidence record, not PRIORITIES; PRIORITIES cites no commit. Out of scope (I own only PRIORITIES and this report) |
| X7 | Keep the loop's measured target as a reason that lifts theme 9 | R2 B12 correction | LOOP.md:119 runs phase 4 only after every P0 and P1 card passes, so it cannot argue for building earlier; kept as a fact only (see C16) |

## Notes for the coordinator (outside my scope, not edited)

- `G:\Dev\kolux-rs\LOOP.md:125` names dictation in the phase 4 no-lost-work target; Txais removed desktop
  dictation on 2026-10-05. Needs an owner or LOOP.md decision.
- The three Open owner questions in PRIORITIES §1 (theme 6 rank, the custom-agent builder cut, the
  sign-in default) should be copied under "Needs Txais" in STATE.md and DECISIONS.md.
- `priorities-evidence.md` still cites the 266-subject counts and the old wording; this report supersedes
  it for every row above.

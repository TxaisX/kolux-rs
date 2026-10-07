# PRIORITIES refute 2 of 2 — lens: owner intent

Target: `G:\Dev\kolux-rs\PRIORITIES.md` as of 2026-10-06 (305 lines). Written 2026-10-06 by the
second refuter. The lens is Txais's own recorded calls and reversals, release-note headlines, the
improvement cards and their shipped markers, and the business-frame decisions. Rule followed:
default to STANDS when my evidence is weaker than the draft's.

Source keys (dirty room only):
- HH = `G:\Dev\Kolux\kolux\HANDOFF-HISTORY.md` (line numbers)
- LOG = `git -C G:\Dev\Kolux\kolux log` (read-only), by commit hash
- REC = `G:\Dev\kolux-rs\provenance\dirty-room\dumps\records\` (tags.csv, releases.txt, handoff-recent-work.md,
  improvement-cards.md, business-frame.md, design-source.md)
- SH = `G:\Dev\kolux-rs\provenance\dirty-room\briefs\00-shared.md`
- D18 = `G:\Dev\kolux-rs\provenance\dirty-room\dropped-18-inventory.md`
- SPEC = `G:\Dev\kolux-rs\spec\*.md`, recounted 2026-10-06 with grep on the "Tier:" and "State at 0.15.0:" lines
- VK = vault `06 - Projects\Kolux\Kolux.md`; VBL = vault `06 - Projects\Kolux\Build Log.md`
- VB = vault `03 - Wiki\Syntheses\Kolux Improvements from BridgeMind.md`
- VU = vault `03 - Wiki\Syntheses\Kolux as a Universal AI IDE - what to take from agency-agents.md`
- MEM = memory notes `kolux-improvement-release.md`, `kolux-department-agents.md` under
  `G:\Dev\claude-config\projects\G--Dev-Projects-Txais-Brain\memory\`
- PLAN = `G:\Dev\claude-config\plans\please-go-through-kolux-crispy-taco.md`

Tally: 116 claims checked · 4 REFUTED · 13 WEAKENED · 99 STANDS · 11 MISSING.

## A. Method lines (sections 0 and 1 header)

| # | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| A1 | "266 non-merge commits over 17 commit days" | WEAKENED | LOG 2026-10-06: 360 commits, 108 with two parents, so 252 are non-merge. 266 is the count of commits whose subject does not begin "Merge"; it includes 14 merge commits with descriptive subjects (e.g. 0de1bae45, e6b65c94d, 53606ea0b, 7fd3282d7, d0cd0356d). Commit days are 17 either way. On the true 252 set the theme counts are T1 76/16, T2 16/8, T3 25/9, T4 26/6, T5 16/6, T6 32/4, T7 34/9, T8 34/12, T9 9/5, T10 11/5, T11 5/2. | Say "266 commits whose subject is not a merge line (252 true non-merge)". Ranks are unaffected. The order of themes by commit count holds except for two ties (theme 7 and theme 8 at 34; theme 5 and theme 2 at 16), and no rank depends on either gap. The per-theme cells in the rank table and the counts quoted in the whys (e.g. rank 7 "10", rank 8 "9 over 3 days") use the 266 set. |
| A2 | "227 P0 cards: 211 with a theme, 16 without" and the P0 column | WEAKENED | SPEC recount 2026-10-06: 228 P0, 212 with a theme, 16 without; theme 1 now has 20 P0 (draft 19). All other theme P0 counts match. | Recount at final assembly: 228 / 212 / 16; theme 1 = 20. |
| A3 | Rank movements vs number order (7 and 9 up two, 11 up three; 5, 8, 10 down one; 6 down four) | STANDS | Arithmetic on the rank table checks out. | — |

## B. Theme ranks and their "why"

| # | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| B1 | Rank 1 theme 1: most recorded calls (every new session its own pane 09-16; one session per pane and sessions in the sidebar 09-17; strip under panes removed 10-05); three straight release headlines 0.6.0/0.7.0/0.8.0; one-window try reverted same day | STANDS | HH:768 (09-16, owner's call), HH:669 (09-17, owner's call), HH:43 (10-05, Txais chose full removal), HH:25 (Txais wants every pane to show title and usage); REC tags.csv v0.6.0/v0.7.0 (09-15), v0.8.0 (09-16). | Minor: "every one of the 17 commit days" is 16 of 17 on the true non-merge set (A1); still the widest theme. |
| B2 | Rank 1 "At 0.15.0" (rounded panes, controls on every pane, headers with title and usage, no footer or message bar, saved layouts) | STANDS | HH:31-38, HH:43-45, HH:83; LOG 10-05 rounded windows and header commits. | — |
| B3 | Rank 2 theme 2: Txais decided worktree-per-agent default 2026-09-24; first item of 0.12.0; 09-22 entry is build workflow | STANDS | VB:27 (decided 2026-09-24); MEM kolux-improvement-release ("Decided by Txais 2026-09-24"); LOG 070c3e368 and tag v0.12.0 list new-worktree-per-agent first. | Add the reversal (see Missing M6): it overturned the 0.7.0 shared-checkout default. |
| B4 | Rank 3 theme 3: largest P0 set (42); led parts of 0.11.0 (plan review) and 0.12.0 (Stopped, quiet alerts, expiry notices); 10-05 pane header continues it | STANDS | SPEC 42 P0 on theme 3; LOG 4b76b9dce lists plan review first; tag v0.12.0 text; HH:170 (pane header, Txais chose). | — |
| B5 | Rank 4 theme 4: led 0.9.0 and 0.14.0 headlines | STANDS | LOG 2048806e3 (09-21 browser sign-in first); LOG b5e2d4bef (10-05: context cap, auto-resume, usage meter are the first three items). | — |
| B6 | Rank 4: "on 2026-09-28 Txais kept self-refreshing Claude sign-in as the default, with an opt-out" | WEAKENED | HH:369 records a "Decision" that Kolux keeps self-refreshing tokens by default, with no decider named. MEM says "Decided 2026-09-28 … ACCT-7 = add an opt-out … default OFF" without "by Txais" (unlike the 09-24 lines, which say "Decided by Txais"). PLAN Part 2 still lists ACCT-7 as an open decision. | "A 2026-09-28 decision recorded in the handoff kept self-refreshing sign-in on by default, with an opt-out." Put ACCT-7 in DECISIONS.md for Txais to confirm. |
| B7 | Rank 5 theme 7: "it led the 0.14.0 headline" | WEAKENED | LOG b5e2d4bef (2026-10-05 10:43): the cap, auto-resume and meter (theme 4) come first; "the new look" is the fourth item. HH:87: 0.14.0 lacked the redesign branch because it was never merged; the redesign merged later that day after the 0.15.0 bump (LOG da055d166 13:53 bump, redesign merge 18:20). | "It was in the 0.14.0 headline, and landed fully in the 0.15.0 work on 10-05." |
| B8 | Rank 5: Txais picked the target screens on a design canvas started 2026-09-29; 26 of 40 commits on 10-04/10-05; six of the fifteen 10-05 entries | STANDS | REC design-source.md (canvas created 2026-09-29; archive heading "Chosen: Board (B) + Terminals (C)"; boards drawn "from your references"); HH:141 (Txais chose opt-in colour themes), HH:121 (no-flash fix asked for by Txais). | — |
| B9 | Rank 5 "At 0.15.0" (Agents/Board/Terminals screens, new-session page, 16 themes Classic default, no flash, existing profiles opt in) | STANDS | HH:93 (profiles must opt in), HH:141, HH:121. | Note that the Agents screen's target board is "chat with an agent you built" (Missing M2). |
| B10 | Rank 6 theme 5: smaller effort; closed the 0.13.0 headline; drove the 10-06 audit wave; protected actions from his improvement list 09-29; sits below theme 7 on effort and headlines | STANDS | LOG 6acbb9f36 (0.13.0 ends with sign-ins encrypted at rest); LOG dc0eef205 (09-29 protected actions); HH:8 (10-06 audit wave). Theme 7 out-counts theme 5 on commits (40 vs 19; 34 vs 16 true non-merge) and on recorded owner calls. | Add the 10-05 owner call on Claude's permission mode (Missing M3); it does not change the rank. |
| B11 | Rank 7 theme 9: "the one theme Txais had proved on a packaged build twice (2026-09-29)" | WEAKENED | HH:305-349: packaged 0.13.0 run twice, byte-identical, and the cold-restore check failed in both runs; fixed in a3831fbe9; one packaged re-run passed. The runs were driven by the coordinator's agents; no Txais call is recorded. | "Restore was checked on a packaged build on 2026-09-29: it failed twice, was fixed, and a re-run passed." Drop "Txais had proved". |
| B12 | Rank 7: "it appears in the 0.12.0 headline as dictation that is never lost" | WEAKENED | True of the tag text (v0.12.0), but Txais removed desktop voice and dictation on 2026-10-05 (HH:98-99), after it had already been dropped and restored once (LOG dab33254d 09-28 WIP removed it; 0.12.0 kept it). A feature he chose to remove is not evidence he values the theme. | Drop the dictation reason. Keep the packaged restore check (B11 wording) and the LOOP.md measured target. |
| B13 | Rank 7 "At 0.15.0" (restore across quits and killed service; safer writes; conversation resume never checked) | STANDS | HH:305-349; LOG 929c4db92 (10-05 file durability). | — |
| B14 | Rank 8 theme 11: "It led the 0.11.0 headline (event automations, model routing, Runs view)" | WEAKENED | LOG 4b76b9dce and HH:376: plan review (theme 3) is the first item; theme 11 has three of the items that follow. | "It shared the 0.11.0 headline (three of its items)." |
| B15 | Rank 8: large P0 set (31), light effort (9 commits over 3 days) | STANDS | SPEC 31 P0 on theme 11; LOG counts reproduce. | — |
| B16 | Rank 9 theme 8: high steady effort, mostly old-repo plumbing; 7 P0; matters only once Txais ships; checks every 30 min since 10-06, 15 before | STANDS | REC tags.csv/releases.txt; HH:11 (30-minute checks, restart prompt); LOG 2048806e3 (15-minute checks 09-21); SPEC 7 P0. | Add his 09-24 call "publish when checks pass" to the why (Missing M7); rank unchanged. |
| B17 | Rank 10 theme 6: demoted partly because "on 2026-09-29 he said Kolux is his own tool and portfolio piece for now, not a product for others" | REFUTED | The 09-29 note is about pricing and launch: "no pricing or launch planned" (VK:4, VK:37). On 2026-10-06 Txais asked how to make Kolux a universal AI IDE that marketing, sales, finance and support staff can use (VK:40-42; VU:12 "The question (Txais, 2026-10-06)"). That day he had 24 department agents built for non-coders (MEM kolux-department-agents; VU:73-76) and decided in principle that the Agents tab suggests all 24 (VU:177). His latest recorded intent is that Kolux is for other people too. | Remove the "not a product for others" reason. Rank 10 can stand on the evidence that is left (only 4 P0 cards; 0.13.0 never published), but the why must cite the 2026-10-06 direction and put "does theme 6 move up?" under Needs Txais. |
| B18 | Rank 10: led the 0.13.0 headline under his 2026-09-28 decisions; 35 commits on 5 days from 09-28 | STANDS | LOG 6acbb9f36 ("a friendlier frame for business users"); REC business-frame.md MAP "Owner decisions (2026-09-28)". | — |
| B19 | Rank 11 theme 10: no P0; rename and scrub were mechanical; 11 X cards are logos | STANDS | SPEC: 0 P0 on theme 10; 11 X cards on theme 10 (plus 1 with no theme); HH:49 (originality cleanup before showing Kolux publicly). | — |

## C. Timeline rows (section 2)

| # | Row | Verdict | Evidence | Correction |
|---|---|---|---|---|
| C1 | 09-10 – 09-11: imported code, agent handoff, lint | STANDS | LOG first commits 09-10/09-11. | — |
| C2 | v0.1.0: tag-built Windows releases | STANDS | REC tags.csv, releases.txt. | — |
| C3 | v0.2.0/0.2.1: update button; rebuild at Txais's request | STANDS | REC tags.csv. | — |
| C4 | v0.3.0: three-mode shell | STANDS | REC tags.csv; REC design-source.md (on-disk three-mode shell doc). | — |
| C5 | v0.4.x: preview pane; Windows button fix | STANDS | REC tags.csv. | — |
| C6 | v0.5.0: workspace composer, full-permission chip, agent picker. Why: "Faster launching; dropped the next day" | REFUTED | HH:704-715: the item dropped on 2026-09-16 was a launcher rewrite branch built on the 0.5.0 base, which was never merged, in favour of 0.7.0's launcher. HH:717-721: 0.7.0 (09-15) re-mounted the workspace composer and the rest of the workbench as they were in 0.5.0. The composer itself was kept. | Why: "Faster launching from one place." Add a note: "a later rewrite of this launcher was dropped on 09-16 in favour of 0.7.0's". |
| C7 | v0.6.0: one window per terminal, New session launcher, six-agent wave; reverted same day | STANDS | REC tags.csv (both 09-15); HH:869 (wave of up to 6). | — |
| C8 | v0.7.0 why: "Separate windows were worse than one grid" | WEAKENED | No reason from Txais is recorded. HH:717 says only that the windows path was moved off the user's path; HH:747 says the separate windows did not work at first. | Why: "Back to one grid; no reason recorded." Or mark it as our inference. |
| C9 | 0.7.1: sidebar shows only projects and session counts | STANDS | LOG 12a25f527 (09-15). | — |
| C10 | v0.8.0: every new session its own pane; add-project takes only the picked folder; "His calls" | STANDS | HH:768 and HH:792 (owner's calls 09-16); HH:784 (runtime-verified). | — |
| C11 | 09-17: one session per pane; add button off the tab strip; sessions back in sidebar; "His call after using it" | STANDS | HH:669 (owner's call 09-17); LOG 26dfb46ca. | — |
| C12 | v0.9.0: browser sign-in, 15-minute checks, Opus default | STANDS | LOG 2048806e3 (09-21). | — |
| C13 | v0.10.0: renamed Kolux; "The app becomes his" | STANDS | REC tags.csv (09-22). | — |
| C14 | v0.11.0 row incl. OpenCode removed; "only frontier-lab agents" | STANDS | LOG 4b76b9dce; HH:376; HH:449 (OpenCode removal was the owner's call). | Add "update checks in the installed app" to What landed (Missing M8). |
| C15 | 09-24 decisions: worktree default, cloud hidden, publish when checks pass; "His three calls" | STANDS | VB:27-29 (all dated 2026-09-24); MEM ("Decided by Txais 2026-09-24"). | — |
| C16 | v0.12.0 row and why | STANDS | Tag v0.12.0 text matches item for item; REC improvement-cards.md (seven P0 cards shipped in 0.12.0). | Footnote: push-to-talk and dictation were removed by Txais on 10-05 (HH:98-99). |
| C17 | 0.13.0 untagged, never published; business frame | STANDS | REC releases.txt (old repo ends at v0.12.0); LOG 6acbb9f36; REC business-frame.md. | — |
| C18 | 09-29 – 09-30: protected actions, packaged restore check, release gate, views and canvas | STANDS | LOG dc0eef205, a58b30500, a3831fbe9, 1181eb69f, de420e71b; REC design-source.md. | "Restore checked" should read "checked, failed, fixed, re-checked" (B11). Add usage forecast (Missing M5). |
| C19 | 10-04: new-look screens; a code audit | STANDS | LOG db85dc8fe and the 10-04 screen commits; HH audit entry. | — |
| C20 | 0.14.0: cap, auto-resume, meter, new look, themes, pane header; pop-out retired | STANDS | LOG b5e2d4bef. | — |
| C21 | 0.15.0 What landed: "remote hosts and 33 settings sections cut" | REFUTED | SH:82 and SH:116 date these as owner cuts for the rebuild's scope (Txais, 2026-10-05). They were not removals shipped in 0.15.0. D18: every area-18 row was still present in the 0.15.0 code on 2026-10-06. HH:8: the 10-06 audit wave still had an SSH/relay lane. | Move to its own line: "Decision (rebuild scope, Txais 2026-10-05): remote hosts and 33 settings sections cut." It is not something that landed. |
| C22 | 0.15.0: "Redesign landed in full" | WEAKENED | HH:93 (10-05) leaves open items: the Agents rail was still the old list and folded Thought rows were not built. These closed on 10-06 (LOG c697f1065), which the 10-06 row itself counts. | "Redesign landed, with two items finished on 10-06." |
| C23 | 10-06: audit fix wave, public releases on every ship, Artifacts library, security close-out, folded Thought rows | STANDS | REC releases.txt (0.15.1 08:51Z, 0.15.2 15:48Z); LOG 3674def6a, c697f1065; HH:8-11. | — |
| C24 | Count line: 14 tags all published; 2 public releases; 4 untagged bumps; 5 milestones; 22 rows | STANDS | REC tags.csv, releases.txt; row count checked. | — |

## D. Where 0.15.0 stands (section 3)

| # | Claim | Verdict | Evidence | Correction |
|---|---|---|---|---|
| D0 | Header: 122 live, 899 live-unverified, 5 half-done | WEAKENED | SPEC recount 2026-10-06: live 122, live-unverified 905, half-done 5 (and dropped 120, retired 45, hidden 57, dev-only 9). | Recount at final assembly; 905 today. |
| V1 | Every new session in its own pane [app] | STANDS | HH:768, HH:784. | — |
| V2 | Add project takes only the picked folder [app] | STANDS | HH:790-800. | — |
| V3 | Quieter left sidebar [app] | STANDS | HH:570 (owner's call); no contrary record. | — |
| V4 | Routing tiers shown and chosen; live worker launch not driven [app] | STANDS | Evidence record; no contrary record. | — |
| V5 | Plan review side sheet, simulated status [app] | STANDS | Evidence record; no contrary record. | — |
| V6 | Event-start automations [app] | STANDS | Evidence record; no contrary record. | — |
| V7 | Launcher refresh, layout presets, read-only Runs view [app] | STANDS | Evidence record; HH:376. | — |
| V8 | Restore across quits and killed service; failed, fixed, passed on re-run [app, packaged] | STANDS | HH:305-349. Agents ran it, not Txais, but it was seen in the running app. | — |
| V9 | Limit auto-resume continued a live Claude pane [app] | STANDS | HH:238-240. | — |
| V10 | Usage meter with real data [app] | STANDS | HH:204. | — |
| V11 | Pane header: branch, finished-ago, glow, narrow hiding [app] | STANDS | HH:170 (Txais chose). | — |
| V12 | Sixteen themes, Classic default, terminal follows app [app] | STANDS | HH:141 (Txais chose opt-in, keep today's look). | — |
| V13 | No theme or font flash [app] | STANDS | HH:121 (asked for by Txais). | — |
| V14 | New look: full-width top bar; Agents and Board without classic sidebar [app] | STANDS | HH:87-94. | — |
| V15 | Rounded windows, controls, expand and restore; resize drag not checked [app] | STANDS | HH:31, HH:37-38. | — |
| V16 | Every pane header shows title and usage; stepper and status-bar usage gone [app] | STANDS | HH:25. | — |
| U1 | Browser sign-in end to end in an installed build [handoff] | STANDS | REC handoff-recent-work.md: the real browser authorization flow is still listed as outstanding. | — |
| U2 | Graphics fallback after three strikes [test] | STANDS | Evidence record; no contrary record. | — |
| U3 | Packaged smoke test of CLI and migration; window never opened [test] | STANDS | Evidence record; no contrary record. | — |
| U4 | The 0.12.0 set, including "push-to-talk on mouse buttons", as shipped-but-unverified at 0.15.0 | WEAKENED | Txais removed desktop voice and dictation on 2026-10-05 (HH:98-102), which takes push-to-talk with it. Section 3e of the same draft lists it as removed. | Drop push-to-talk from U4 (it belongs only in 3e). The rest of U4 stands. |
| U5 | 0.13.0 business frame [commit] | STANDS | LOG 6acbb9f36. | — |
| U6 | Protected actions never tried live [test] | STANDS | HH:291-293. | — |
| U7 | 200k context cap on by default [handoff] | STANDS | LOG b5e2d4bef; REC handoff-recent-work.md. | — |
| U8 | Weekly usage pill with real data [handoff] | STANDS | HH:37-38 (real data not verified). | — |
| U9 | Hidden tabs count toward graphics limit; lower memory [handoff] | STANDS | HH:17 (resource wave, because Txais saw heavy RAM and CPU). | — |
| U10 | Audit fixes [test] | STANDS | HH:8. | — |
| U11 | Public release on every ship, 30-minute checks, restart prompt; install from them not recorded [handoff] | STANDS | HH:11; REC releases.txt. | — |
| U12 | Artifacts library [handoff] | STANDS | LOG 3674def6a (10-06). | — |
| U13 | Folded Thought rows and card-style agents [commit] | STANDS | LOG c697f1065 (10-06); HH:93. | — |
| G1 | No way to sign out of a Kolux account after the page was trimmed | WEAKENED | Txais chose to remove the Kolux Account page (HH:98-99, 2026-10-05), and cloud features were removed on purpose (HH:59-62). The missing sign-out follows from his removal; it is not a defect he would want fixed. | Move to a note under 3e ("account sign-out went with the removed account page"), not a known gap. |
| G2 | Meter local only; Codex and Grok plan usage only | STANDS | HH:241. | — |
| G3 | Auto-resume Claude only | STANDS | HH:241. | — |
| G4 | Context cap skips native chat, one remote revive path, Grok | STANDS | REC handoff-recent-work.md. | — |
| G5 | Protected actions do not cover Codex | STANDS | HH:291-293. | — |
| G6 | Conversation resume after restore never run | STANDS | HH:305-349. | — |
| G7 | Existing profiles stay classic until opt-in | STANDS | HH:93. | — |
| G8 | Two automated tests fail, on main too | STANDS | HH:10; REC handoff-recent-work.md (10-06 green bar, 2 known failures). | — |
| G9 | Unsigned; Mac and Linux not released | STANDS | Evidence record; REC releases.txt. | — |
| G10 | Agent dashboard off by default; shortcut does nothing | STANDS | Evidence record; no contrary record. | — |
| G11 | Orchestration split: app view read-only, work from CLI | STANDS | Evidence record. | — |
| G12 | Layout presets untested with scrollback, acceleration, menu | STANDS | Evidence record. | — |
| G13 | Full suite noisy on Windows; Linux CI is the check | STANDS | HH:1069-1077. | — |
| H1 | Multi-select stage/unstage (VIEW-118) | STANDS | SPEC half-done state. | — |
| H2 | Live model list unused by picker (ACCT-032) | STANDS | SPEC half-done state. | — |
| H3 | Projects roadmap timeline (GIT-057) | STANDS | SPEC half-done state. | — |
| H4 | Newcomer checklist (ONB-013) | STANDS | SPEC half-done state. | — |
| H5 | Release gate written, packaged check not run (APP-061) | STANDS | SPEC half-done state; LOG 1181eb69f. | — |
| E1 | "Tried and reverted: … the workspace composer launcher (2026-09-16)" | REFUTED | Same evidence as C6: HH:704-721. What was dropped on 09-16 was an unmerged rewrite branch built on the 0.5.0 base; the composer stayed in 0.7.0. | "Tried and reverted: one window per terminal (2026-09-15); a launcher rewrite (dropped 2026-09-16, never shipped)." |
| E2 | Sidebar search, timeline, agent grid, mode switch removed 09-22 | STANDS | HH:570 (owner's call). | — |
| E3 | OpenCode removed 09-23 | STANDS | HH:449 (owner's call). | — |
| E4 | Cloud features hidden 09-28, removed 10-05; mobile links removed 09-29 | STANDS | VB:28 (hide decided 09-24); tag v0.12.0; HH:59-62; LOG b83600a1f (09-29). | Do not cite LOG db7485d83 (10-05 23:58) as the removal date. Its subject says cloud and mobile features were removed, but the diff mostly deletes unused helpers. |
| E5 | Dashboard pop-out and Agent Map retired 10-05; drawer behind experimental flag | STANDS | LOG b5e2d4bef (retires the pop-out). | — |
| E6 | Desktop voice and dictation, Kolux account and input settings removed 10-05 [app] | STANDS | HH:98-99, HH:115 (Txais's choice, runtime-checked). | Add that Txais kept Mobile settings in the same call (HH:98-99). That call was then overtaken by his area-18 cut for the rebuild (SH:82). |
| E7 | Footer and message bar removed [test]; stepper and status-bar usage removed [app] | STANDS | HH:43-45, HH:83, HH:25. | — |
| E8 | Update nudge removed; upstream names scrubbed 10-05 [app] | STANDS | HH:49. | — |
| E9 | Off by default: native chat, pet, Activity feed, agent dashboard; dev-only profiles | STANDS | Evidence record; SPEC hidden 57, dev-only 9. | — |
| E10 | "Cut by Txais 2026-10-05: remote hosts (whole area) and 33 settings sections, as D cards" | WEAKENED | SH:82 (area 18 dropped, "No cards"; an inventory instead, D18) and SH:116-131. Several features behind the cut sections are kept with fixed defaults or CLI flags (orchestration, browser, floating workspace, automations, skills). Only some cut sections send a feature to D. The custom-agent builder is one of those D cuts, and the 10-06 direction wants it back (Missing M1). | "Cut by Txais 2026-10-05 for the rebuild: remote hosts (no cards; see inventory) and 33 settings sections. Some features behind those sections go to D, others keep fixed defaults." |

## E. Build-order rules (section 4)

| # | Rule | Verdict | Evidence | Correction |
|---|---|---|---|---|
| F1 | Walking skeleton: one window, one PowerShell terminal, one agent in its own worktree | STANDS | Matches the 09-16/09-17 pane calls and the 09-24 worktree call. | — |
| F2 | P0 by theme in rank order 1, 2, 3, 4, 7, 5, 9, 11, 8, 6, 10 | STANDS | Consistent with section 1. The only owner-intent risk is theme 6's position (B17). | If Txais confirms the 10-06 direction, theme 6's position goes to Needs Txais. |
| F3 | No-theme P0 after ranked themes (16) | STANDS | SPEC: 16 P0 with no theme. | — |
| F4 | P1 then P2 in same order | STANDS | — | — |
| F5 | H cards only where DECISIONS.md says build | STANDS | — | — |
| F6 | X cards replaced, never copied | STANDS | SPEC 12 X cards; HH:49 (Txais's originality cleanup). | — |
| F7 | D cards never planned | STANDS | SH:116 owner cuts. | Rule is right; see Missing M1 for one D card the owner's later direction contradicts. |
| F8 | Compat lines kept exactly | STANDS | — | — |
| F9 | Ranks never change tiers | STANDS | — | — |
| F10 | Secrets encrypted from the first card that stores one | STANDS | LOG 6acbb9f36 (0.13.0 encrypted at rest); REC business-frame.md key-vault module. | — |
| F11 | One description per screen (theme 7 wins) | STANDS | B8 (screens he picked on the canvas). | — |
| F12 | Dependencies move a card forward only when needed | STANDS | — | — |

## Missing

M1. **Custom agents vs the 2026-10-06 direction (changes theme 6 and theme 7 scope).** On 2026-10-06 Txais asked
for a universal AI IDE that non-coders can use (VU:12; VK:40-42). The same day he had 24 department
agents built for it (MEM kolux-department-agents) and decided in principle that the Agents tab
suggests all 24 (VU:177). VU:34 and VU:76 say custom agents already exist at 0.15.0 and that the 24 are
paste-ready for the custom-agent builder. The rebuild cut that builder to D on 2026-10-05 (SH:131;
spec cards SESS-045 in 02, VIEW-022 in 05), and SH:131 itself notes that the department-agent plan
wants a successor. PRIORITIES never mentions this. Put it under Needs Txais: the later direction
contradicts the earlier cut.

M2. **Design target depends on the cut builder.** The canvas Txais chose from (created 2026-09-29) names
"user-built agents" in its chosen direction, and its current-design board 8 is an Agents screen for
chatting with an agent you built (REC design-source.md). Theme 7 (rank 5) builds that screen. Without
the custom-agent builder, the Agents screen has nothing to chat with. Same Needs Txais item as M1.

M3. **Claude defaults to auto permission mode instead of bypass (owner call, 2026-10-05).** HH:31 says Txais
wanted auto mode instead of bypass; HH:37 confirms auto became the default; LOG 32a7b25c6 (2026-10-05).
This is a safety call (theme 5). It is missing from rank 6's why, from the 0.15.0 timeline row and
from 3b. Spec cards exist in 02 and 17. The rank does not change.

M4. **His own public headline for the week (2026-10-05).** VBL entry #1 is the LinkedIn draft for that week.
It lists four things: the usage meter, auto-resume on a limit, the Board view and safety checks before
risky commands, plus agents in their own copies of the project. That supports ranks 2, 4 and 5 and
gives theme 5 more weight than "sits below on headlines" suggests. The rank does not change.

M5. **Usage forecast with one-time 80% and 95% alerts (2026-09-29).** LOG 2d29a6548 (forecast in the status-bar hover, alerts deduped per window, warnings in Launch and kit setup). It is missing from theme 4's At 0.15.0, the 09-29 timeline row and the status lists. PLAN Part 2 had it.

M6. **The shared-checkout default that Txais reversed.** v0.7.0 (2026-09-15) made the launcher default to
shared-checkout seats (REC tags.csv; HH:722). On 2026-09-24 Txais reversed this to one worktree per agent
(VB:27). That is an owner reversal that strengthens rank 2.

M7. **Publish when checks pass (owner call, 2026-09-24).** VB:29 records it, and MEM says he chose it
explicitly. It is missing from rank 9's why. The rank does not change.

M8. **0.11.0 also shipped update checks in the installed app.** HH:376 and VK:46-49. Missing from the 0.11.0
timeline row.

M9. **The dictation flip-flop.** Dictation was removed in the 09-24 wave (LOG dab33254d, 2026-09-28 WIP),
kept in 0.12.0 (tag v0.12.0, 09-28), and removed by Txais on 2026-10-05 (HH:98-99). This is the reason
B12 and U4 are weakened. 3e should record it as a reversal.

M10. **Mobile kept, then cut.** In the 10-05 settings trim Txais chose to keep Mobile (HH:98-99). The same
day his area-18 rebuild cut took mobile with it (SH:82, SH:127). 3e should show both, so the clean
room does not read "keep Mobile" as current.

M11. **Spec counts drifted after the draft.** SPEC recount 2026-10-06 gives 228 P0 (212 with a theme), theme 1
with 20 P0, live-unverified 905, dropped 120 and retired 45. Rank 1's P0 cell and the section 1 and 3
headers need a recount at final assembly.

# Work unit bookkeeping

Items: T-025-d-rest, T-206-c, APP-052

## T-025-d-rest (triage: stale-already-done, effort S)

Why / what exists today:
Moot, not provable: the kit seat row this proof would show was deleted by T-568 "Remove starter kits entirely" (origin/main commit e5aeccaf, 2026-10-28: src/kits/KitStrip.tsx, src/kits/run.ts, src/kits/run.test.ts and src-tauri/src/kits.rs removed; no KitStrip/useKits/src/kits reference remains in src/). The underlying limit/sign-in stop causes still reach the window from the status hooks (more.rs:212 kolux_cause limit; src/board/paneStatus.test.ts), so the PLAN line should be dropped or re-pointed at the Board card, which is bookkeeping, not a build or a live run.

Scope to build (from the triage agent; verify every file:line yourself, the code may differ):
(bookkeeping only, see reason)

## T-206-c (triage: stale-already-done, effort S)

Why / what exists today:
Nothing can be built: commit e5aeccaf (Txais, 2026-10-28, 'T-568 Remove starter kits entirely') deleted src-tauri/src/kits.rs, src/kits/** and every kit command from lib.rs, so no kit entry point exists on any workspace; and remote, SSH and remote-runtime workspaces are dropped with area 18 (DECISIONS.md rows SESS-047, TERM-128, SKILL-033). SKILL-015's remaining box ('open a remote workspace → no kit entry point') is vacuously true. Close the line with a DECISIONS row citing T-568 and area 18. Doc gap for the coordinator: T-568 has no line in PLAN.md, PLAN-done.md, STATE.md or DECISIONS.md (grep finds it only in git history), and SKILL-011..015 are still ticked as built under T-206/T-206-b in PLAN-done.md:405-406 although the code is gone.

Scope to build (from the triage agent; verify every file:line yourself, the code may differ):
(bookkeeping only, see reason)

## APP-052 (triage: stale-already-done, effort S)

Why / what exists today:
Both boxes were already proven on the installed NSIS build (06242e15) by scripts/prove/live-T-544.mjs on 2026-10-28, started through WMI outside the harness job so the terminal service survives the quit: evidence/T-544.txt lines 38, 57, 66 (b1: three quit-and-relaunch rounds, the marker back each time, '2 terminals taken back', the service still running after every quit), lines 68-79 (b2: the one service tied to the install killed, relaunch shows the earlier output and '── restored after a restart · the shell below is new ──'), ITEM-RESULT b1 PASS / b2 PASS / RESULT: PASS (lines 95-98); PLAN.md:94 T-544 records the pass. The code is on main (terminal.rs generation and reattach, pty_link.rs:443 wanted() links the service in release builds, T-075 at PLAN-done.md:80). Only the spec ticks (spec/19-app-lifecycle.md:279-281), evidence/cards-APP-052.txt's 'ownership stays with T-544' note and the live doc's B-9 rows were never updated. If the integrator wants the proof on the current release rather than the trial build, `node scripts/prove/live-T-544.mjs` against the installed 0.1.5 is one command, not a manual B-9.

Scope to build (from the triage agent; verify every file:line yourself, the code may differ):
(bookkeeping only, see reason)

## Extra instructions for this unit
- APP-052: the triage says both boxes were already proven live on the installed build by scripts/prove/live-T-544.mjs (evidence/T-544.txt). Read that evidence yourself. If, and only if, it genuinely shows each box's wording passing on a real installed Windows build, tick the two boxes in spec/19-app-lifecycle.md in the house style `(live; evidence/T-544.txt lines N-M)` and write evidence/cards-APP-052.txt pointing at the exact lines. Otherwise leave them.
- T-025-d-rest and T-206-c: the kit code was removed by commit e5aeccaf (T-568). Check that commit's author and message with git show --stat e5aeccaf (never read the forbidden provenance folder named in LOOP.md section 0). Bookkeeping that is honest: close each PLAN line as moot with the reason and the commit, and make the record consistent: T-568 itself has no PLAN/DECISIONS line, and SKILL-011..015 may still be ticked as built although the code is gone. Find those cards' tiers. If Txais authored or explicitly asked for T-568, record a DECISIONS.md row (next free DT-C number; check the highest existing one) saying the starter kits and the cards they carried were dropped by Txais on 2026-10-28 with commit e5aeccaf, and if any of those cards is P0, add the strike in the form plan-check reads (`strikes CARD-nnn` ... `confirmed by Txais 2026-10-28` on the same line) ONLY when Txais's own act is clear from the commit; otherwise mark the row "confirm" so it strikes nothing and add a Needs-Txais note in your evidence file.
- Run node scripts/plan-check.mjs before and after; record both head lines in evidence/c5-bookkeeping.txt.

# Path to an A — cycle 1 report (2026-10-30)

Written for Txais at the end of cycle 1, in the order brief section 11 asks for. **This is not "done":** most
of the A conditions in brief section 3 are still open (see the last section).

## 1. plan-check

```
head: cutline left 0/18 · merge gate 0 waiting · P0 cards passing 208/228 · done 718/775 tasks
plan-check: OK
```

At the start of the day it read 683/772 tasks done, with 208/228 P0 cards passing.

## 2. PRs

**16 merged today, 0 open.** All 8 lanes are merged, and no lane is blocked in code.

| PR | What |
|---|---|
| #1 | Repo audit report: 190 findings, 104 confirmed |
| #2 | T-582: the cloud machine can prove changes (the Linux kill fix, test isolation) |
| #3 | T-620: the whole top bar moves the window (15/316 empty presses → 316/316) |
| #4 | Your release and PR decisions recorded (DT-R39, DT-C51) |
| #5 | cli lane: T-593, T-595, T-596, T-619, T-594 code |
| #6 | Lowercase scratch folder for Linux tests |
| #7 | review-editor lane: T-317, T-601–T-603 |
| #8 | reliability lane: T-565, T-597–T-600 |
| #9 | release-ci lane: T-587–T-592 |
| #10 | workspaces lane: T-613–T-617 |
| #11 | Old-Kolux material removed; reclaim guide and script for your PC |
| #12 | The Kolux project record (docs/history/kolux-project-record.md) |
| #13 | status-hooks lane: T-618, T-583–T-586 |
| #14 | PROJ-051 stamp race fix |
| #15 | safety lane: T-604–T-607 (8 review rounds on the protected-command reader) |
| #16 | product-ux lane: T-608, T-610–T-612, T-609 in part |

Every lane PR had a fresh-context review before it merged. The reviews caught real bugs before they reached main:

- an installer that could wipe the user PATH (#5);
- a note that could cover the window (#7);
- a lost Appearance save (#8);
- a failed update leaking processes (#9);
- a hook listener that a panic could kill (#13);
- about 25 ways to sneak a dangerous command past the protected-command check (#15);
- status lost for agents without a vendor mark (#16).

**Blocked from outside the code:** release and update proofs wait on your four GitHub steps. CI fails on every push
because of the Actions billing block, and per DT-C51 it is not a merge gate.

## 3. Cards newly passing

**None.** P0 cards stay at 208/228.

The cycle's ticks are code with real before/after unit or browser output in `evidence/T-582.txt`
to `evidence/T-620.txt`. The 20 open P0 cards each need a live Windows, installer or release proof, which this cloud
machine cannot give. Tasks still waiting on a live check carry "code done, live proof pending" on their PLAN line,
not a tick.

## 4. Needs Txais (one line each; details in STATE.md "Needs Txais")

- Create the public repo TxaisX/kolux-rs-releases, with a README.
- Give the Claude GitHub app access to that new repo.
- Lift the GitHub Actions billing block.
- Add the four release secrets (KOLUX_RELEASE_KEY, KOLUX_RELEASE_PUBKEY, KOLUX_RELEASE_KEY_PASSWORD,
  KOLUX_RELEASES_TOKEN).
- Archive TxaisX/kolux and TxaisX/kolux-releases.
- Run the reclaim steps in `docs/reclaim-old-kolux.md` on your PC.
- Should removing kolux from PATH last across updates?
- Mixed CRLF/LF files: option (a) or (b)?
- The T-585 question in STATE.md.
- Should the Inbox say Stopped, not "Done today", for an agent whose program has exited?
- Should Ctrl+J and the tab badges count only permissions and questions?
- Should a blocked pane (usage limit or sign-in) still count as needing you?

## 5. Cycle 2 assignments

1. **release:** once your steps are done, run release.yml for v0.1.0 and v0.1.1. Prove the self-update
   (T-622), the signed installer, and kolux on PATH (T-594). Fix CI until it is green on main.
2. **engineering:**
   - Split App.tsx (3,303 lines) toward the 800-line bar.
   - Remove the dead commands still registered in lib.rs (11 of the 13 named in the brief appendix).
   - Measure first-load size against 1.5 MB.
   - Time `pnpm test` from a clean shell.
3. **live proofs:** a Windows run list for the 20 open P0 cards and for the "live proof pending" tasks
   (T-594, T-604–T-612). Each item says what you press and what you should see.
4. **follow-ups:**
   - The two data-loss items in STATE.md: `kolux worktree rm` and detached-HEAD deletes.
   - The PR #15 and PR #16 review items.
   - T-609's sidebar count.
   - T-621, the Tower overlap.
5. **docs:**
   - Bring the in-app guide up to date: consent line, "Open a session", Stopped.
   - Generate STATE.md entirely from plan-check.
6. **rename to Kolux:** after the old app is uninstalled and the reclaim script has run.

## A conditions (brief section 3): where each stands

| # | Condition | Now |
|---|---|---|
| 1 | Completion: 228/228 P0, 0 open buildable tasks | 208/228; 57 tasks open |
| 2 | Release: signed release, updater proven, kolux on PATH, CI green | code ready; blocked on your steps |
| 3 | Product: hooks on with consent, one status, Review changes, no dead screens or commands | code merged (#16); live proof pending |
| 4 | Engineering: App.tsx < 800, 0 dead commands, first load < 1.5 MB, test < 3 min | not met: App.tsx 3,303 lines, 11 dead commands |
| 5 | Trust: safe defaults, no telemetry, threat model tested | hooks on with consent; the protected-command reader is hardened (#15); threat model not yet tested end to end |
| 6 | Docs: guide in app matches build; STATE generated | guide out of date in 3 files; STATE partly hand-written |
| 7 | Workspace: reclaim commands handed to Txais | **met** (docs/reclaim-old-kolux.md, PR #11) |

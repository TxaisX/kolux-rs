# Path to an A — cycle 2 report (2026-10-31)

This follows the shape of the cycle 1 report (brief section 11). Kolux is **not "done"**: most A conditions in brief section 3 are still open. See the table at the end.

## 1. plan-check

```
head: cutline left 0/18 · merge gate 0 waiting · P0 cards passing 208/228 · done 719/775 tasks
plan-check: OK
```

At the start of cycle 2 it read 718/775 tasks, with 208/228 P0 cards passing. The one new tick is T-622 (the live self-update), from before the lanes started. STATE.md's `Done:` head line was written by `node scripts/plan-check.mjs --write-state`.

## 2. PRs

**5 merged this cycle, 0 open, no lane blocked.** Every lane had a fresh-context review before it merged.

| PR | Lane | What |
|---|---|---|
| #18 | live-proofs | `docs/live-proofs-windows.md`: 43 checks for your PC (31 to run in one sitting, 12 not runnable yet); DT-C54 (GitHub CI is not used) |
| #19 | cli-path | T-594 redone: a PATH over 1,024 characters gets kolux from the app at its next start; uninstall removes only our entry at any length (DT-C55) |
| #20 | product-ux-2 | your three T-608 answers (DT-C52), the real changed-files count on by default (T-609), the Tower segment fits the switcher (T-621), the PR #16 follow-ups |
| #21 | data-loss | no workspace delete drops commits found nowhere else (`kolux worktree rm`, detached HEAD kept as `kolux/kept-…`, failed reads refuse; DT-C56); `find -delete`, `rimraf`, `[IO.Directory]::Delete`, `robocopy /MIR` and PowerShell wildcards are judged as deletes |
| #22 | engineering | App.tsx 3,315 → 221 lines; the 13 dead commands removed (456 → 443 registered); first load and test time measured |

Bugs the reviews caught before merge:

- An uninstall that was cancelled while Kolux was running would already have lost the PATH entry (#19).
- An agent that exited after finishing lost Review changes (#20).
- `find . -name '*.pyc' -delete` and `git push --delete` would have started asking (#21).
- Evidence that couldn't be checked against the baseline (#21).
- 10 wrong or missing steps in the Windows checklist (#18).

## 3. Cards newly passing

**None.** P0 is still 208/228. This cycle's work is code with real before/after test output. The 20 open P0 cards, and every "live proof pending" task, need a run on your Windows PC. They are all in `docs/live-proofs-windows.md`.

## 4. Needs Txais (one line each)

- Run `docs/live-proofs-windows.md` on your PC (about 5 hours, with a fresh install first). Write the results on the list.
- Install the next release so the PATH fix reaches you, then re-run steps A-1 and D-2 (kolux in a fresh cmd window, then uninstall).
- Mixed CRLF/LF files (T-603): option (a) or (b).
- Should removing kolux in Settings > CLI last across updates? Today the next update adds it back.
- The T-585 question in STATE.md: helper agents that keep a pane "working".
- Finish the PC part of `docs/reclaim-old-kolux.md`. The old GitHub repos are already gone.
- On GitHub, the repo's About text still says "Kolux RS (private backup)". It is public now, and only you can change that text.

## 5. Cycle 3 assignments

1. **first-load:** load CodeMirror, Lexical, highlight.js and the browser and PDF panes on first use, until the first frame is under 1.5 MB. It is 3.37 MB now.
2. **green tests:** make `pnpm test` pass from a clean shell. There are three failures: SET-006-link, which waits too short for the Shortcuts page, and the two richCodeColourTime timing limits.
3. **window store:** split shell/WindowView.tsx (1,077 lines) into per-surface parts behind a real store, and guard the source-test file list.
4. **follow-ups:**
   - the data-loss gaps: link start points, and `-delete` after an escaped group;
   - the git-status count running as a background read;
   - the guide's new Inbox group.
5. **live results:** tick the cards and tasks your run of the Windows list proves, and fix what it fails.
6. **rename to Kolux,** once the old app is gone from your PC.

## A conditions (brief section 3): where each stands

| # | Condition | Cycle 1 | Now |
|---|---|---|---|
| 1 | Completion: 228/228 P0 cards; 0 open buildable tasks | 208/228; 57 open | 208/228; 56 open. The rest need your Windows run |
| 2 | Release: signed release, updater proven, kolux on PATH, CI green | blocked on your steps | signed releases ship from your PC (DT-R40). Updater proven live, 0.1.1 → 0.1.2 (T-622). kolux on PATH: fixed in code, live re-run pending. CI: not used (DT-C54), so this part no longer applies |
| 3 | Product: hooks on with consent, one status, Review changes, no dead screens or commands | code merged | code merged, with your T-608 answers. Live check pending |
| 4 | Engineering: App.tsx < 800, 0 dead commands, first load < 1.5 MB, test < 3 min and green | not met | App.tsx 221 ✔. Dead commands 0 ✔. First load 3.37 MB ✘. Tests 1:52 ✔ but 3 failing ✘ |
| 5 | Trust: safe defaults, no telemetry, threat model tested | partly | more delete forms are now asked about, and deletes never drop unique commits. Threat model not yet tested end to end |
| 6 | Docs: guide in the app matches the build; STATE generated | not met | guide still out of date in 4 places; STATE head generated by plan-check, the rest hand-written |
| 7 | Workspace: reclaim commands handed to you | **met** | **met** (old repos removed) |

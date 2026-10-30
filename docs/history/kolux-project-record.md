# Kolux: the project record

Written 2026-10-30 for Txais Xiong, the owner. It covers everything done on Kolux so far: the
dates, the sessions and agents that did the work, the numbers, what works, and what is still open.
Every number comes from a file in this repository or from a command; the source is named under each
table. Where a number was never recorded, this page says so instead of guessing.

A note on the name: the app was built under the name **Kolux RS** (the repository is still
`TxaisX/kolux-rs`, and older files use that name). On 2026-10-30 Txais decided the app is simply
**Kolux** from now on, so this record calls it Kolux.

---

## 1. What Kolux is, and why it was rebuilt clean-room

Kolux is a Windows desktop app for running many AI coding agents (Claude Code, Codex and others)
side by side: a grid of terminal panes, each agent in its own git worktree so they never step on
each other, a Board and an Inbox that show which agent is working, done or waiting for you, live
usage limits, safety checks before risky commands, and a `kolux` command for driving it from any
terminal. The first Kolux (up to version 0.15.x, early October 2026) grew out of someone else's
MIT-licensed app, so part of its code was not Txais's own. The rebuild started from nothing so that
every line belongs to Txais. To make that provable it was done "clean-room": one team read the old
app and wrote only a description of what the user does and sees (the spec, 2026-10-06); an
automated firewall checked that description for code, names and copied text; and the builders
worked from the description alone and never saw the old code. `LOOP.md` section 0 holds the rule
and `PROVENANCE.md` holds the evidence. The new app is a Tauri 2 app with a Rust core and a React
front end.

---

## 2. Timeline

### 2a. Phases

| Date | What happened |
|---|---|
| 2026-10-05 | Txais cuts remote hosts (spec area 18) and 33 settings sections from the rebuild's scope. |
| 2026-10-06 | Phase 1, the spec: the extraction team writes 21 areas of feature cards, `PRIORITIES.md`, `COMPAT.md`, `DECISIONS.md` and `PROVENANCE.md`; the firewall checks them. First commit: "Kolux RS spec: the clean-room rebuild starts here". |
| 2026-10-07 | Phase 2, the plan: 338 ordered tasks from the spec, with a coverage check (`scripts/plan-check.mjs`). Phase 3 starts the same day: T-001, the first window. |
| 2026-10-08 | The walking skeleton: one PowerShell pane (T-002), a project with a workspace on its own branch (T-003). |
| 2026-10-09 to 10-12 | The single builder loop turns into parallel lanes (accounts, core, release, then orchestration and worktrees). Plan grows to 480 tasks. |
| 2026-10-13 | The freeze: the firewall's allowlist and baseline are frozen and the extraction team's raw evidence leaves the tree. The numbered merge gate begins (MERGE 17 to 59 that day), with council reviews. First P0 cards counted as passing (6). |
| 2026-10-14 | Lane work continues (MERGE 60 to 91). |
| 2026-10-19 to 10-20 | The busiest build days: up to 21 lanes logged in one day, MERGE 92 to 262. An audit unticked tasks that had no evidence reading ("audit-9"). |
| 2026-10-22 | Fix lanes merge (MERGE 263 to 269); final smoke 4/4. |
| 2026-10-25 | First-day UX audit (`docs/research/ux-audit-2026-10-25.md`); release work ported across; fix lanes (MERGE 270 to 309). P0 cards passing jumps from 6 to 32. |
| 2026-10-26 to 10-28 | Proof work: card-proving lanes and live provers run real Claude sessions against the acceptance boxes. P0 passing goes 32 to 154 to 195 to 208. Last numbered merge, MERGE 429, on 10-28. Evening of 10-28: launch and agents rework (kits removed, launch chooser, agent dropdown with Install; `docs/research/launch-agents-rework-2026-10-28.md`). |
| 2026-10-29 | Path-leak fix lane (T-580, T-581); CI set to four Linux shards plus one Windows Rust job. |
| 2026-10-30 | The whole-repo audit (PR #1) and "Path to an A" cycle 1: 8 lanes, PRs #2 to #10 (section 2c). |

Sources: `git log` of `main` (first commit, commit subjects and dates), `PROVENANCE.md` sections 1
and 4 ("Freeze (2026-10-13)"), `PRIORITIES.md` section 2, `STATE-history.md` lane tags, STATE.md's
"Done" line read from git at the end of each day.

### 2b. The build loop: passes and lanes by day

A "pass" is one unit of builder work: read the rules, take one task, prove it, commit, log it. Each
pass leaves a dated line in `STATE-history.md` (or STATE.md's "Last 10 passes"). The lane names
show which part of the app the line belongs to.

| Date | Dated lines in STATE-history | Lanes named in those lines |
|---|---|---|
| 2026-10-07 | 9 | (none yet: single builder) |
| 2026-10-08 | 24 | (none yet) |
| 2026-10-09 | 113 | accounts, core, release |
| 2026-10-11 | 36 | accounts, core, release |
| 2026-10-12 | 130 | accounts, core, orchestration, release, worktrees |
| 2026-10-13 | 51 | accounts, orchestration, worktrees |
| 2026-10-19 | 43 | 11 lanes, among them automations, cli, hooks, repo, worktrees |
| 2026-10-20 | 99 | 21 lanes, among them editor, hooks, onboarding, repo, shell |
| 2026-10-25 | 7 | fix-other, release-port |
| 2026-10-26 | 5 | prove, ux |
| 2026-10-27 | 11 | prove, ux |
| 2026-10-28 to 10-30 | a few long lines each | prove, fix-pathleak, then the 10-30 lanes |

Sources: `grep -oE '^- 20..-..-..' STATE-history.md | sort | uniq -c` and the `[lane]` tags on
those lines. Many later merges were logged only in commit messages, not as pass lines, so this
table undercounts the work after 2026-10-20; the commit table in section 4 is the fuller measure.

### 2c. 2026-10-30: the audit and "Path to an A", cycle 1

1. **The audit (PR #1).** A read-only audit of the whole repository at commit `f564c0f`: about
   139,000 lines of Rust and 137,000 of TypeScript. 25 auditors reported 194 findings; reviewers
   told to knock them down confirmed 104 and refuted 4, and 12 stayed high. Its verdict: "not ready
   for a stranger yet". The four groups that matter most: someone else's content acting on your
   computer, risky commands skipping your approval, losing work or running agents, and broken
   updates, releases and `kolux` setup. 167 shortcut notes in the code were judged one by one.
2. **The plan.** `PLAN.md` section 8 turned the findings into 41 tasks, each naming the finding it
   closes, with no new features. Done means a test that failed before the change and passes after.
3. **The lanes.** Eight lanes ran at once, each in its own worktree on the cloud machine, each a
   workflow of build, then a fresh reviewer, then fix rounds (section 3c).
4. **Integration.** The integrator merged each lane with `main`, ran the full checks, sent each PR
   to a fresh-context reviewer, fixed what it found, and merged. Five lanes were merged as PRs #5
   and #7 to #10. Txais also asked for the top bar to drag from anywhere (PR #3) and made the
   release and PR decisions (PR #4).
5. **Result.** 24 of the 41 cycle-1 tasks are ticked; 17 are open, mostly in the status-hooks,
   safety and product-ux lanes, which were not yet merged into `main` when this record was written.

Sources: `docs/research/repo-audit-2026-10-30.md` and its three companion files, `PLAN.md`
section 8, the integrator's session notes, `git log --merges`.

---

## 3. Sessions and agents

### 3a. How the work was organised

| Role | What it does |
|---|---|
| Extraction team ("dirty room") | Read the old app on 2026-10-06 and wrote the spec. Never wrote code. |
| Firewall | An automated check of the spec for code, names and copied phrases. Frozen 2026-10-13. |
| Builder loop | One agent, one task per pass, by the rules in `LOOP.md`: test first, prove it, commit, log it in STATE. Ran on Txais's Windows PC. |
| Lanes | From 2026-10-09 the builders split into lanes: one branch per area of the app (`lane/<name>`), each in its own worktree, run in parallel. |
| Coordinator and merge gate | Took finished lane branches into `main` one at a time, each as a numbered "MERGE n" with gates (build, clippy, tests, firewall, smoke test). |
| Councils | Review panels that read a lane branch before or after merge and sorted what they found into fix-now, fix-soon and after items (lines tagged "council", branches `lane/council-fable` and `lane/council-opus`). |
| Live provers | Agents that ran real Claude sessions in the built app to tick spec acceptance boxes ("live-prover" and "live batch" runs, numbered up to 15). |
| Reviewers | Fresh-context agents that read a change with no history of how it was made. On 2026-10-30 every lane and every PR had one. |
| Integrator | The 2026-10-30 cloud session: ran the audit, launched the 8 lanes, merged, checked and opened the PRs. |

Sources: `LOOP.md` sections 0 to 4, `PROVENANCE.md` section 1, `STATE-history.md` (council,
coordinator and live-prover lines), `git ls-remote --heads origin`.

### 3b. What can be counted, and what cannot

| Measure | Count | Notes |
|---|---|---|
| Lane branch names in merge commits | 63 | Busiest: fix-other 68 merges, hooks 38, editor 37, reliability 34, fix-repo 32, browser 30 |
| Lane names in `STATE-history.md` pass lines | 11 distinct | Many lanes logged only in commits |
| Dated lines in `STATE-history.md` | 736 | Plus 10 in STATE.md "Last 10 passes"; roughly one per pass |
| Numbered merge-gate merges | MERGE 17 to MERGE 429 | 2026-10-13 to 2026-10-28 |
| All merge commits on `main` | 725 | Includes merges of `main` back into lanes |
| Live prover runs | numbered up to 15 | 8 are named in `STATE-history.md` |
| Sessions before 2026-10-30 | **not recorded** | No file counts sessions or agents per session |
| Tokens and time before 2026-10-30 | **not recorded** | Only today's lanes have them (3c) |

Sources: full history of `main` (`git rev-list --merges --count`, merge subjects), `STATE-history.md`.

### 3c. Today's 8 lane workflows (2026-10-30)

Each lane ran as one workflow in its own git worktree: a builder, then a fresh reviewer, then fix
rounds.

| Lane | Agents | Tokens | Time | Tasks done | Partial |
|---|---|---|---|---|---|
| status-hooks | 5 | not recorded | not recorded | T-618, T-583, T-584, T-585, T-586 | T-566 |
| release-ci | 4 | ~1.17 M | 113 min | T-587 to T-591 | T-592 (finished at integration) |
| cli | 4 | ~1.25 M | 90 min | T-593, T-595, T-596, T-619 | T-594 (live install pending) |
| reliability | 4 | ~1.22 M | 98 min | T-565, T-597 to T-600 | none |
| review-editor | 4 | ~1.12 M | 93 min | T-317, T-601 to T-603 | none |
| safety | 4 | ~1.21 M | 143 min | T-604, T-605, T-607 | T-606 (patch at integration) |
| product-ux | 5 | ~1.23 M | 104 min | T-608, T-610, T-611, T-612 | T-609 |
| workspaces | 4 | ~1.05 M | 100 min | T-613 to T-617 | none |
| **Total** | **34** | **~8.25 M for 7 lanes** | **741 min for 7 lanes** | | |

Before the lanes, the audit ran as 7 workflow runs of 2 to 24 agents each (their exact agent
total, tokens and times are not recorded). "Tasks done" is what each lane reported; the tick in
`PLAN.md` only lands when the lane is merged into `main`, which by this record was true for
release-ci, cli, reliability, review-editor and workspaces.

Sources: the integrator's session metrics (scratchpad `session-metrics.md`), totals added up from
its rows; `PLAN.md` section 8.

Fresh reviews caught real bugs before merge: PR #5 (the installer could wipe the user PATH;
evidence without real output), PR #7 (a note could cover the whole window), PR #8 (the Appearance
save race lost the last change), PR #9 (a failed update launch left processes running), plus small
fixes on PRs #2 and #3. Two incidents on the cloud machine: a Linux test run in the audit killed
every process (fixed in T-582), and the disk filled twice (about 16 GB, then about 8 GB, cleared).

---

## 4. Metrics

### 4a. Tasks done and P0 cards passing, over time

| End of day | Tasks done / total | P0 cards passing (of 228) |
|---|---|---|
| 2026-10-07 | 1 / 338 | 0 |
| 2026-10-08 | 6 / 339 | 0 |
| 2026-10-09 | 55 / 353 | 0 |
| 2026-10-11 | 78 / 373 | 0 |
| 2026-10-12 | 212 / 480 | 0 |
| 2026-10-13 | 379 / 621 | 6 |
| 2026-10-14 | 439 / 682 | 6 |
| 2026-10-19 | 531 / 710 | 6 |
| 2026-10-20 | 666 / 721 | 6 |
| 2026-10-22 | 661 / 721 | 6 |
| 2026-10-25 | 675 / 726 | 32 |
| 2026-10-26 | 680 / 730 | 154 |
| 2026-10-27 | 682 / 731 | 195 |
| 2026-10-28 | 682 / 731 | 208 |
| 2026-10-29 | 682 / 731 | 208 |
| 2026-10-30, after PR #10 | **709 / 775** | **208** |

The total keeps growing because each review files new tasks; the dip on 10-22 is tasks unticked
for lack of evidence. On 2026-10-30, 27 tasks were ticked and 44 added (the audit's tasks). P0
cards stayed at 208 today because a card is only ticked after a live Windows proof. Today
`plan-check` also reports the 18-task cutline fully done (0 left) and 1,264 cards in the spec,
1,030 of them planned.

Sources: the "Done:" line of `STATE.md` read from git at each day's last commit on `main`
(`git show <commit>:STATE.md`); today's row from `node scripts/plan-check.mjs` (OK).
`STATE-history.md` itself only records P0 counts on 10-27 and 10-28 (195, 198, 199), which match.

### 4b. Commits per day

| Date | Commits | Date | Commits |
|---|---|---|---|
| 2026-10-06 | 1 | 2026-10-19 | 416 |
| 2026-10-07 | 2 | 2026-10-20 | 337 |
| 2026-10-08 | 8 | 2026-10-22 | 12 |
| 2026-10-09 | 91 | 2026-10-25 | 243 |
| 2026-10-10 | 1 | 2026-10-26 | 319 |
| 2026-10-11 | 38 | 2026-10-27 | 230 |
| 2026-10-12 | 208 | 2026-10-28 | 112 |
| 2026-10-13 | 421 | 2026-10-29 | 5 |
| 2026-10-14 | 199 | 2026-10-30 | 72 |
| | | **Total** | **2,715** |

Merge commits: 725 in all, 19 of them on 2026-10-30 (10 PR merges into `main`, 9 merges of `main`
into lane branches). The working copy on the cloud machine holds only the last 231 commits
(from 2026-10-27), which is why the integrator's notes say "231 commits total"; the full history
on GitHub has 2,715.

Sources: `git log main --format=%ad --date=short | sort | uniq -c` on a full-history copy of
`origin/main` (commit data only, no file contents); `git rev-list --merges --count`.

### 4c. Evidence

| Kind | Files |
|---|---|
| Text readings (.txt) | 1,361 |
| Screenshots (.png) | 1,049 |
| Patches (.patch) | 34 |
| Probe scripts (.mjs) | 24 |
| Logs and data (.log, .json, .csv, .nsi) | 16 |
| **All files in `evidence/`** | **2,484** |

Of these, 392 distinct tasks (T-numbers) have their own evidence files, 230 files prove single
spec cards (`cards-...`), and 216 are smoke-test runs. 31 evidence files were added on 2026-10-30.
The integrator's notes say 2,444; the count above includes the subfolders (`prove`, `ux-shots`,
`raw`).

Sources: `find evidence -type f`, grouped by extension and file-name prefix;
`git log --diff-filter=A --since=2026-10-30 -- evidence`.

### 4d. Tests (latest recorded values)

| Suite | Latest recorded | Where and when |
|---|---|---|
| Front-end tests (vitest) | 5,052 / 5,052 pass | Release-ci lane integration, PR #9, 2026-10-30 |
| Rust tests on Linux (cloud) | 2,673 pass; 45 known Linux-only failures | Same run, PR #9 |
| Rust tests on Windows | 2,565 / 2,566 library tests (1 timing test passes alone), 246 / 246 integration | T-580/T-581, 2026-10-29 |
| Smoke test (whole app) | 4 / 4 flows | T-580/T-581, 2026-10-29 |

No later full count was written down after PR #10; that PR's checks ran the changed tests only.

Sources: `STATE-history.md` (2026-10-29 fix-pathleak line, 2026-10-30 release-ci line),
`evidence/T-613.txt`.

### 4e. PRs merged on 2026-10-30

| PR | What it did |
|---|---|
| #1 | The repo audit report |
| #2 | T-582: the cloud machine can prove changes (and no longer kills every process) |
| #3 | T-620: the whole top bar moves the window |
| #4 | Txais's release and PR decisions recorded (DT-R39, DT-C51) |
| #5 | cli lane: T-593, T-595, T-596, T-619, plus T-594's code |
| #6 | Linux tests use a lowercase scratch folder |
| #7 | review-editor lane: T-317, T-601, T-602, T-603 |
| #8 | reliability lane: T-565, T-597 to T-600 |
| #9 | release-ci lane: T-587 to T-592 |
| #10 | workspaces lane: T-613 to T-617 |

Sources: `git log --merges` on `main`, the integrator's session notes.

---

## 5. What works today

In plain terms (from STATE.md's "What works today" and today's merges):

- **A grid of agents.** 1 to 12 terminal panes per workspace, each running PowerShell, Claude
  Code, Codex or another installed agent; split, resize, expand, tabs, browser tabs beside them.
- **One worktree per agent.** Each workspace is its own git branch and folder; create, switch and
  remove them from the sidebar. Deleting one now names commits that exist nowhere else and keeps
  the branch by default.
- **Knowing what each agent is doing.** Agents report their state through hooks: working, done,
  waiting for permission, asking a question. The Board shows them as cards with Approve and Deny;
  the Inbox lists what needs you; desktop notifications on finish and permission.
- **Usage.** A live pill with Claude and Codex usage figures and countdowns.
- **Safety.** Claude Code asks before force-pushes to main, hard resets, database drops, production
  deploys and deletes outside the workspace; file access stays inside your projects; notes, plans
  and chat can no longer restyle the window.
- **No lost work.** Quit and reopen: workspaces, tabs and layouts come back, and Claude Code and
  Codex tabs resume their own sessions. A slow start no longer wipes saved tabs; Settings keep what
  you typed when a save fails; the crash screen never reloads while you write a report.
- **The `kolux` command.** Drives Kolux from any terminal; `kolux open` starts it; Register finds
  the installed command; the installer adds it to PATH.
- **Editor.** Notes keep their line endings; table edits no longer delete text; log files can be
  followed.
- **Window.** The whole top bar drags the window.
- **Releases.** A tested release path, pinned and signed release job, upgraded libraries that
  close known holes.

### Still needs a live check on Windows

These are built and tested on the cloud machine, but need one run on the installed Windows app:

- Escape in Settings, the Usage Share card and the Send feedback box (T-565).
- A start whose settings take over 1.5 s to read: wait tabs must not take over saved tabs (T-597).
- The installer adding and removing the `kolux` folder on PATH (T-594).
- A downloaded update installing and Kolux coming back; Restart Kolux and both safe-graphics
  restarts (T-592, APP-025, APP-043).
- A real release run (APP-059, APP-060): needs the CI billing block lifted and the signing secrets.
- The editor fixes (T-317, T-601 to T-603) and the browser frame refusal (T-607).
- Idle-agent prompt-cache timer on a real Claude agent (T-265-b).

Sources: `STATE.md` (opening paragraph, Needs Txais), `STATE-history.md` 2026-10-30 lines,
`PLAN.md` section 8.

---

## 6. Open items and decisions waiting for Txais

**Steps only Txais can take**

1. **Self-updating installs (T-622).** Create the public repository `TxaisX/kolux-rs-releases`
   with a README; give the Claude GitHub App access to it; lift the GitHub Actions billing block;
   add the four release secrets. Then the integrator publishes v0.1.0 and v0.1.1.
2. **Mixed line endings (T-603).** Pick (a) show every line and save the file exactly as it was,
   or (b) show every line and convert the file to one line ending on the next save.
3. **Optional:** should CI fail on every new high-severity library advisory? Not added until yes.
4. **Optional:** protect the release job with a GitHub environment that needs your approval.
5. **Optional question:** should removing `kolux` in Settings > CLI stick across updates? Today the
   next update adds it back.
6. **13 recorded defaults marked "confirm"** in `DECISIONS.md` section 2 (sign-in, fork PRs, WSL,
   fonts, vendor marks and others). The loop builds each default until told otherwise.

**Follow-ups found in review, not built yet**

- Data-loss risks found in the PR #10 review: `kolux worktree rm` can delete a branch whose
  commits are nowhere else; deleting a detached workspace can lose commits; two smaller checks
  in the same code.
- A rare case where two slow starts in a row could attach a wait tab to an old terminal.
- Crash reports for crashes nobody reported before the reload; some settings writers do not tell
  the window they saved.
- Release job: sign in a separate job; tighten the licence check; more headroom on one timing test.
- One known flaky test (Shortcuts page link).
- Lanes not yet merged: status-hooks, safety and product-ux (17 open cycle-1 tasks in all), and
  the switcher overflow (T-621).
- The removal of the old app's files from this machine was in progress as a separate PR.

Sources: `STATE.md` "Needs Txais" and "Follow-ups", `DECISIONS.md` section 2, `PLAN.md` section 8.

---

## 7. Where everything lives

| File | What it holds |
|---|---|
| `docs/history/kolux-project-record.md` | This record |
| `LOOP.md` | The rules every builder follows, including the clean-room rule |
| `STATE.md` | Today's status, what works, what needs Txais |
| `STATE-history.md` | Every dated pass and decision line (append-only) |
| `PLAN.md`, `PLAN-done.md` | Open and ticked tasks |
| `SPEC.md`, `spec/` | The 21 spec areas and their cards |
| `PRIORITIES.md` | The ranked themes and build order |
| `DECISIONS.md`, `DECISIONS-history.md` | Every choice, open, made or dropped |
| `PROVENANCE.md` | Where everything came from: the clean-room evidence (645 dated source lines) |
| `COMPAT.md` | Contracts to keep: `kolux` words, hook events, keybindings |
| `evidence/` | 2,484 proof files |
| `docs/research/` | The 2026-10-25 UX audit, the 2026-10-28 launch rework, the 2026-10-30 audit (4 files) |
| `docs/guide/` | The user guide (11 pages, including a feature index of every finished task) |

**GitHub pull requests** (all merged 2026-10-30, repository `TxaisX/kolux-rs`):
[#1](https://github.com/TxaisX/kolux-rs/pull/1) ·
[#2](https://github.com/TxaisX/kolux-rs/pull/2) ·
[#3](https://github.com/TxaisX/kolux-rs/pull/3) ·
[#4](https://github.com/TxaisX/kolux-rs/pull/4) ·
[#5](https://github.com/TxaisX/kolux-rs/pull/5) ·
[#6](https://github.com/TxaisX/kolux-rs/pull/6) ·
[#7](https://github.com/TxaisX/kolux-rs/pull/7) ·
[#8](https://github.com/TxaisX/kolux-rs/pull/8) ·
[#9](https://github.com/TxaisX/kolux-rs/pull/9) ·
[#10](https://github.com/TxaisX/kolux-rs/pull/10)

Sources: `ls`, `grep -c '^> 20' PROVENANCE.md`, `find evidence -type f | wc -l`.

# PRIORITIES

What Txais pushed hardest in the old Kolux, when each release landed and why, where version 0.15.0
stood on 2026-10-06, and the order the rebuild follows. Behaviour only. Written by the dirty-room
team on 2026-10-06 and revised the same day after two adversarial reviews; every rank and status
claim has a matching line in the dirty room's evidence and review records, which the clean room
never opens.

## 0. How to use this file

The 11 themes keep their numbers 1–11 for life. A card's Pushed line in the spec points at
one of these numbers. Section 1 lists the themes in **build order** (rank), which is not the same as
their number: theme 7 builds fifth. Ranks change the order cards are built in, never a card's tier.

Read section 4 when writing PLAN.md: it is the sort rule, and it agrees with LOOP.md section 2.
Sections 2 and 3 are background: what each release was for, and which old behaviours were seen
working, which were only claimed, and which were left unfinished. Treat "seen working" as the
strongest hint about what Txais relies on; treat everything else as described but unproven.

## 1. Themes, ranked

How a rank was set: sustained effort (commits whose subject matches the theme, out of 252
non-merge commits over 17 commit days from 2026-09-10 to 2026-10-06; merge commits are left out,
and one commit can match several themes), times the calls Txais recorded himself, times how often
the theme led a release headline. Commit subjects understate work that was large in size: the week
of 2026-09-28 to 10-04 was by far the biggest (about two and a half times the changed lines of any
other week) and carried the isolation launcher rework and the whole business-user push. P0 counts
are from the spec as recounted on 2026-10-06 (228 P0 cards: 212 with a theme, 16 without); recount
them if the spec changes.

| Rank | No. | Theme | Commits / days | P0 cards |
|---|---|---|---|---|
| 1 | 1 | Session-per-pane terminal grid | 76 / 16 | 20 |
| 2 | 2 | Isolation: one worktree per agent | 16 / 8 | 21 |
| 3 | 3 | Knowing what each agent is doing | 25 / 9 | 42 |
| 4 | 4 | Accounts, sign-in and usage limits | 26 / 6 | 22 |
| 5 | 7 | Redesign and the new look | 34 / 9 | 24 |
| 6 | 5 | Safety and trust | 16 / 6 | 21 |
| 7 | 9 | Reliability and no lost work | 9 / 5 | 20 |
| 8 | 11 | Orchestration and automations | 5 / 2 | 31 |
| 9 | 8 | Release, update and CI pipeline | 34 / 12 | 7 |
| 10 | 6 | Business-user frame | 32 / 4 | 4 |
| 11 | 10 | Identity and originality | 11 / 5 | 0 |

No theme was merged or split, and no number changed. Against number order, theme 7 and theme 9
each moved up two places and theme 11 up three; themes 5, 8 and 10 moved down one and theme 6
down four. The reasons are under each theme.

### Rank 1 · Theme 1 · Session-per-pane terminal grid
- **For the user:** every agent session is its own live terminal pane in one window, laid out in a
  grid he can split, expand and restore.
- **Why first:** touched on 16 of the 17 commit days, more than any other theme, and one of the two
  busiest areas of the old code (about 90 commits each). Txais made the most recorded calls here:
  every new session in its own pane (2026-09-16), one session per pane with sessions listed in the
  sidebar (2026-09-17), and removing the strip under each pane entirely (2026-10-05). Three straight
  releases led with it (0.6.0, 0.7.0, 0.8.0); the one-window-per-terminal try was reverted the
  same day it shipped.
- **Evidence:** tags v0.6.0, v0.7.0 (2026-09-15) and v0.8.0 (2026-09-16); handoff entries dated
  2026-09-15, 09-16, 09-17 and four on 2026-10-05.
- **At 0.15.0:** each session opens in its own rounded pane with controls on every pane,
  expand-to-fill and restore; every pane header shows the title and usage; no footer or message
  bar under panes; saved grid layouts; hidden tabs count toward the graphics limit.

### Rank 2 · Theme 2 · Isolation: one worktree per agent
- **For the user:** when he launches two or more agents on a git project, each works in its own
  copy of the code, so they never trample each other.
- **Why second:** it is the product's one-sentence promise in the old project's own description.
  Txais decided it as the default on 2026-09-24, reversing the shared-checkout default that 0.7.0
  had set on 2026-09-15, and it was the first item of the 0.12.0 headline. Few commit subjects name
  it (16), but making it the default was a large launcher rework on 2026-09-28 and 09-29; the
  decision is what matters.
- **Evidence:** owner decision 2026-09-24 (vault); tag v0.7.0 (2026-09-15, shared seats by
  default); tag v0.12.0 (2026-09-28); launcher commits 2026-09-28 and 09-29; the old project
  description; the 09-22 handoff entry is about the build workflow, not the product default.
- **At 0.15.0:** launches with shapes (Solo, Pair, Workbench, Swarm), seat counts, roles and saved
  shapes; one worktree per agent by default for two or more seats; the shared folder one click
  away; Review changes before shipping.

### Rank 3 · Theme 3 · Knowing what each agent is doing
- **For the user:** at a glance he can tell which agent is working, waiting on him, stopped or
  finished, and why.
- **Why third:** the largest P0 set in the spec (42 cards), effort spread over 9 days, and it led
  parts of two headlines: plan review in 0.11.0, and the Stopped state, quiet-agent alerts and
  sign-in expiry notices in 0.12.0. The 2026-10-05 pane header with its finished glow continues it.
- **Evidence:** tags v0.11.0 (2026-09-24) and v0.12.0 (2026-09-28); handoff entries 2026-09-23
  (plan review) and 2026-10-05 (pane header).
- **At 0.15.0:** status reported by agent hooks (working, blocked, waiting, done, stop cause); a
  Stopped state; quiet-agent alerts; sign-in expiry notices; plan review before Claude runs it; an
  Inbox of things that need him; a glow on panes that finished while he looked away.

### Rank 4 · Theme 4 · Accounts, sign-in and usage limits
- **For the user:** he signs in once, can see how much of each limit he has used, and a session
  that hits a limit picks itself back up.
- **Why fourth:** it led two headlines (browser sign-in in 0.9.0; the context cap, limit
  auto-resume and usage meter in 0.14.0). On 2026-09-28 the build kept self-refreshing Claude
  sign-in as the default and added an opt-out; no owner call is recorded for that default, so it
  is an open question for Txais (end of this section).
- **Evidence:** v0.9.0 commit (2026-09-21); handoff entry 2026-09-28 (sign-in opt-out); usage
  forecast commit 2026-09-29; untagged 0.14.0 commit (2026-10-05); three handoff entries on
  2026-10-05.
- **At 0.15.0:** Claude and Codex browser sign-in; Connect cards for API keys; sessions capped at
  200k context and auto-compacted (on by default); Claude resumes after its limit window
  (opt-in); a per-session usage meter; a forecast of when each Claude or Codex limit window runs
  out, with one-time alerts at 80 % and 95 %; one weekly usage pill top right.

### Rank 5 · Theme 7 · Redesign and the new look
- **For the user:** the app opens on calm Agents, Board or Terminals screens with a full-width top
  bar, rounded session windows and his choice of colour theme.
- **Why fifth (moved up from 7):** one of the two most concentrated pushes of the project (with
  theme 6). Of its 34 commits, 21 landed on 2026-10-04 and 10-05; six of the fifteen 2026-10-05
  handoff entries are this theme. It was in the 0.14.0 headline after the theme 4 items, and the
  full redesign landed later on 2026-10-05, after the 0.15.0 version bump. Txais picked the target
  screens himself on a design canvas started 2026-09-29. Building it early also avoids building an
  older look and reworking it.
- **Evidence:** design canvas created 2026-09-29; workspace-views commits 2026-09-29 and 09-30;
  five new-look screens committed 2026-10-04; untagged 0.14.0 commit and redesign landing
  2026-10-05.
- **At 0.15.0:** Agents, Board (one live terminal per card) and Terminals screens; a new-session
  page with saved teams; pane header with branch and finished time; 16 colour themes with
  Classic as default; no theme flash at start. Existing profiles had to opt in to the new look.

### Rank 6 · Theme 5 · Safety and trust
- **For the user:** his keys are stored encrypted, dangerous commands pause for him, and secrets
  are masked in what he sees and shares.
- **Why sixth:** steady but smaller effort (16 commits); it closed the 0.13.0 headline (sign-ins
  encrypted at rest) and drove the 2026-10-06 audit fix wave. Protected actions came from the
  2026-09-24 competitor-lessons improvement list (a second-priority card there) and shipped
  2026-09-29. Txais made one recorded safety call: on 2026-10-05 he asked for Claude sessions to
  start in auto permission mode instead of skipping permissions, and that became the default. His
  own draft post for that week (2026-10-05, not yet posted) names the safety checks as one of four
  highlights, beside the usage meter, auto-resume and the Board. It sits below theme 7 on effort
  and headlines; section 4 still makes its storage rule apply from the first card that stores a
  secret.
- **Evidence:** untagged 0.13.0 commit (2026-09-28); improvement list 2026-09-24 (vault);
  handoff entries 2026-09-29 (protected actions), 2026-10-05 (auto permission mode) and
  2026-10-06 (audit fix wave); an audit written 2026-10-04; draft build-log post 2026-10-05.
- **At 0.15.0:** key vault encrypted at rest; protected actions for Claude; Claude starts in auto
  permission mode by default; wider masking of secrets; network-share paths refused; several ways
  around protected actions closed.

### Rank 7 · Theme 9 · Reliability and no lost work
- **For the user:** quitting, crashing or a killed background service never loses his terminals,
  layouts or typed input.
- **Why seventh:** few commits (9 subject matches, about half of them on topic), no recorded owner
  call, but restore is a promise every session relies on (20 P0 cards) and it is the only theme
  checked on a packaged build. On 2026-09-29 agents ran a restore check on a packaged build twice;
  both runs failed to restore plain shell output after a cold start; it was fixed the same day and
  passed on one re-run. The subject count misses some of its work: background-service cleanup made
  safe (2026-09-29) and a data-safety lane in the 2026-10-06 audit wave. Its one headline item,
  never-lost dictation in 0.12.0, belongs to a feature Txais removed on 2026-10-05, so it adds no
  weight. The rebuild loop also names no lost work as a measured target, but checks it only in its
  last phase, after every P0 and P1 card passes.
- **Evidence:** handoff entry 2026-09-29 (restore check: two failed runs, a fix, a passing
  re-run); a background-service safety commit on 2026-09-29; a file-durability commit on
  2026-10-05; the data-safety lane of the 2026-10-06 audit wave.
- **At 0.15.0:** workspaces and terminals restore across quits and after the background service
  is killed; safer file writes. Resuming the agent conversation itself was never checked.

### Rank 8 · Theme 11 · Orchestration and automations
- **For the user:** a coordinating agent can hand work to other agents and watch them, and prompts
  can run on a schedule or when something happens.
- **Why eighth:** a large P0 set (31 cards, mostly the `kolux` command surface his own skills
  call every day), but light effort by commit subject (5 over 2 days), though the orchestration
  part of the code changed in every week of the project in small steps. It shared the 0.11.0
  headline: three of its items (event automations, model routing, Runs view) followed plan review.
- **Evidence:** tag v0.11.0 (2026-09-24); handoff entries 2026-09-22 (routing tiers) and
  2026-09-23 (event automations, Runs view).
- **At 0.15.0:** orchestration from the command line with per-provider routing; a read-only Runs
  view in the app; automations on a schedule or event, with run history.

### Rank 9 · Theme 8 · Release, update and CI pipeline
- **For the user:** the installed app updates itself quietly, with release notes, and a broken
  build never reaches him.
- **Why ninth (moved down from 8):** its effort is tied for second (34 commits over 12 days, 14
  tags), it carries a recorded owner call (2026-09-24: publish as soon as the checks pass on the
  installed build) and it led the first two releases. About a third of that work was updater
  behaviour he sees, a third was CI and release plumbing for the old repository, and the rest are
  false matches. It sits ninth for one reason that overrides all of this: the rebuild loop never
  publishes, so it matters only once Txais chooses to ship, and its user-facing part is small (7
  P0 cards).
- **Evidence:** v0.1.0 and v0.2.0 (2026-09-14); v0.9.0 (2026-09-21); owner decision 2026-09-24
  (vault); CI green again 2026-09-24; release gate commit 2026-09-29; automatic public releases
  2026-10-06 (0.15.1 and 0.15.2).
- **At 0.15.0 and after:** updates from GitHub Releases, checked every 30 minutes since
  2026-10-06 (every 15 before); release notes in the update card; a public release on every ship;
  builds unsigned; Windows only.

### Rank 10 · Theme 6 · Business-user frame
- **For the user:** a newcomer connects an AI, picks a ready-made task kit and gets a result in
  plain words, without learning git first.
- **Why tenth (moved down from 6):** one short, intense push (32 commits on 4 days, all from
  2026-09-28, and large in size) that led the 0.13.0 headline under his 2026-09-28 decisions, but
  it has only 4 P0 cards and 0.13.0 was never published as a release. On 2026-09-29 he called
  Kolux his own tool and portfolio piece for now, with no pricing or launch planned; on 2026-10-06
  he asked how marketing, sales, finance and support staff could use it, with decisions still
  pending. This rank may move up when he answers (open questions, end of this section).
- **Evidence:** owner decisions 2026-09-28; untagged 0.13.0 commit 2026-09-28 (never published as
  a release); vault purpose note 2026-09-29; vault direction note 2026-10-06.
- **At 0.15.0:** guided first run; Connect cards that install and sign in Claude, Codex and Grok;
  six starter kits with sample data and collected results; those three AIs listed first; plain
  labels with the technical word on hover. The newcomer checklist was half-done.

### Rank 11 · Theme 10 · Identity and originality
- **For the user:** the app is plainly his: his name, his icon, no one else's branding.
- **Why last:** no P0 cards; the rename (2026-09-21/22) and the scrub of upstream names
  (2026-10-05) were mechanical. The rebuild itself is this theme's real answer, and its 11 X cards
  (third-party logos) are replaced, never copied.
- **Evidence:** v0.10.0 rename (2026-09-22); originality cleanup entry 2026-10-05.
- **At 0.15.0:** named Kolux with its own `kolux` command; upstream names removed; cloud-only
  features removed; other tools' logos still bundled.

### Open owner questions (as of 2026-10-06)
These belong under "Needs Txais" in STATE.md. Until he answers, the order in section 4 stands and
D cards stay unplanned.
- **Theme 6's rank.** His 2026-10-06 question about non-coding staff as users would move theme 6
  up if he confirms that direction.
- **The custom-agent builder.** It is a default cut (D), yet on 2026-10-06 he had 24 department
  agents written for it and decided in principle that the Agents screen suggests all of them, and
  the design direction he chose on 2026-09-29 centres the Agents screen on chatting with agents he
  built (theme 7). The later direction contradicts the earlier cut.
- **Self-refreshing Claude sign-in.** On by default with an opt-out since 2026-09-28, set by a
  build session; no owner call confirms the default.

## 2. Timeline

| Date | Version | What landed | Why (in our words) |
|---|---|---|---|
| 09-10 – 09-11 | none (held at 0.0.0) | The imported code base, a handoff document for agents, lint cleanup | Start from working code and let any agent pick the work up cold |
| 09-14 | v0.1.0 | Windows releases built from version tags | Installed copies should update themselves |
| 09-14 | v0.2.0, v0.2.1 | An in-app update button; a rebuild at Txais's request | Let him update on demand |
| 09-14 | v0.3.0 | A three-mode shell | First try at a simpler frame around the grid |
| 09-14 | v0.4.0, v0.4.1 | A workspace preview pane; its button fixed on Windows | See the running result beside the code |
| 09-15 | v0.5.0 | A workspace composer with a full-permission chip and an agent picker | Faster launching from one place; a later rewrite of this launcher was dropped unmerged on 09-16, and the composer stayed |
| 09-15 | v0.6.0 | One window per terminal, a New session launcher, a six-agent wave | Try separate windows; reverted the same day |
| 09-15 | v0.7.0 | Sessions back as panes in the main window; launcher defaulting to shared seats | Back to one grid in the main window (no reason recorded) |
| 09-15 | 0.7.1 (untagged) | The sidebar shows only projects and session counts | Less clutter beside the grid |
| 09-16 | v0.8.0 | Every new session in its own pane; adding a project takes only the picked folder | His calls: one pane per session; no surprise folders |
| 09-17 | none | One session per pane; the add button leaves the tab strip; sessions back in the sidebar | His call after using it |
| 09-21 | v0.9.0 | Browser sign-in for Codex and Claude; update checks every 15 minutes; Opus by default | Sign in without pasting tokens; stay current |
| 09-22 | v0.10.0 | Renamed to Kolux with its own `kolux` command and repository | The app becomes his |
| 09-24 | v0.11.0 | Plan review, event automations, per-provider model routing, Runs view, grid layout presets, update checks in the installed app, a quieter sidebar, a graphics fallback; OpenCode removed; CI green again | See and steer what agents plan; providers never mix in one run; only frontier-lab agents |
| 09-24 | none (decisions) | One worktree per agent by default for two or more; cloud features hidden until a server exists; publish when checks pass | His three calls before the improvement release |
| 09-28 | v0.12.0 | Worktree-per-agent launches with shapes and roles, Review changes, Stopped state, quiet-agent alerts, sign-in expiry notices, sign-in opt-out, push-to-talk, never-lost dictation, feedback as GitHub issues, release notes in the update card, cloud features hidden | The improvement release: isolation and knowing what agents do |
| 09-28 | 0.13.0 (untagged, never published) | Guided first run, Connect cards, starter kits, three featured AIs, plain labels, sign-ins encrypted at rest | A friendlier frame for business users |
| 09-29 – 09-30 | none | Protected actions; a usage forecast with 80 % and 95 % alerts; a restore check on a packaged build (failed, fixed, passed on re-run); release gate; workspace views and the design canvas | Safety, no lost work, and the start of the redesign |
| 10-04 | none | New-look screens: new-session page, Terminals sidebar, Views and sessions setting, Agents view, live-terminal Board; a code audit | Build the screens he picked on the canvas |
| 10-05 | 0.14.0 (untagged) | 200k context cap, limit auto-resume, usage meter, the new look, colour themes, reworked pane header; dashboard pop-out retired | Run long sessions without hitting walls; a calmer look |
| 10-05 | 0.15.0 (untagged) | Redesign landed (its two open items finished 10-06), rounded windows, headers always on, footer and message bar removed, Claude in auto permission mode by default, voice and account pages trimmed, originality cleanup, lower memory | Make it his, make it lighter, drop what he never uses |
| 10-06 | 0.15.1, 0.15.2 (public releases) | Audit fix wave, automatic public releases on every ship, an Artifacts library, security close-out, folded Thought rows | Close the audit and make updates hands-off |

Count: 14 tags (all published as releases in the old repository), 2 releases in the public
releases repository, 4 untagged version bumps (0.7.1, 0.13.0, 0.14.0, 0.15.0), and 5 milestones
without a version; 22 rows.

Not a release and not in the table: on 2026-10-05 Txais cut remote hosts (the whole area) and 33
settings sections from the rebuild's scope. Those features were still in the old app's code at
0.15.0 and after.

## 3. Where 0.15.0 stands

Evidence types: **[app]** seen in the running app (dev build unless marked packaged) ·
**[handoff]** described in a handoff record, not seen · **[test]** automated tests only ·
**[commit]** commit only. Across the spec (recounted 2026-10-06), 122 cards are live (seen or
named in a 10-05/06 record), 905 are live but unverified, 5 are half-done.

### 3a. Verified in the running app (18)
- V1 · 2026-09-16 · Every new session opens in its own pane. [app]
- V2 · 2026-09-16 · Adding a project takes only the folder he picked. [app]
- V3 · 2026-09-22 · The quieter left sidebar. [app]
- V4 · 2026-09-22 · Per-provider routing tiers shown and chosen; a live worker launch through them was not driven. [app]
- V5 · 2026-09-23 · Plan review side sheet, driven by a simulated plan status. [app]
- V6 · 2026-09-23 · Automations can be set to start on an event. [app]
- V7 · 2026-09-23 · Launcher refresh; grid layout presets keep the same panes and running shells; read-only Runs view behind the experimental setting. [app]
- V8 · 2026-09-29 · Restore across quits and a killed background service: three workspaces, three quit-and-relaunch rounds; cold restore of plain shell output failed, was fixed, and passed on re-run. [app, packaged]
- V9 · 2026-10-05 · Limit auto-resume continued a live Claude pane. [app]
- V10 · 2026-10-05 · Session usage meter with real usage data. [app]
- V11 · 2026-10-05 · Pane header: branch chip, finished-ago label, glow on unseen finished panes, narrow-pane hiding order. [app]
- V12 · 2026-10-05 · Sixteen colour themes, Classic default, terminal can follow the app theme. [app]
- V13 · 2026-10-05 · No theme or font flash at startup. [app]
- V14 · 2026-10-05 · New look: full-width top bar; Agents and Board without the classic sidebar. [app]
- V15 · 2026-10-05 · Rounded session windows, controls on every pane, expand-to-fill and restore, sidebar card; dragging a resize was not checked. [app]
- V16 · 2026-10-05 · Every pane header shows title and usage; the session stepper and status-bar usage are gone. [app]
- V17 · 2026-09-15 · Launching two agents put two Claude panes in the grid; typing reached the terminal and agent status arrived (a shared-checkout launch, before the worktree default). [app]
- V18 · 2026-09-21 · The renamed app started under its new name, an older profile carried over, and the `kolux` command's help ran. [app]

V17 and V18 were added in review and sit out of date order so the earlier numbers stay stable.

### 3b. Shipped but unverified (14)
- U1 · 2026-09-21 · Browser sign-in for Claude and Codex in an installed build, end to end. [handoff]
- U2 · 2026-09-22 · One graphics failure no longer slows every new terminal (fallback after three strikes). [test]
- U3 · 2026-09-24 · A packaged build passed a smoke test of its command line and profile migration; its window was never opened. [test]
- U4 · 2026-09-28 · The 0.12.0 set: shaped launches with roles, Review changes, Stopped state, quiet-agent alerts, sign-in expiry notices, sign-in opt-out, copy-failure notices, copy terminal diagnostics, feedback as GitHub issues, release notes in the update card. [commit]
- U5 · 2026-09-28 · The 0.13.0 business frame: guided first run, Connect cards, starter kits, three featured AIs, plain labels, encrypted sign-ins. [commit]
- U6 · 2026-09-29 · Protected actions pause Claude before dangerous commands; never tried with a live Claude session. [test]
- U7 · 2026-10-05 · 200k context cap for Claude and Codex, on by default. [handoff]
- U8 · 2026-10-05 · Weekly usage pill with real data. [handoff]
- U9 · 2026-10-05 · Hidden tabs share the graphics limit; one measured run (ten tabs, one visible) cut graphics memory from about 730 to 630 MB. The larger saving that day was in the developer tooling, not the app. [handoff, measured]
- U10 · 2026-10-06 · Audit fixes: network-share paths refused, revealed programs not run, wider secret masking, protected-action loopholes closed. [test]
- U11 · 2026-10-06 · A public release on every ship, checked by the app every 30 minutes and installed after a restart prompt; two releases exist, an installed copy updating from them is not recorded. [handoff]
- U12 · 2026-10-06 · Artifacts library: published artifacts captured, listed and opened inside the app. [handoff]
- U13 · 2026-10-06 · Folded Thought rows and card-style agents in the Agents view (the two open items of the redesign). [commit]
- U14 · 2026-09-29 · Usage forecast: when each Claude or Codex limit window will run out, one-time alerts at 80 % and 95 %, and warnings at launch when an agent is above 80 %. [commit]

### 3c. Known gaps (12)
G1 (no Kolux account sign-out) moved to 3e: the account was removed on purpose.
- G2 · 2026-10-05 · Usage meter is local only; Codex and Grok show plan usage only. [handoff]
- G3 · 2026-10-05 · Limit auto-resume covers Claude only. [handoff]
- G4 · 2026-10-05 · The context cap skips native chat sessions, one remote revive path, and Grok. [handoff]
- G5 · 2026-09-29 · Protected actions do not cover Codex. [handoff]
- G6 · 2026-09-29 · Resuming the agent conversation after a restore was never run. [handoff]
- G7 · 2026-10-05 · Existing profiles stay on the classic look until they opt in. [handoff]
- G8 · 2026-10-06 · Two automated tests fail, on the main line too. [test]
- G9 · since 2026-09-14, still true 2026-10-06 · Releases are unsigned; Mac and Linux builds are not released. [handoff]
- G10 · 2026-09-11, restated 2026-09-23 · The agent dashboard is off by default and its shortcut silently does nothing; not re-checked since the pop-out was retired on 2026-10-05. [handoff]
- G11 · 2026-09-23 · Orchestration is split: the app view is read-only; work is created and routed from the command line. [handoff]
- G12 · 2026-09-23 · Layout presets never tried with existing scrollback, graphics acceleration on, or through the menu click. [handoff]
- G13 · since 2026-09-24, seen again 2026-10-06 · The full test suite is noisy on Windows; whole-project checks rely on Linux CI. [handoff]

### 3d. Half-done (5)
- H1 · as of 2026-10-05 · Select several changed files and stage or unstage them together (VIEW-118). [commit]
- H2 · as of 2026-10-05 · Live per-account model list exists but the session picker uses a built-in list (ACCT-032). [commit]
- H3 · as of 2026-10-05 · GitHub Projects roadmap timeline, possibly unreachable (GIT-057). [test]
- H4 · as of 2026-10-05 · Newcomer checklist with four first-success items (ONB-013). [test]
- H5 · 2026-09-29 · Releases stop unless CI is green and a packaged-app terminal check passes; the gate was written that day, but no record shows its terminal check running, including for the two public releases of 2026-10-06 (APP-061). [commit]

### 3e. Retired, hidden or removed (summary)
Full list with dates and defaults: `spec/21-retired-hidden.md` and DECISIONS.md.
- Tried and reverted: one window per terminal (2026-09-15). A rewrite of the 0.5.0 launcher was dropped unmerged on 2026-09-16; the workspace composer itself stayed.
- Sidebar search, timeline, agent grid and mode switch removed (2026-09-22). [app]
- OpenCode support removed, frontier-lab agents only (2026-09-23). [app]
- Cloud features (Kolux account, relay pairing, artifact and skill sharing) hidden 2026-09-28, removed 2026-10-05; mobile app links removed 2026-09-29.
- Dashboard pop-out and Agent Map retired 2026-10-05; the drawer stays behind an experimental flag.
- Desktop voice and dictation, Kolux account and input settings removed 2026-10-05. [app] This
  is a flip-flop: an unfinished removal of the same pages, begun in a 2026-09-24 wave, was set
  aside on 2026-09-28 because 0.12.0 kept dictation and shipped push-to-talk and never-lost
  dictation. In the same 2026-10-05 call he kept the Mobile settings page; his rebuild cut that
  day dropped mobile with the remote area, so the cut is the current call. With the account page gone there was no way to sign out
  of a Kolux account; that is moot, because the originality cleanup the same day removed the last
  account sign-in path.
- Pane footer and message bar removed 2026-10-05. [test] Session stepper and status-bar usage removed the same day. [app]
- Update nudge removed and upstream names scrubbed 2026-10-05. [app]
- Off by default: native chat, the pet, the Activity feed, the agent dashboard. Dev-only: profiles.
- Cut by Txais 2026-10-05 for the rebuild, not removed from the old app: remote hosts (the whole
  area, listed by name in DECISIONS.md rather than as cards) and 33 settings sections. Some
  features behind those sections become D cards; others are kept with fixed defaults or
  command-line flags.

## 4. Build-order rules

These restate LOOP.md section 2 with the theme order filled in. If the two ever disagree, LOOP.md wins
and the difference goes under "Needs Txais" in STATE.md.

1. **Walking skeleton first:** one window, one terminal running PowerShell, one agent launched in
   its own worktree.
2. **Every P0 card,** grouped by theme in rank order: 1, 2, 3, 4, 7, 5, 9, 11, 8, 6, 10. Inside a
   theme, sort by card id: area number first (01 to 21), then the card's number.
3. **P0 cards with no theme** (16 at the time of writing) come after the last ranked theme, by card id.
4. **Every P1 card** in the same order (ranked themes, then no theme), then **every P2 card** the same way.
5. **H cards** only where DECISIONS.md marks them build, after P2, in the same order. Skip the rest
   and say so in PLAN.md.
6. **X cards:** replace the asset with Txais's own, never copy it. If an earlier card needs the
   asset, it uses a neutral placeholder until the X card replaces it.
7. **D cards** are never planned; they stay in DECISIONS.md.
8. **Compat lines** are kept exactly, whatever the card's rank (COMPAT.md has the full surface).
9. **Ranks never change tiers.** Theme 5 cards stay P0 although theme 7 now builds before them.
10. **Secrets are stored encrypted from the first card that stores one** (a theme 4 card), even though
    the key vault theme builds sixth: never build a plain-text stage to fix later.
11. **One description per screen:** when a theme 7 card and an earlier card describe the same
    screen, build that screen to the theme 7 description the first time.
12. **Dependencies:** a later card moves forward only when an earlier card cannot pass its
    acceptance without it; note the move in PLAN.md.

Cutline: T-152-gate, T-152, T-167-a, T-025-d, T-166, T-067, T-184, T-441, T-442, T-442-b, T-443, T-073-a, T-047, T-069-a, T-069-b, T-418, T-500, T-544 (set by council C2 2026-10-13; T-544 trial build added at the freeze; since T-540-b plan-check exits 1 on an id with no PLAN line)

# Kolux RS dirty room — shared brief

Read this whole file before starting any stage. It is the contract every agent in Wave 1 works under.

## What this is

Kolux (`G:\Dev\Kolux\kolux`, Electron + TypeScript, version 0.15.0, by Txais Xiong) descends from an
MIT-licensed upstream app. It is being rebuilt from scratch as **Kolux RS** (Tauri 2, Rust core,
TypeScript UI) in `G:\Dev\kolux-rs`, so the result is wholly his. The method is a clean room:

- The **dirty room** (you) reads the old code, its 130k test titles, its registries and its project
  records, and writes a **behaviour spec**: what the user does, what the user sees, the rules, how to
  check it. No code, no identifiers, no file names, no copied sentences.
- The **clean room** (later autonomous build sessions in `G:\Dev\kolux-rs`) never sees the old code
  and builds only from that spec. Its tool permissions physically block the old repo and the
  `provenance/dirty-room/` folder.

The spec's legal and practical value depends on two things you control: **completeness** (nothing
Kolux does today is lost) and **the firewall** (nothing but behaviour crosses).

## Rooms and paths

| Place | Rule |
|---|---|
| `G:\Dev\Kolux\kolux` (old repo, branch main, clean tree) | **READ-ONLY.** Only `cat`, `rg`/`grep`, `git log/show/blame`, Read, Grep, Glob. Never edit, create, delete, checkout, stash, build, test, install or run anything there. |
| Kolux the app | Running on this PC right now. Never launch, kill, or send input to it. |
| `G:\Dev\kolux-rs` (clean-room repo) | Write only inside the paths your stage OWNS. Never touch `LOOP.md`, `SPEC.md`, `.claude/`, `scripts/`, other areas' files, or anything outside this repo. |
| `G:\Dev\kolux-rs\provenance\dirty-room\` | Evidence folder, forbidden to the clean room later. Paths and identifiers are allowed **here only**. |
| The vault `G:\Dev\Projects\Txais Brain` | Read-only. |

### Dirty-room evidence files (`provenance/dirty-room/`)

- `dumps/tests/<area>.txt` — every test title mapped to the area: `file<TAB>title`. Large. Never read whole when over 2,000 lines: grep it, or Read slices with offset/limit.
- `dumps/tests/<area>.describes.txt` — `count<TAB>describe-block title`, unique, sorted by count. Read fully.
- `dumps/tests/<area>.files.txt` — the test files that map to the area.
- `dumps/tests/_file-map.csv`, `_areas.csv` — file → area mapping and counts.
- `dumps/samples/<area>-r1.txt`, `-r2.txt`, `-r3.txt` — three 100-title random samples (`file<TAB>title`) for critic rounds.
- `dumps/e2e/spec-names.txt` — e2e spec files per area.
- `dumps/registries/*.tsv` — `keybindings`, `menu-items`, `settings-sections`, `settings-keys`, `view-ids`, `agent-catalog`, `hook-events`, `cli-manifest`, `readme-features`; each row has an `evidence` column. If a named file is missing, note it and continue.
- `dumps/cli/` — `kolux --help` output for the installed CLI: `_root-help.txt`, `_tree.txt`, one file per group and per command.
- `dumps/records/` — `handoff-recent-work.md` (verbatim HANDOFF "Recent work" and gap sections), `handoff-history-index.csv` (date, heading, line of every HANDOFF-HISTORY entry), `tags.csv` + `tag-messages.md`, `releases.txt`, `improvement-cards.md` (BridgeMind cards with shipped markers), `research-docs.csv`, `business-frame.md`, `design-source.md`, `package-facts.txt`.
- `churn.csv`, `churn-by-week.csv`, `commits-by-theme.csv` — commit churn per area and theme, mechanical commits excluded.
- `briefs/areas.json` — the area table in machine form (scope, old-code pointers, registries, prefix).

### Output folders

- `provenance/dirty-room/cards-raw/<area>.json` — reader writes, critic appends.
- `provenance/dirty-room/coverage/<area>-r<n>.csv` — critic writes.
- `G:\Dev\kolux-rs\spec\<nn>-<area>.md` and `provenance/dirty-room/firewall/<area>.md` — firewall writes.

## Hard rules for every stage

1. **Old repo read-only.** Your last action is `git -C G:\Dev\Kolux\kolux status --short`; it must print nothing. If it prints anything, say so in your return value and do not try to fix it.
2. **Own paths only.** One area, one stage, the files named for it. An agent that needs a change elsewhere writes it into its `notes` and moves on.
3. **No builds, no tests, no installs, no app launches.** Reading and small file writes only. Do not run `pnpm`, `npm`, `cargo`, `vitest`, `playwright`, or the installed `kolux` CLI beyond `--help`.
4. **Return data, not prose.** Your final message is consumed by a script: return exactly the fields asked for, nothing else.
5. **Never copy text.** Write behaviour in your own words from what the code does. Quote UI copy only when the user would type or click it (a menu label, a button) and only up to six words.
6. **Evidence stays in cards-raw.** `path:line` references, identifiers and registry keys go into the JSON only. The firewall stage removes them before anything reaches `spec/`.
7. **Budget.** Each stage has a turn budget in its prompt. Grep before you read; read with offset/limit; never read a whole large file.

## The area map

| # | Area | What the user can do (scope) |
|---|---|---|
| 01 | Projects, repos & worktrees | Add a project (only the folder picked); project groups, nested-repo import, repo icon/emoji; default checkout and base ref; create/list/remove worktrees, manual order, smart sort, lineage, back/forward history; `kolux.yaml` setup import; `KOLUX_WORKSPACES_DIR`; OneDrive workaround; workspace-cleanup dialog (stale/merged scan, bulk remove, forget locally); Space view (disk treemap). **Default cut (table 1b):** sparse-checkout presets, worktree symlinks, fork sync, repo hooks, host setups. |
| 02 | Sessions & launching | Agent catalog (~35), only installed ones shown; `+` menu; New session page; launch dialog with shapes Solo/Pair/Workbench/Swarm, seat count, isolation toggle, roles, lineup, saved shapes, launch memory; one worktree per agent by default for 2+; each session its own pane; agent + model picker; "focus three" featured agents + Show more. **Default cut:** custom-agents builder (its settings page is cut) — card it as D with the note that the department-agent plan wants it back. |
| 03 | Terminals & panes | Terminal grid, tabs, tab groups, splits, equalize; pane header with branch chip, title + usage %, "Done · Nm ago" and unseen-Done glow, narrow-pane hiding order, ⋯/expand/+/× controls, expand-to-fill + restore; rounded session windows; floating workspace panel; standalone terminal window; Copy terminal diagnostics; copy-failure toasts; image paste; scrollback, IME, alternate screen; restore across quits and a killed daemon; WebGL fallback and the 6-context cap; attention ring; Needs-you strip; keep-PC-awake; hibernate finished idle agents; Warp/Ghostty theme import; link detection in output. |
| 04 | Agent status, hooks & notifications | Managed hooks for 14 agent CLIs report working / blocked / waiting / done, stop cause (limit, sign-in, provider error), tool in flight, sub-agents and teammates; Stopped state; quiet-agent alerts; sign-in expiry notices; notifications, tray attention icon, dock badge; Inbox of items that need you; descendant-process kill; Activity feed (flag off); Thought rows in the Agents view. |
| 05 | Views & navigation | Agents / Board / Terminals screens (10-05 redesign, full-width top bar, no classic sidebar on Agents/Board); Swarm Approve/Deny/Answer; Board kanban with permission actions and done results; Agent Dashboard drawer (experimental flag; pop-out retired); Floor timeline; Tasks; Automations; Space; Skills; Artifacts library (10-06); Cmd-J worktree palette; left sidebar (projects + sessions, sidebar card); right sidebar panels: Explorer, Search, Source control, Checks, Ports, Sleeping workspaces, AI Vault (session history + resume), Handoff note; status bar: caffeinate, resource usage + kill, ports, pet, skill update; weekly-only usage pill top right. |
| 06 | Usage & limits | Session usage meter vs 200k on Board cards, tabs, Agents view; 200k context cap with auto-compact (Claude, Codex); limit auto-resume (opt-in); usage forecast with 80 % / 95 % alerts; Stats & Usage page (Claude, Codex, Grok) with share card. |
| 07 | Accounts, sign-in & keys | Claude accounts (browser sign-in, refresh default-on with opt-out); Codex accounts; Connect cards for API keys (Grok etc.); key vault encrypted at rest, paste-once sign-in, long-lived Claude key captured; `kolux account add/list`; live model lists; per-provider routing tiers; account switcher that suggests another account. **H:** profiles (dev-only). |
| 08 | Orchestration | Runs, tasks, dispatch, gates, mailboxes, questions, mutation requests; workers launch / list / observe / output / terminal / keepalive / reset; `kolux worktree ps`; read-only Runs view; worker retirement and resume; Claude Agent Teams launcher; per-provider model routing. Settings knobs become CLI flags / fixed defaults (orchestration settings page cut). |
| 09 | Automations | Prompt on a schedule (hourly / daily / cron) or on an event; run history; runs dashboard; hidden-terminal runs; prompt disclosure; full `kolux automations` CLI group. |
| 10 | Plan review & protected actions | Review the plan before Claude runs it (side sheet, section comments, approve or send back); protected actions pause before dangerous commands (force-push, DB delete, prod deploy); Safety settings; the 10-04 audit bypasses (network-share/UNC leak, PowerShell/cmd wrappers) are **rules the rebuild must not inherit** — card them as acceptance checks. |
| 11 | Git, source control & review | Commit, push, discard, history, hosted-review creation; Review changes / review before ship; combined diff with scroll restore; review notes on diffs sent to the agent; AI commit message and PR text; PR page (checks, fix-checks, actions); Tasks page; GitHub item dialog (inspect, edit, discuss, land); GitHub Projects table. Provider kept: **GitHub**. **Default cut:** GitLab, Bitbucket, Azure DevOps, Gitea, Jira, Linear and their dialogs (D cards, one per provider). |
| 12 | Editor & files | Code editor pane; explorer; search; "Open in Code" / "Answer in Code"; per-workspace handoff note; `kolux file` CLI; WSL path handling (local again 10-06). |
| 13 | Browser pane & computer use | Embedded browser tabs, address bar, split shortcuts, reload feedback, FedCM fallback, guest crash recovery, local-HTTPS trust, settings preview; browser annotations sent to an agent; CLI browser automation (tab, cookie, storage, intercept, dialog, clipboard, capture, mouse, set …). **Default cut:** computer use (agents drive the desktop). |
| 14 | Native chat | A Claude or Codex session shown as a chat instead of a raw terminal; structured runtime; open agent tabs in chat by default. All behind experimental flags, default off → tier H. |
| 15 | Skills, plugins & starter kits | Skills page; bundled version-matched skill guides (`kolux skills list/get/install/update`); starter-kit gallery — 6 kits with sample data, seat titles, Collect results. **Default cut:** plugin marketplace and runtime. |
| 16 | Onboarding & guidance | Guided first run (Welcome → Connect an AI → Your work → Choose a kit → grid tour); newcomer setup checklist and Setup Guide; Explore Kolux feature wall; startup feature tips; contextual tours; plain-language rule with jargon guard; GitHub star prompt. |
| 17 | Settings, appearance & input | **10 settings pages stay, 33 sections go** (table 1b below). 16-hue app themes (Classic default), terminal "Match app theme", no theme/font flash; keybindings — user-owned `~/.kolux/keybindings.json`, conflicts reported, many commands unbound; one small per-repo page (base branch, setup script, workspaces folder). |
| 18 | Remote & hosts — **DROPPED** (Txais, 2026-10-05) | No cards. A separate inventory agent lists what went. Stays elsewhere: local daemon (03/19), local hook server (04), `kolux status`/`kolux open` (20). |
| 19 | App lifecycle & operations | Startup, rounded multi-window shell, tray; auto-update from GitHub Releases (15-minute checks, release notes in the update card, public releases repo on every ship); crash report and Send Feedback as pre-filled GitHub issues; telemetry compiled off; profile persistence; daemon generations and reconnect safety; hang watchdog; local-build switching; `kolux status/open`, `kolux diagnostics memory`; resource popover + kill; release flow (ship command, 4-shard CI, packaged smoke test); dev-server memory behaviour. |
| 20 | The `kolux` CLI | Groups kept: core (`open`, `status`; `serve` dropped), account, automations, project, repo, worktree, file, terminal, orchestration, agent-hooks, diagnostics, introspection, skills, browser groups; `agent-context` machine-readable schema; `--help` on every level. Dropped with 18: environment, vm, emulator, host. Default cut: computer, linear. The owner's skills `kolux-cli`, `kolux-run`, `orchestration` depend on this surface. |
| 21 | H — retired, hidden, removed, dev-only | One-line cards: one window per terminal (reverted 09-15); sidebar Search/Floor/Agent grid/mode switch (09-22); OpenCode (09-23); Kolux Account, relay pairing, artifact & skill sharing (hidden 09-28, removed 10-05); mobile app links (09-29); dashboard pop-out and Agent Map (10-05); desktop Voice/dictation, Kolux Account and Input settings (10-05); Swarm footer, message bar, Sessions stepper, status-bar usage (10-05); update nudge (10-05); flags off by default: native chat, pet, Activity, Agent Dashboard; dev-only: profiles; third-party branded assets (replace). |

Where a behaviour straddles two areas, the area whose folder owns most of its tests gets the card; the other area lists it under `related`.

## Tiers

| Tier | Rule | Default in the build loop |
|---|---|---|
| **P0** | Daily use: named in README "What it does", or in a HANDOFF "Recent work" entry dated 2026-09-22 or later, or part of a top-5 theme (1–5 below) | Built first |
| **P1** | Shipped and used, not daily; integrations; CLI groups beyond core | After every P0 |
| **P2** | Present, rarely used; polish | After every P1 |
| **H** | Hidden, flagged off, dev-only, retired or removed | Only items the owner marks **build** in DECISIONS.md |
| **X** | Third-party branded assets (other tools' logos and icons) | Replaced with the owner's own |
| **D** | Dropped by the owner: area 18, and the table 1b defaults | Not built; listed in DECISIONS.md → Dropped with date and reason |

## Themes (the `pushed` field, 1–11)

1. Session-per-pane terminal grid
2. Isolation: one worktree per agent
3. Knowing what each agent is doing (status, hooks, inbox, plan review, Done glow)
4. Accounts, sign-in & usage limits
5. Safety & trust (key vault, protected actions, redaction, audits)
6. Business-user frame (starter kits, guided first run, Connect cards, jargon guard)
7. Redesign / new look (Agents, Board, Terminals screens; pane header; rounded windows; themes)
8. Release, update & CI pipeline
9. Reliability & no lost work (restore across quits, daemon generations)
10. Identity & originality
11. Orchestration & automations

A card's `pushed` is the theme it most belongs to, or `null`.

## Owner cuts (Txais, 2026-10-05) → tier D by default

**Area 18 entire:** SSH hosts, relay on remote hosts, remote daemon deploy/update/rollback, saved
environments and pairing codes, headless serve + web client, WSL execution and hook relay, mobile
page and pairing, mobile dictation and speech models, iOS/Android emulator pane, ephemeral VM recipes.

**Settings (table 1b):** only these 10 pages stay — General, Appearance, Accounts & keys, Agents,
Terminal & sessions, Git & worktrees, Safety, Notifications, Shortcuts, Usage.

| Section(s) cut | Fate of the feature behind it |
|---|---|
| ssh, servers, mobile, mobile-emulator | gone with area 18 |
| linear, integrations, developer-permissions, tasks | GitHub stays; GitLab, Bitbucket, Azure DevOps, Gitea, Jira, Linear → D; Tasks page becomes GitHub-only |
| computer-use | computer use → D |
| plugins | plugin marketplace and runtime → D |
| your-agents | custom-agent builder → D (note: the department-agents plan wants a successor) |
| quick-commands | quick-commands menu → D |
| orchestration | feature kept; its knobs become CLI flags and fixed defaults |
| browser, floating-workspace | features kept with fixed defaults, no settings page |
| automations, skills, setup-guide | each keeps its own page or view; no settings section |
| advanced, experimental, dev, privacy, views-sessions, general | folded: needed knobs move into General or Terminal & sessions; feature flags become build-time choices |
| repo-* (per-repo) | one small per-repo page stays (base branch, setup script, folder); sparse checkout, symlinks, fork sync, repo hooks, host setups → D |

A D card still gets written (two lines of behaviour are enough) with
`decision: "default cut: <reason>. Revive via DECISIONS.md."` so the Dropped list is complete by name.

## H tier

`decision: "H: default skip"` unless the live default path depends on it, then `"H: default build"`.
Flags off by default: native chat, pet, Activity feed, Agent Dashboard drawer. Dev-only: profiles.
Retired items with dates are in the area 21 row above and in `dumps/records/handoff-history-index.csv`.

## State at 0.15.0 (the `state` field)

`live` (a 2026-10-05/06 HANDOFF entry or a recorded verification names it) · `live-unverified`
(shipped, no verification record) · `hidden` (flag off) · `dev-only` · `retired <date>` ·
`dropped` (owner cut) · `half-done`.

## Card JSON (`cards-raw/<area>.json`)

```json
{
  "area": "03-terminals-panes",
  "prefix": "TERM",
  "generated": "2026-10-06",
  "cards": [
    {
      "id": "D-03-001",
      "title": "Pane header shows the branch and glows when a session finished unseen",
      "tier": "P0",
      "pushed": 1,
      "state": "live",
      "user_does": "Splits a pane, or leaves a session running and looks away.",
      "user_sees": "The pane header carries the worktree's branch name; when the agent finishes while the pane is not focused the header glows until the pane is viewed.",
      "rules": ["The glow clears on focus, never on a timer.", "Narrow panes drop the branch chip before the status."],
      "acceptance": ["Finish a session in an unfocused pane → header glows; focus it → glow clears within one frame.", "Shrink the pane below about 240 px → status stays, branch chip hides."],
      "compat": "",
      "decision": "",
      "evidence": ["src/renderer/src/components/terminal-pane/PaneHeader.tsx:88", "src/renderer/src/components/terminal-pane/pane-header.test.tsx:41", "registry:settings-keys:paneHeaderGlow"],
      "round": 0,
      "related": ["05"]
    }
  ],
  "notes": ["..."]
}
```

Ids are `D-<nn>-<nnn>`, zero-padded, continuous. `round` is 0 for the reader, 1–3 for critic additions.

## Card markdown (`spec/<nn>-<area>.md`, written by the firewall stage)

```text
### TERM-001 · Pane header shows the branch and glows when a session finished unseen
Tier: P0 · Pushed: 1 · State at 0.15.0: live
User does: splits a pane, or leaves a session running and looks away.
User sees: the pane header carries the worktree's branch name; when the agent finishes while the
  pane is not focused, the header glows until the pane is viewed.
Rules: the glow clears on focus, never on a timer; narrow panes drop the chip before the status.
Acceptance:
  - [ ] Finish a session in an unfocused pane → header glows; focus it → glow clears within one frame.
  - [ ] Shrink the pane below about 240 px → status stays, branch chip hides.
Compat: —
Source: D-03-001
```

`Decision:` appears only on H and D cards, before `Source:`.

## Firewall rules

**Forbidden in `spec/*.md`, `SPEC.md`, `COMPAT.md`, `PRIORITIES.md`, `DECISIONS.md`, `PROVENANCE.md`:**
code; identifiers (camelCase, PascalCase component names, snake_case, SCREAMING_SNAKE); file names,
paths, extensions; UI copy longer than six words quoted verbatim; error messages verbatim; JSON keys or
data schemas of the old app; its library and dependency names; test titles or HANDOFF prose verbatim.

**Allowed (interfaces the user already touches):** `kolux` command words and flags as typed;
`KOLUX_WORKSPACES_DIR`; the `~/.kolux/keybindings.json` file and its shape; keybinding command ids;
settings names as shown (≤ 4 words); agent names (Claude Code, Codex, Gemini CLI …); hook event names
(they are the agent CLIs' public protocol).

**Automated check:**
`powershell -NoProfile -File G:\Dev\kolux-rs\scripts\firewall-check.ps1 -Path G:\Dev\kolux-rs\spec\<file>`
must end with `0 hit(s)`. Rewrite to fix hits; never edit the allowlist (report candidates instead).

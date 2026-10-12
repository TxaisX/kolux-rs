# DECISIONS

Kolux RS · every hidden, retired, dropped or branded item and every open choice, with the default the
loop takes. Written by the dirty-room team on 2026-10-06 from the spec, PRIORITIES.md, COMPAT.md and
Txais's own notes. Behaviour only.

## 1. How to use

Each row below holds one choice and the default the loop will take. To flip a default, Txais edits that
row: change the Default cell (build or skip, cut or revive, or the named option), keep the date and
reason that are already there, and add his own date and reason next to them, so the record shows what
changed and why. The loop reads this file at planning time (Phase 2 in LOOP.md) and every time it
replans. It plans an H card only where the row says build, never plans a D card, replaces every X asset
with Txais's own, and takes the Default of every open choice, logging each one it relies on under
"Decisions made for Txais" in STATE.md. A row marked "confirm" in the Txais column is a default the
loop will use until he says otherwise; it never blocks the loop. Every H, D and X card appears exactly
once in this file, in its own table; everywhere else those cards are described in words. Open choices
carry their own ids (OD-nn), new behaviour NEW-nn, and the team's own calls DT-nn. Area numbers: 01
projects and worktrees · 02 sessions and launching · 03 terminals and panes · 04 agent status and hooks
· 05 views and navigation · 06 usage and limits · 07 accounts and keys · 08 orchestration · 09
automations · 10 plan review and protected actions · 11 git and review · 12 editor and files · 13
browser and computer use · 14 native chat · 15 skills, plugins and kits · 16 onboarding · 17 settings
and appearance · 18 remote and hosts (dropped, no cards) · 19 app lifecycle · 20 CLI · 21 retired and
hidden.

## 2. Open decisions

The first five come from the rebuild plan; the rest are the places where the spec or the readers' raw
notes said the owner should confirm or decide.

| ID | Choice | Default | Why | If flipped | Txais | Recorded |
|---|---|---|---|---|---|---|
| OD-01 | Sign-in: does Kolux call the AI provider's sign-in and usage services itself, or only use the provider's own browser sign-in? | Browser sign-in only; direct calls off. The Claude opt-out in ACCT-006 ships switched on, so Kolux never renews a Claude sign-in and never asks the provider's usage service; usage figures (USAGE-021) come from what running sessions report. The one-year key path in ACCT-004 is unaffected. | The provider's rules on third-party apps using its sign-in are a live risk (BridgeMind improvement card, accounts); PRIORITIES.md lists self-refreshing sign-in as an open question. | Kolux renews Claude sign-ins itself and shows usage even with no session running, as 0.15.0 did. The opt-out stays available to switch back. | confirm | 2026-10-06 |
| OD-02 | Pop-out windows: may a session, terminal or dashboard open in its own window? | Not built until parity. The four window cards in the H table (a window per terminal, the standalone terminal window, a session in its own window, the separate dashboard window) stay skip. | A BridgeMind improvement card asks whether pop-outs belong at all; the floating panel already pins a terminal over other work; windows add saved state, focus and crash-recovery work for every pane type. | Becomes a Phase 4 improvement: open any pane in its own window, remember its place and size, bring it back into the main window on close or restart. | — | 2026-10-06 |
| OD-03 | Code signing for the installer and updates. | Unsigned installer. The signed-installer card in the H table stays skip; the signature-mismatch stop in APP-030 stays dormant. | A certificate costs money every year and Txais is the only user for now. | With a certificate: Windows stops warning about an unknown publisher on install, the updater refuses an update whose publisher does not match (APP-030 applies), and anyone on an unsigned build needs one manual reinstall when signing starts, as happened with the old app in mid-September. | — | 2026-10-06 |
| OD-04 | Canvas workspace: a free-form board where terminals, notes and previews are placed and zoomed. | No. | BridgeMind shipped one, it went unused and was withdrawn; the floating panel covers pinning a terminal; no spec card asks for it. | A new card set is written first; Phase 4 at the earliest. | — | 2026-10-06 |
| OD-05 | Importer depth: how much of an old Kolux profile comes across on first run (COMPAT.md section 5). | Full profile. Carries settings and interface state, the profile index, projects, repositories and worktrees (sparse presets included as data), saved launch shapes, automations, the account list, and keybindings (the same keybindings.json, kept in place). Key-vault secrets only where they can be unsealed on this computer. Skips usage caches, logs, the old hook scripts (and removes the old app's entries from each agent's own config), managed agent homes, runtime and lock files, browser-engine data, and everything on the area 18 skip list in section 4.2. Orchestration and terminal history are optional and not carried in the first version (DT-05). Key-vault rule: the vault was sealed by the operating system through the old runtime, so the importer cannot count on reading it; the account list always carries; Claude and Codex accounts that cannot be unsealed are marked "sign in again"; pasted keys and links (Grok key, MiniMax key and cookie, HTTP proxy address, search session link) are marked "paste again"; an agent's own login files are never touched; anything that does unseal is still a secret and is never logged or copied into the repo. Related: ACCT-026, APP-004, PROJ-013 and the retired-settings card in the H table. | The owner wants to switch apps without redoing setup; secrets are the one thing that cannot be promised. | Shallow import (projects and settings only): accounts, launch shapes, automations and keybindings are set up again by hand. | — | 2026-10-06 |
| OD-06 | Fork pull requests: the fork-sync cut (area 01) takes fork push remotes with it, but opening a pull request from a fork as a workspace may need one. | Keep the push and pull fallback a fork workspace needs (it is on the "looked remote but stays" list); only the per-repository fork sync setting is cut. | Opening a fork's pull request as a workspace is daily GitHub work; the cut was aimed at the sync setting. | Fork pull requests open read-only; pushing back to a fork is done outside Kolux. | confirm | 2026-10-06 |
| OD-07 | Where a project's own workspaces folder is set, now that its command-line route sat in the cut host-setups group (PROJ-025). | On the one small per-repository settings page (folder is one of its three kept fields). No command-line route. | The per-repository page already keeps a folder field. | A `kolux` command for it is added to COMPAT.md first. | — | 2026-10-06 |
| OD-08 | Mobile page: kept in the 2026-10-05 cleanup of the old app but carded as cut with area 18. | Cut. | Everything it pairs with (phones, relay, web client) is gone with area 18. | The page returns only together with area 18's pairing, which is a whole new card set. | confirm | 2026-10-06 |
| OD-09 | One control tower: an improvement card asks for a single always-on overview of every agent; the dashboard drawer and dashboard cards in the H table are the old attempts. | Skip for parity. The Agents screen (VIEW-015) and the Needs-you strip are the overview; the control tower is a Phase 4 improvement candidate. | The old attempts were hidden or retired; the Agents screen is the live path. | Written as a new card and built after every P0 and P1 card passes. | confirm | 2026-10-06 |
| OD-10 | Changed-files list: Mod-click and Shift-click open a file in a split before multi-select sees them, so mouse multi-select is shadowed (VIEW-118). | Selection wins: Mod-click toggles a row and Shift-click selects a range; Alt-click and the row menu still open in a split. | Staging several files at once is the point of the card; opening in a split keeps a gesture. | Split-open keeps Mod and Shift; multi-select works by keyboard and right-click only. | confirm | 2026-10-06 |
| OD-11 | Account switcher: the scope names it, but the switcher card in the H table was retired on 2026-10-05. | Skip. Accounts are added and listed (CLI-014 and the Accounts & keys page) without a quick switcher. | It was not in any live view at 0.15.0. | Marked build; planned after the P1 accounts cards. | confirm | 2026-10-06 |
| OD-12 | WSL: everything between "WSL execution is cut" and "projects stored in WSL are local paths again" (area 18 and EDIT-044, SKILL-021, SKILL-022, ONB-017, ONB-028, CLI-009, CLI-014). | Nothing runs inside a WSL distribution. A project stored in WSL opens, saves, searches and runs git from Windows through its network path, like any local folder; Kolux does not register its CLI, install skills, scan skill folders or keep accounts inside WSL; selectors and setup steps offer no WSL target. The cut cards for WSL accounts, the WSL command line and git inside WSL stay cut. | Matches the owner's 2026-10-05 cut and the 2026-10-06 "paths local again" note with one rule. | Search and git run inside the distribution for WSL projects (faster on large repositories); everything else stays cut. | confirm | 2026-10-06 |
| OD-13 | Hermes and OpenClaw scheduled jobs in the Automations list (AUTO-025). | Keep, on this computer only. | The automations cut keeps local Hermes and OpenClaw jobs; only their remote runs went. | Automations lists only Kolux's own jobs. | — | 2026-10-06 |
| OD-14 | The shared-folders list and the archive script in a repository's committed kolux.yaml (GIT-067, STAT-055) against the cut per-repository symbolic-link setting and the cut repo-hooks settings (PROJ-093, PROJ-095). | Keep both kolux.yaml entries: shared folders are honoured when worktrees are created; the archive script runs on removal after the trust dialog (area 10), or from the CLI only with `--run-hooks` on worktree rm (CLI-020). Only the per-repository settings controls are cut: the symbolic-link list and the local archive script. | kolux.yaml is a kept contract (COMPAT.md 5.6); the cut named the settings controls, and the trust dialog and the CLI flag already carry the archive script. Extended to the archive script on 2026-10-06 after the COMPAT pass found PROJ-034 calling both cut. | Shared folders are no longer linked into new worktrees, the archive script never runs and `--run-hooks` leaves worktree rm; both kolux.yaml entries are ignored. | confirm | 2026-10-06 |
| OD-15 | GitHub Projects roadmap timeline, half-done at 0.15.0 (GIT-057): place items on the timeline, or show the unsupported notice. | Unsupported notice; the picker and the view agree that roadmap views are not supported. | Half-done and P2; the notice is the smaller honest answer. | Items are drawn on the timeline at their dates. | confirm | 2026-10-06 |
| OD-16 | Invitation to star the project on GitHub (GIT-071): it pointed at the old project, which conflicts with the rebuild being Txais's own work. | Off. No star prompt until Kolux RS has a public repository of Txais's; then it points there. | Pointing users at the old project undercuts the clean-room claim. | Shown on the landing screen and in the support part of Settings, aimed at Txais's repository. | confirm | 2026-10-06 |
| OD-17 | Per-repository Source Control AI override (GIT-019): it lived on the per-repository page, which keeps only base branch, setup script and folder. | Drop the per-repository override; keep the per-action recipes for commit, pull request, branch name and fix. | The kept per-repository page has no place for it. | A fourth field returns to the per-repository page. | — | 2026-10-06 |
| OD-18 | Browser knobs after the browser settings page is cut: search engine, search session link, home page, default zoom and HTTP proxy. | Fixed defaults with toolbar-menu controls: a standard web search, no session link, a blank start page, 100 % zoom, and the system's own proxy. | The owner's settings cut says browser settings become fixed defaults. | The five knobs get a small Browser group on General, and the importer carries their old values. | confirm | 2026-10-06 |
| OD-19 | Keybinding ids need an owner-approved list, and old settings need a mapping to new ones. | The ids COMPAT.md lists are the approved list; the importer maps each old setting to its new home in a table the loop keeps beside its tests; any id or mapping it adds is logged under "Decisions made for Txais" in STATE.md. | Keeps keybindings.json working without waiting on a review. | Txais reviews the list before the Shortcuts page is built. | — | 2026-10-06 |
| OD-20 | Upgrading from the old app: does the old app's update feed hand users over to Kolux RS in place? | No. Kolux RS ships with its own update feed; the first install is manual and the importer (OD-05) runs on first launch. The old app is never updated in place to Kolux RS. | The old feed and installer belong to the old code base; a clean break keeps provenance simple. | The old app's last update installs Kolux RS; needs a release of the old app, which is outside this project. | confirm | 2026-10-06 |
| OD-21 | Bundle Txais's 24 department agents with the app as the default suggestions (NEW-01). | Not bundled. Suggestions load from a folder the user owns and points Kolux at. | The loop's allowed vault pages do not include that folder, and the agent files are Txais's personal setup. | The 24 files ship inside the app as starter suggestions; Txais copies them into the repo himself first. | confirm | 2026-10-06 |

## 3. Hidden and retired cards (H)

Tier H means the item was hidden behind an off switch, developer-only, or retired in the old app at
0.15.0. The loop builds only the rows marked build. 140 cards: 27 build, 113 skip.

| ID | Area | Title | Default | Why | Recorded |
|---|---|---|---|---|---|
| PROJ-090 | 01 | Experimental new workspace card style | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| PROJ-091 | 01 | Agent rows inside sidebar workspace cards | skip | Retired 2026-09-20; the live app no longer shows it. | 2026-10-06 |
| SESS-041 | 02 | Agents opening as native chat rather than a terminal | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| SESS-042 | 02 | Claude Agent Teams launch option | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| SESS-043 | 02 | OpenCode taken out of the catalogue | skip | Retired 2026-09-23; the live app no longer shows it. | 2026-10-06 |
| TERM-033 | 03 | Session stepper (minus/plus) retired | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| TERM-034 | 03 | Attention ring on panes | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| TERM-032 | 03 | Pane footer and message bar retired | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| TERM-117 | 03 | Freeze report and render diagnostics | skip | Developer builds only; users never saw it. | 2026-10-06 |
| TERM-127 | 03 | Deprecated terminal stop command | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| TERM-039 | 03 | Switch a pane between chat and terminal view | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| TERM-123 | 03 | Agent hibernation | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| TERM-124 | 03 | Standalone terminal window | skip | Hidden; pop-out windows wait for parity (OD-02). | 2026-10-06 |
| STAT-057 | 04 | Activity feed of agent threads | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| STAT-058 | 04 | Attention marks for background terminals and bells | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| VIEW-034 | 05 | Agent Grid page (retired 2026-09-22) | skip | Retired 2026-09-22; the live app no longer shows it. | 2026-10-06 |
| VIEW-029 | 05 | Agent Dashboard drawer | skip | Hidden. An improvement card asks for one always-on overview of agents (OD-09). | 2026-10-06 |
| VIEW-031 | 05 | Separate dashboard window and the Agent Map (retired 2026-10-05) | skip | Retired 2026-10-05; pop-out windows wait for parity (OD-02). | 2026-10-06 |
| VIEW-033 | 05 | Activity page | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| VIEW-101 | 05 | Restart stale Codex sessions from the status bar (retired 2026-10-05) | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| VIEW-102 | 05 | Provider usage chips in the status bar (retired 2026-10-05) | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| VIEW-028 | 05 | Swarm pane footer and terminal-grid message bar (retired 2026-10-05) | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| VIEW-030 | 05 | Read-only Runs view in the dashboard | skip | Hidden; carded twice, in areas 05 and 08 (DT-13). | 2026-10-06 |
| VIEW-032 | 05 | Desktop pet that reacts to agents | skip | Hidden; the pet stays out (DT-32). | 2026-10-06 |
| VIEW-049 | 05 | Switch a tab between chat and terminal | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| USAGE-029 | 06 | Status-bar usage segments and account bars (retired 2026-10-05) | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| USAGE-030 | 06 | Usage overview dialog (no way to open it since 2026-10-05) | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| USAGE-031 | 06 | Forecast of when a usage window runs out (off screen since 2026-10-05) | build | The estimate still runs and serves knowing limits ahead (theme 4); show it in the top pill's hover. | 2026-10-06 |
| USAGE-032 | 06 | Notice that the usage percentages changed meaning | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| ACCT-036 | 07 | Account switcher that suggests another account with quota left | skip | Retired 2026-10-05 and in no live view; the scope names it, so the owner may mark it build (OD-11). | 2026-10-06 |
| ACCT-037 | 07 | Codex rate-limit reset credit from the switcher | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| ACCT-038 | 07 | Several Kolux profiles (developer only) | skip | Developer-only. The single default profile is on the live path and is built anyway in area 19 (DT-11). | 2026-10-06 |
| ACCT-039 | 07 | Kolux cloud account and organisation members | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| ORCH-045 | 08 | Read-only Runs view in the agent dashboard | skip | Hidden; carded twice, in areas 05 and 08 (DT-13). | 2026-10-06 |
| ORCH-048 | 08 | Taking over a coordinator Run left by an older Kolux | skip | Only matters for coordinator runs left by the old app, which the importer does not carry (DT-15). | 2026-10-06 |
| ORCH-046 | 08 | Retired coordinator-start and coordinator-stop commands | skip | Retired 2026-09-10; the live app no longer shows it. | 2026-10-06 |
| ORCH-047 | 08 | Retired background coordinator that worked through a task graph on its own | skip | Retired 2026-09-10; the live app no longer shows it. | 2026-10-06 |
| ORCH-049 | 08 | Workers as structured chat sessions instead of terminals | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| SAFE-008 | 10 | Plan review opened from a native-chat approval card | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-030 | 14 | Chat inside split panes | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-042 | 14 | Structured chats appear as workspace tabs | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-002 | 14 | Which sessions can be shown as chat | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-006 | 14 | Chat follows the agent's transcript live, even before the file exists | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-007 | 14 | Finding and reading each agent's transcript | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-010 | 14 | Each message once, in order, without system noise | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-011 | 14 | The reply streams in while it is being written | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-012 | 14 | Reasoning, compaction, plans and provider notices | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-013 | 14 | Tool calls fold into the agent's turn | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-014 | 14 | File edits show as diff cards | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-015 | 14 | Subagents appear as one roster row | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-016 | 14 | Responding, thinking and working indicators | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-017 | 14 | Chat message box | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-020 | 14 | Sending from chat types into the agent's terminal | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-022 | 14 | Answer an agent's question with a card | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-027 | 14 | Chat sticks to the newest message | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-033 | 14 | Structured chat sessions that Kolux runs itself | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-038 | 14 | Background tasks bar with stop controls | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-039 | 14 | Structured sessions report status to the sidebar | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-018 | 14 | Stop interrupts the agent | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-023 | 14 | Allow or deny a tool permission in chat | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-025 | 14 | Links in chat open files and web pages | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-009 | 14 | Hidden chats pause reading and keep their last good view | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-034 | 14 | Structured chat never loses or repeats messages | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-035 | 14 | Structured chat delivery status and provider errors | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-041 | 14 | Structured session processes are cleaned up | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-028 | 14 | Files the agent wrote, with send to another agent | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-001 | 14 | Experimental switches for chat view, its default, and structured chat | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-003 | 14 | Flip a tab between chat and terminal with a shortcut | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-004 | 14 | Right-click menu inside chat | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-005 | 14 | New agent tabs can open straight into chat | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-008 | 14 | Long conversations load in pages | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-019 | 14 | Autocomplete for slash commands, skills and file mentions | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-021 | 14 | Attach images and files to a message | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-024 | 14 | Model and effort controls beside Send | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-026 | 14 | Chat text zoom | build | The Agents screen (area 05) already shows supported sessions as terminal-backed chat with the switch off, so its everyday path relies on this. | 2026-10-06 |
| CHAT-029 | 14 | The launch prompt waits in the chat box | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-031 | 14 | Rough chat from terminal scrollback | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-036 | 14 | Hand a structured session between chat and the agent's terminal | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-037 | 14 | Compact, clear and rewind a structured conversation | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| CHAT-040 | 14 | Reopen a structured chat from session history | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| SKILL-034 | 15 | Install a shared skill bundle with a choice per clash | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| ONB-013 | 16 | Newcomer setup checklist with four plain first-success items | build | This is the newcomer path the business-user frame designed; at 0.15.0 it cannot be reached only because of a version-gate mismatch. | 2026-10-06 |
| ONB-030 | 16 | Voice dictation tip | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| ONB-035 | 16 | Development builds hold back first-run education | skip | Developer builds only; users never saw it. | 2026-10-06 |
| ONB-039 | 16 | Telemetry events for onboarding, tours, tips and the star prompt | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| ONB-041 | 16 | Retired first-run screens | skip | Retired 2026-10-04; the live app no longer shows it. | 2026-10-06 |
| SET-044 | 17 | Experimental flags page | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| SET-045 | 17 | Voice, Kolux Account and Input pages are gone | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| SET-046 | 17 | Agent dashboard shortcut hidden while its flag is off | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| SET-047 | 17 | Developer settings page in development builds | skip | Developer builds only; users never saw it. | 2026-10-06 |
| APP-045 | 19 | Usage telemetry is compiled off | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| APP-046 | 19 | Diagnostic upload is unavailable, and environment opt-outs refuse it | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| APP-033 | 19 | Alternative update channels and modifier-click prerelease checks | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| APP-034 | 19 | Switching to a locally built version, and updates in unpackaged copies | skip | Developer builds only; users never saw it. | 2026-10-06 |
| APP-035 | 19 | Linux-only update and launch paths | skip | Linux only; Kolux RS is Windows first. | 2026-10-06 |
| APP-063 | 19 | Tag-triggered CI release pipeline | skip | Retired 2026-10-06; the live app no longer shows it. | 2026-10-06 |
| APP-064 | 19 | Code-signed installers (opt-in, off) | skip | Hidden; the installer ships unsigned (OD-03). | 2026-10-06 |
| APP-044 | 19 | Main-thread hang watchdog | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| APP-005 | 19 | A session in its own system window that remembers its place (dormant) | skip | Hidden; pop-out windows wait for parity (OD-02). | 2026-10-06 |
| APP-036 | 19 | macOS-only startup and window behaviour | skip | macOS only; Kolux RS is Windows first. | 2026-10-06 |
| APP-047 | 19 | Typing-latency and main-thread churn probes | skip | Developer builds only; users never saw it. | 2026-10-06 |
| APP-065 | 19 | Development copy: lighter dev server, clean exit, DEV identity | skip | Developer builds only; users never saw it. | 2026-10-06 |
| APP-066 | 19 | Leftovers from the retired OpenCode integration are removed at startup | skip | Retired 2026-09-23; the live app no longer shows it. | 2026-10-06 |
| CLI-048 | 20 | Retired orchestration coordinator-start and coordinator-stop | skip | Retired 2026-09-10; the live app no longer shows it. | 2026-10-06 |
| HID-001 | 21 | Every terminal in its own desktop window (0.6.0), rolled back 2026-09-15 | skip | Retired 2026-09-15; pop-out windows wait for parity (OD-02). | 2026-10-06 |
| HID-010 | 21 | Agent Dashboard as a separate desktop window, plus its open-mode setting (retired 2026-10-05) | skip | Retired 2026-10-05; pop-out windows wait for parity (OD-02). | 2026-10-06 |
| HID-011 | 21 | Agent Map, retired 2026-10-05 | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-020 | 21 | Agent Dashboard drawer, off by default behind an experimental switch | skip | Hidden; one of the old overview attempts (OD-09). | 2026-10-06 |
| HID-021 | 21 | Agent Dashboard kanban board (hidden with the drawer) | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| HID-022 | 21 | Agent Dashboard card and host badge (hidden with the drawer) | skip | Hidden; one of the old overview attempts (OD-09). | 2026-10-06 |
| HID-023 | 21 | Agent Dashboard terminal preview panel (hidden with the drawer) | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| HID-026 | 21 | Activity view, off by default and unreachable | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| HID-027 | 21 | Terminal attention highlight, off by default | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| HID-005 | 21 | Kolux Account cloud sign-in and its settings page (hidden 2026-09-28, removed 2026-10-05) | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-017 | 21 | Claude and Codex usage block on the status bar, removed 2026-10-05 | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-035 | 21 | Profiles: local or cloud-linked, switching, moving projects (dev-only) | skip | Developer-only; the single default profile is built in area 19 (DT-11). | 2026-10-06 |
| HID-002 | 21 | Sidebar Search, Floor and Agent grid entries and the title-bar view switch, removed 2026-09-22 | skip | Retired 2026-09-22; the live app no longer shows it. | 2026-10-06 |
| HID-014 | 21 | Swarm pane footer, removed 2026-10-05 | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-015 | 21 | Message box under each grid pane, removed 2026-10-05 | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-045 | 21 | Shared message box under a workspace's panes, with an agent chooser, removed 2026-09-15 | skip | Retired 2026-09-15; the live app no longer shows it. | 2026-10-06 |
| HID-016 | 21 | Sessions minus/plus stepper, removed 2026-10-05 | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-029 | 21 | New worktree card style, off by default | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| HID-018 | 21 | In-app nudges, removed 2026-10-05 | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-019 | 21 | Update-available toast, swapped 2026-10-06 for a ready-to-restart toast | skip | Retired 2026-10-06; the live app no longer shows it. | 2026-10-06 |
| HID-036 | 21 | Retired settings quietly dropped when an old profile loads | build | An imported old profile must load with these settings ignored, neither failing nor bringing them back (OD-05). | 2026-10-06 |
| HID-006 | 21 | Phone pairing through a cloud relay (hidden 2026-09-28, removed 2026-10-05) | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-007 | 21 | Cloud artifact sharing (hidden 2026-09-28, removed 2026-10-05) | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-008 | 21 | Sharing skills by link (hidden 2026-09-28, removed 2026-10-05) | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-009 | 21 | Phone app store links and QR pairing, retired 2026-09-29 | skip | Retired 2026-09-29; the live app no longer shows it. | 2026-10-06 |
| HID-037 | 21 | The Nightshift name, retired with the rename to Kolux on 2026-09-22 | skip | Retired 2026-09-22; the live app no longer shows it. | 2026-10-06 |
| HID-003 | 21 | Floor and Agent grid pages with no way in (since 2026-09-22) | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| HID-004 | 21 | OpenCode support, removed 2026-09-23 | skip | Retired 2026-09-23; the live app no longer shows it. | 2026-10-06 |
| HID-012 | 21 | Desktop voice dictation, removed 2026-10-05 | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-013 | 21 | Input settings page, removed 2026-10-05 | skip | Retired 2026-10-05; the live app no longer shows it. | 2026-10-06 |
| HID-024 | 21 | Native chat and structured native chat, off by default | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| HID-025 | 21 | Pet, off by default | skip | Hidden; the pet stays out (DT-32). | 2026-10-06 |
| HID-028 | 21 | Agent sleep (hibernation), off by default | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| HID-033 | 21 | Hidden experimental group: terminal drawing diagnostics | skip | Hidden behind an off switch at 0.15.0; not part of the daily app. | 2026-10-06 |
| HID-034 | 21 | Dev Tools settings page (development builds only) | skip | Developer builds only; users never saw it. | 2026-10-06 |
| HID-038 | 21 | Per-agent rows on sidebar worktree cards, left as dead code (retired before 2026-09-22) | skip | Retired before 2026-09-22; the live app no longer shows it. | 2026-10-06 |

## 4. Dropped

### 4.1 Dropped cards (D)

Txais cut these on 2026-10-05. The loop never plans them. "Settings cut" means the owner's settings
cut list in section 4.3. 120 cards.

| ID | Area | Title | Reason | Cut |
|---|---|---|---|---|
| PROJ-092 | 01 | Sparse-checkout presets per project | Owner's settings cut: per-repo sparse checkout. | 2026-10-05 |
| PROJ-093 | 01 | Shared or linked folders in workspaces | Owner's settings cut: worktree symlinks (the per-repository settings control; the kolux.yaml shared-folders list stays under OD-14). | 2026-10-05 |
| PROJ-094 | 01 | Fork sync and fork push remotes | Owner's settings cut: fork sync; fork push remotes go with it. The push and pull fallback a fork workspace needs stays (OD-06). | 2026-10-05 |
| PROJ-095 | 01 | Repo hooks: archive script and hook runs on create and remove | Owner's settings cut: repo hooks (the per-repository settings control; the kolux.yaml archive script and `--run-hooks` stay under OD-14). | 2026-10-05 |
| PROJ-096 | 01 | Project host setups (one project on several machines) | Owner's settings cut: host setups. | 2026-10-05 |
| PROJ-097 | 01 | Projects and workspaces on SSH hosts | Area 18 remote and hosts dropped. | 2026-10-05 |
| PROJ-098 | 01 | Paired devices and web-client workspace views | Area 18 pairing and web client dropped. | 2026-10-05 |
| PROJ-099 | 01 | WSL projects side by side with Windows projects | Area 18 WSL execution dropped; WSL paths are local again. | 2026-10-05 |
| PROJ-100 | 01 | Linear, GitLab and Jira links on workspaces | The settings cut, only GitHub stays as a provider. | 2026-10-05 |
| PROJ-101 | 01 | Ephemeral VM environment recipes in kolux.yaml | Area 18 ephemeral VM recipes dropped. | 2026-10-05 |
| SESS-045 | 02 | Custom agent builder and custom agents as launch seats | The Your agents settings section was cut (settings cut); the department-agents plan wants a successor. Successor: NEW-01 and NEW-02. | 2026-10-05 |
| SESS-046 | 02 | GitLab, Linear and Jira sources in the workspace composer | Providers other than GitHub left with the Linear and integrations settings sections. | 2026-10-05 |
| SESS-047 | 02 | Remote run targets, project location on a host, and the Remote-SSH editor | Remote hosts (area 18) dropped as a whole. | 2026-10-05 |
| SESS-048 | 02 | Running agents inside WSL | WSL execution went with area 18. | 2026-10-05 |
| SESS-049 | 02 | Mobile emulator tab and coordinated simulator launches | The emulator pane went with area 18. | 2026-10-05 |
| SESS-050 | 02 | Sparse checkout while preparing a launched worktree | Sparse checkout cut with the per-repo settings. | 2026-10-05 |
| TERM-038 | 03 | Quick commands menu | Quick commands menu is on the owner's settings cut list. | 2026-10-05 |
| TERM-064 | 03 | Mobile emulator tab in the floating workspace | Remote hosts, web runtime, WSL execution and mobile are area 18, dropped by the owner. | 2026-10-05 |
| TERM-128 | 03 | SSH and remote host terminals | Remote hosts, web runtime, WSL execution and mobile are area 18, dropped by the owner. | 2026-10-05 |
| TERM-129 | 03 | WSL shells and WSL path conversion | Remote hosts, web runtime, WSL execution and mobile are area 18, dropped by the owner. | 2026-10-05 |
| TERM-130 | 03 | Web client and paired runtime terminals | Remote hosts, web runtime, WSL execution and mobile are area 18, dropped by the owner. | 2026-10-05 |
| TERM-136 | 03 | Phone control of a desktop terminal | Remote hosts, web runtime, WSL execution and mobile are area 18, dropped by the owner. | 2026-10-05 |
| STAT-059 | 04 | Hook relay for agents running inside WSL | Area 18 (remote hosts, SSH and the WSL relay) was dropped by the owner on 2026-10-05. | 2026-10-05 |
| STAT-060 | 04 | Kolux hooks on SSH hosts | Area 18 (remote hosts, SSH and the WSL relay) was dropped by the owner on 2026-10-05. | 2026-10-05 |
| VIEW-022 | 05 | Custom-agent builder from the Agents screen | The custom-agent builder goes with its settings section; the department-agents plan wants a successor. Successor: NEW-01 and NEW-02. | 2026-10-05 |
| VIEW-035 | 05 | Kolux Mobile page and title-bar button | The mobile page and phone pairing go with area 18 (remote and hosts). (OD-08) | 2026-10-05 |
| VIEW-044 | 05 | Plugin actions in the palette | Plugin marketplace and runtime dropped. | 2026-10-05 |
| VIEW-045 | 05 | Host badges and host-qualified rows in the palette | Workspaces spread over several machines go with area 18 (remote and hosts). | 2026-10-05 |
| VIEW-055 | 05 | Workspace host scope in the sidebar | Choosing workspaces by machine goes with area 18 (remote and hosts). | 2026-10-05 |
| VIEW-058 | 05 | Plugin panels in the right sidebar | Plugin marketplace and runtime dropped. | 2026-10-05 |
| VIEW-077 | 05 | GitLab merge requests in the Checks panel | GitLab dropped; GitHub is the only kept provider. | 2026-10-05 |
| VIEW-079 | 05 | Ports tab for remote repositories | SSH hosts go with area 18 remote and hosts. | 2026-10-05 |
| VIEW-094 | 05 | Past sessions on remote machines | Remote hosts, WSL execution and pairing go with area 18. | 2026-10-05 |
| VIEW-103 | 05 | Remote host status in the status bar | SSH hosts and remote servers go with area 18. | 2026-10-05 |
| USAGE-033 | 06 | Usage reading and auto-resume for WSL, SSH and mobile | WSL, SSH and mobile execution left with area 18. | 2026-10-05 |
| ACCT-040 | 07 | Accounts that run inside WSL | WSL execution is part of area 18. (OD-12) | 2026-10-05 |
| ACCT-041 | 07 | Account management for a remote Kolux host | Remote hosts are area 18. | 2026-10-05 |
| ACCT-042 | 07 | Notice when an unpaired device asks to sign in | Mobile pairing is area 18. | 2026-10-05 |
| ACCT-043 | 07 | Files on SSH hosts | SSH hosts are area 18. | 2026-10-05 |
| ACCT-044 | 07 | Git on SSH hosts | SSH hosts are area 18. | 2026-10-05 |
| ACCT-045 | 07 | Terminals on SSH hosts | SSH hosts are area 18. | 2026-10-05 |
| ORCH-044 | 08 | Orchestration settings page | The owner cut the orchestration settings page; its knobs become CLI flags or fixed defaults. | 2026-10-05 |
| ORCH-050 | 08 | Workers on remote servers | Remote hosts (area 18) are dropped. | 2026-10-05 |
| ORCH-051 | 08 | Remote and mobile runtime connections | Remote hosts and mobile transport (area 18) are dropped. | 2026-10-05 |
| ORCH-052 | 08 | Linear, Jira and GitLab calls through the runtime | Tracker integrations other than GitHub are cut. | 2026-10-05 |
| AUTO-026 | 09 | Automations on SSH hosts and paired servers | Area 18 (SSH hosts, paired servers, headless serve) is dropped, so automations run on this computer only. | 2026-10-05 |
| AUTO-027 | 09 | Hermes and OpenClaw jobs on remote hosts | Remote hosts and the relay belong to area 18, which is dropped; only Hermes and OpenClaw on this computer stay. | 2026-10-05 |
| AUTO-028 | 09 | Linear, Jira and GitLab as automation sources | The settings cut cuts the Linear, Jira and GitLab integrations, so review events and source context are GitHub-only. | 2026-10-05 |
| AUTO-029 | 09 | Automations section in Settings | The settings cut removes the automations settings section; the feature keeps its own page and the switch stays under Appearance. | 2026-10-05 |
| SAFE-030 | 10 | Folder trust and secret recovery for repositories on SSH hosts | Area 18 SSH hosts dropped. | 2026-10-05 |
| SAFE-029 | 10 | Protected actions for agents on SSH hosts and in WSL | Area 18 remote and WSL hook relay dropped. | 2026-10-05 |
| GIT-072 | 11 | GitLab merge requests, pipelines and issues | The owner kept GitHub as the only hosted provider (settings cut). | 2026-10-05 |
| GIT-073 | 11 | Bitbucket pull requests | The owner kept GitHub as the only hosted provider (settings cut). | 2026-10-05 |
| GIT-074 | 11 | Azure DevOps pull requests | The owner kept GitHub as the only hosted provider (settings cut). | 2026-10-05 |
| GIT-075 | 11 | Gitea pull requests | The owner kept GitHub as the only hosted provider (settings cut). | 2026-10-05 |
| GIT-076 | 11 | Jira issues as a task source | Tasks becomes GitHub-only (settings cut). | 2026-10-05 |
| GIT-077 | 11 | Linear issues as a task source | Tasks becomes GitHub-only and the Linear settings section is cut (settings cut). | 2026-10-05 |
| GIT-078 | 11 | The kolux linear command group | The Linear integration is cut (settings cut), and area 20 lists the group as cut. | 2026-10-05 |
| GIT-079 | 11 | Integrations settings page | The integrations section is cut (settings cut). | 2026-10-05 |
| GIT-080 | 11 | Task sources setting and switching providers in Tasks | The tasks section is cut and the Tasks page becomes GitHub-only (settings cut). | 2026-10-05 |
| GIT-081 | 11 | macOS developer permissions settings page | The developer permissions section is cut (settings cut). | 2026-10-05 |
| GIT-082 | 11 | Sync a fork with its upstream | Per-repository fork sync is cut (settings cut). | 2026-10-05 |
| GIT-083 | 11 | Sparse-checkout workspaces | Per-repository sparse checkout is cut (settings cut). | 2026-10-05 |
| GIT-084 | 11 | Folders shared across worktrees through symbolic links | Per-repository symbolic links are cut (settings cut). The kolux.yaml shared-folders list stays (OD-14). | 2026-10-05 |
| GIT-085 | 11 | Git, GitHub and AI text on remote SSH hosts | SSH hosts and remote execution were dropped with area 18. | 2026-10-05 |
| GIT-086 | 11 | Git for repositories inside WSL runs inside the distribution | Execution inside WSL was dropped with area 18; the owner should confirm whether git for WSL-stored repositories stays now that their paths are local again. (OD-12) | 2026-10-05 |
| EDIT-051 | 12 | Editing, searching and downloading files on remote hosts | Area 18 remote hosts and runtimes are dropped. | 2026-10-05 |
| EDIT-052 | 12 | Simulator palette search | Area 18 mobile emulator pane is dropped. | 2026-10-05 |
| BROW-054 | 13 | Browser settings page | The settings cut removes the browser settings page; the features keep fixed defaults and toolbar-menu controls. | 2026-10-05 |
| BROW-055 | 13 | Browser pages hosted on a paired desktop client | Paired remote runtimes (area 18) are dropped. | 2026-10-05 |
| BROW-056 | 13 | Browser pages streamed to web and phone clients | Web client and mobile pairing (area 18) are dropped. | 2026-10-05 |
| BROW-057 | 13 | Browser traffic routed through SSH, WSL and remote hosts | SSH, WSL and remote network routing (area 18) are dropped. | 2026-10-05 |
| BROW-058 | 13 | Browser tabs inside web-runtime sessions | Headless serve and web client (area 18) are dropped. | 2026-10-05 |
| BROW-059 | 13 | Remote runtime folder browser with Windows drives | Remote runtimes (area 18) are dropped. | 2026-10-05 |
| BROW-060 | 13 | Open an address on the paired client from the CLI | Paired client hosting (area 18) is dropped. | 2026-10-05 |
| BROW-061 | 13 | Custom network address for runtime pairing | Runtime pairing (area 18) is dropped. | 2026-10-05 |
| BROW-062 | 13 | Computer use: agents control desktop apps | The settings cut removes computer use and its settings section. | 2026-10-05 |
| BROW-063 | 13 | Computer Use settings section | The settings cut removes the computer-use settings section. | 2026-10-05 |
| BROW-064 | 13 | Mac permission setup for computer use | The settings cut removes computer use. | 2026-10-05 |
| BROW-065 | 13 | Desktop control helpers for Mac, Windows and Linux | The settings cut removes computer use. | 2026-10-05 |
| BROW-066 | 13 | Computer-use recovery guidance and key-chord checks | The settings cut removes computer use. | 2026-10-05 |
| CHAT-032 | 14 | Reading transcripts of agents running in WSL | WSL, remote-host and phone execution left the product with area 18. | 2026-10-05 |
| CHAT-043 | 14 | Phone take-over locks chat input | WSL, remote-host and phone execution left the product with area 18. | 2026-10-05 |
| CHAT-044 | 14 | Chat with agents on SSH and remote hosts | WSL, remote-host and phone execution left the product with area 18. | 2026-10-05 |
| SKILL-019 | 15 | Skills settings section | The settings cut removes the Skills section; the Skills page stays. | 2026-10-05 |
| SKILL-032 | 15 | Bundled skills for cut features | The features these skills drive are cut (computer use, Linear, emulators, environment recipes). | 2026-10-05 |
| SKILL-033 | 15 | Skills on remote hosts | Remote hosts are dropped with area 18. | 2026-10-05 |
| SKILL-037 | 15 | Plugins settings: install, enable, consent to and remove plugins | The settings cut removes the plugins section and the plugin runtime. | 2026-10-05 |
| SKILL-038 | 15 | Plugin marketplace | The marketplace goes with the plugins settings section. | 2026-10-05 |
| SKILL-039 | 15 | Plugin runtime: workers, panels, commands and keybindings | The plugin runtime goes with the plugins settings section. | 2026-10-05 |
| SKILL-040 | 15 | Plugin content packs: language packs, VM recipes, launch packs | Content packs go with the plugin runtime, and VM recipes also go with area 18. | 2026-10-05 |
| SKILL-041 | 15 | Plugin safety: secrets, storage caps, audit log, remote revocation | The plugin safety machinery goes with the plugin runtime. | 2026-10-05 |
| ONB-019 | 16 | Other code hosts and trackers in the setup guide and Explore Kolux | The owner dropped Jira, Linear, GitLab, Bitbucket, Gitea and Azure DevOps (settings cut); GitHub stays. | 2026-10-05 |
| ONB-021 | 16 | Onboarding checklist section in Settings | The owner removed the setup-guide settings section (settings cut); the guide keeps its own view. | 2026-10-05 |
| ONB-034 | 16 | Hosted-browser tour for remote setups | The owner dropped area 18 (remote and hosts). | 2026-10-05 |
| ONB-040 | 16 | Computer Use setup inside the guide and the capabilities step | The owner dropped computer use (settings cut). | 2026-10-05 |
| SET-049 | 17 | Remote host, mobile and VM settings sections | Area 18 (remote hosts, mobile, VMs) dropped by the owner. | 2026-10-05 |
| SET-050 | 17 | Integrations, Linear and Task Sources sections | Code hosts and trackers other than GitHub, and the task-source settings, removed by the owner. | 2026-10-05 |
| SET-051 | 17 | macOS Permissions and Computer Use sections | MacOS permissions page and computer use removed by the owner. | 2026-10-05 |
| SET-052 | 17 | Plugins section: marketplace, installs and consent | Plugin marketplace and runtime removed by the owner. | 2026-10-05 |
| SET-053 | 17 | Your agents: the custom agent builder | Custom-agent builder removed by the owner; the department-agents plan wants a successor. | 2026-10-05 |
| SET-054 | 17 | Quick Commands section and menu | Quick-commands menu removed by the owner. | 2026-10-05 |
| SET-055 | 17 | Orchestration settings page | Settings page only; knobs become CLI flags and fixed defaults. | 2026-10-05 |
| SET-056 | 17 | Settings sections for features that keep a page of their own | Settings sections only; features keep fixed defaults or their own page. | 2026-10-05 |
| SET-057 | 17 | Advanced, Privacy and Views & sessions as pages of their own | Pages folded into General or Terminal & sessions by the owner. | 2026-10-05 |
| SET-058 | 17 | Per-repository extras beyond base branch, setup script and folder | Per-repo extras removed by the owner. | 2026-10-05 |
| APP-067 | 19 | Headless serve mode with a virtual display | Headless serve went with remote and hosts (area 18). | 2026-10-05 |
| APP-068 | 19 | Remote sessions reconnecting at startup; remote clipboard and mobile relays | SSH, remote clipboard staging and mobile relays went with area 18. | 2026-10-05 |
| APP-069 | 19 | WSL command reconciliation at startup | WSL execution went with area 18. | 2026-10-05 |
| CLI-049 | 20 | kolux serve: headless server | Headless serving and the web client belong to area 18. | 2026-10-05 |
| CLI-050 | 20 | Remote targeting: pairing codes, environments, hosts and opening links on a paired client | Saved environments, pairing codes, SSH hosts and paired clients belong to area 18. | 2026-10-05 |
| CLI-051 | 20 | kolux project host setups | Host setups (the settings cut, per-repo pages). | 2026-10-05 |
| CLI-052 | 20 | kolux inside WSL distros | WSL execution belongs to area 18. (OD-12) | 2026-10-05 |
| CLI-053 | 20 | kolux vm recipe doctor | Ephemeral VM recipes belong to area 18. | 2026-10-05 |
| CLI-054 | 20 | kolux emulator | The iOS and Android emulator pane belongs to area 18. | 2026-10-05 |
| CLI-055 | 20 | kolux computer: controlling desktop apps | Computer use (settings cut). | 2026-10-05 |
| CLI-056 | 20 | kolux linear, and Linear issue links on worktrees | The Linear integration (settings cut). | 2026-10-05 |
| HID-030 | 21 | Ephemeral VMs switch (off by default) | Ephemeral VM recipes go with area 18 (remote & hosts), dropped by the owner 2026-10-05. | 2026-10-05 |
| HID-031 | 21 | Experimental mobile switch and the Kolux Mobile button (off by default) | The phone companion goes with area 18 (remote & hosts), dropped by the owner 2026-10-05. | 2026-10-05 |
| HID-032 | 21 | Plugin system switch and developer plugin folders (off by default) | Plugin marketplace and runtime (settings cut). | 2026-10-05 |

### 4.2 Area 18, remote and hosts (dropped 2026-10-05)

Txais dropped the whole area, so it has no spec file and no cards. What went, by group:

- **SSH hosts.** A list of remote hosts; proxy and jump-host routing; bringing hosts in from the user's
  SSH settings; connecting and signing in; host-key checking; automatic reconnect; installing a helper on
  the host by itself; keep-alive and reset; terminals running on a host; projects and worktrees on a
  host; browsing, editing and uploading files on a host; source control on a host; port forwarding; the
  built-in browser reaching sites through a host; agent status and session history from a host; the
  `kolux` command line inside remote terminals; agent detection on a host; automations run on a host;
  opening a host folder in VS Code over SSH; a pane layout kept per host; disk usage on a host; the
  Remote Hosts item in the status bar.
- **Remote helper service.** Deploying it to a host; updating it and rolling it back.
- **Saved environments and pairing.** Saved servers; a pairing-link generator; a network listener for
  paired devices; workspaces on a paired server; updating a paired server; the run-target picker.
- **Headless serve and web client.** Running Kolux with no window and using it from a browser on
  another device.
- **WSL execution.** A WSL shell as a session target; projects, agents and accounts inside a WSL
  distribution; the hook relay from WSL; registering the command line inside WSL.
- **Mobile.** The Mobile page, its button and its settings; a phone taking over a terminal; a phone
  viewing the browser and documents; notifications to a phone; phone dictation and its speech models.
- **Phone emulator.** The emulator pane, its settings and its tabs.
- **Throwaway VMs.** Recipes that started a virtual machine per workspace.
- Three related leftovers are already H cards in area 21 (phone relay pairing, phone store links and
  QR codes, the paired web client's traces).
- **Command line removed with it.** The serve, environment, host, VM and emulator command groups (23
  commands), the `--pairing-code` and `--environment` global flags, host values that point at an SSH
  host or a paired runtime, and the stand-in command that forwarded calls from remote terminals.

**Looked remote but stays (local):** the local background service and its restore buffer for windowless
restarts; the local hook listener; local notifications, tray icon and taskbar badge; `kolux status` and
`kolux open`; WSL-stored project paths treated as local (OD-12); the key vault; the host adapters for
each AI; publishing a repository to GitHub; git remote identity and the fork push and pull fallback
(OD-06); the Ports panel, which needs a local trigger; the AI vault; protected actions; the 200k context
cap; the built-in browser; Open in Code; PowerShell as the default shell; installing the command line
on the user's PATH; Space; local automations.

**The importer must skip:** SSH host records; remote leases and their tombstones; any row bound to a
host; the SSH host-key store; saved environments; paired devices; the end-to-end encryption key pair;
the fallback port; the relay region preference; mobile settings; speech models and their settings; the
OpenAI speech key; emulator settings and tabs; VM runtimes and their switch (VM recipes left in a
repository's kolux.yaml are ignored, not deleted); WSL execution settings (the default shell resets to
PowerShell); any other remote-only setting; the headless runtime lock.

### 4.3 Settings pages cut

Ten pages stay: General, Appearance, Accounts & keys, Agents, Terminal & sessions, Git & worktrees,
Safety, Notifications, Shortcuts and Usage. The rest go as follows.

| Old page | What happens |
|---|---|
| SSH, Servers, Mobile, Mobile emulator | Gone with area 18. |
| Linear, Integrations, Developer permissions, Tasks | GitHub stays; every other provider and tracker is cut; Tasks becomes GitHub-only. |
| Computer use | Cut, with the feature. |
| Plugins | Cut, with the marketplace and the plugin runtime. |
| Your agents | Cut; a successor is wanted (NEW-01, NEW-02). |
| Quick commands | Cut, with the feature. |
| Orchestration | The page goes; its knobs become `kolux` command flags or fixed defaults. |
| Browser, Floating workspace | The pages go; the features keep fixed defaults (OD-18). |
| Automations, Skills, Setup guide | The settings sections go; each feature keeps its own page or view. |
| Advanced, Experimental, Developer, Privacy, Views & sessions | Folded into General or Terminal & sessions; experimental and developer switches become choices made when the app is built, not settings (DT-03). |
| Per-repository pages | One small page per repository: base branch, setup script and folder. Every extra is cut. |

## 5. Third-party assets (X)

Rule: every X asset is replaced with Txais's own icon, art, recording or a plain text label, made for
Kolux RS. It is never copied, traced or redrawn from the original, and the old app's install folder is
never a source. Plain-text product names stay where they tell the user what Kolux launches or connects
to. The old app also carried 9 notification sounds and 12 feature-wall animations of unknown origin;
they are replaced the same way. 12 cards.

| ID | Area | Asset | Replace with | Recorded |
|---|---|---|---|---|
| SESS-044 | 02 | Third-party agent logos in pickers | Own icon per AI, or the AI name as text. | 2026-10-06 |
| TERM-131 | 03 | Agent brand marks in pane headers and tabs | Own icon per AI, or the AI name as text. | 2026-10-06 |
| VIEW-104 | 05 | Third-party provider logos in usage UI | Own icons or text labels. | 2026-10-06 |
| USAGE-020 | 06 | X logo on the post-sharing button | A plain share icon or the word Share. | 2026-10-06 |
| ONB-026 | 16 | Feature tile recordings and other tools' names in their captions | New recordings of Kolux RS itself; captions name no other tools. | 2026-10-06 |
| SET-048 | 17 | Other companies' logos on settings pages | Own icons or text labels. | 2026-10-06 |
| HID-039 | 21 | Bundled agent maker logos (29 images plus an OpenClaude logo) | Own icon set, or names as text. | 2026-10-06 |
| HID-040 | 21 | Redrawn provider marks (Claude, OpenAI, Gemini, MiniMax and others) | Own icon set, or names as text; no redrawn marks. | 2026-10-06 |
| HID-041 | 21 | Agent icons fetched live from Google's favicon service | Nothing fetched at run time; own icon or a text initial. | 2026-10-06 |
| HID-042 | 21 | Pet character art (Claudino and Gremlin) | Not needed while the pet stays out; new art of Txais's own if ever revived. | 2026-10-06 |
| HID-043 | 21 | Shell, editor and terminal-app logos | Own icon set, or names as text. | 2026-10-06 |
| HID-044 | 21 | Integration and phone-platform logos (GitHub, GitLab, Jira, Linear, iOS, Android) | Own icon set, or names as text. | 2026-10-06 |

## 6. New behaviour from 2026-10-06

Txais asked for both on 2026-10-06. Default for both: build in Phase 3 as P1, after every P0 card
passes. Txais may move them to Phase 4. Related live cards: VIEW-015 and VIEW-021 (the Agents screen),
SESS-012 (roles in launch shapes), protected actions in area 10.

### NEW-01 · Suggested agents on the Agents screen

Tier: P1 (new) · Default: build in Phase 3 after every P0 card passes · Recorded 2026-10-06
User does: opens the Agents screen and opens Suggestions (also offered by the empty state on a fresh
  profile), browses by department, picks a suggestion, adjusts it and saves.
User sees: suggestions grouped by department (Finance, Marketing, Operations, Product, Sales, Shared,
  Support) with Support open first; each shows its name, role, the AI it runs on and what it may write;
  picking one opens a new saved agent already filled in (name, instructions, AI, write scope) and marked
  "from a suggestion"; once saved it heads its own group in the Agents rail and + adds a session under it.
Rules: suggestions are read when the screen opens from a folder of agent files the user owns and has
  pointed Kolux at; nothing is bundled (OD-21); each file has a short header (name, department, role,
  AI, write scope, inputs, outputs, connection default, useful connections, a suggestion marker)
  followed by instructions under 4,000 characters; a file missing a required header field is listed as
  unreadable with the reason and never half-loaded; saving copies the suggestion, so later edits to the
  saved agent never change the file and the reverse; this needs a minimal saved-agent record (name,
  instructions, AI, write scope, allowed connections) on the Agents screen, which stands in for the cut
  custom-agent builder for this purpose only and has no builder page of its own. The department set
  Txais has today: Finance (Dalhausser, Kiraly, Lucena); Marketing (Cheng, Hughes, Klineman, Kloth,
  Nuss, Ross, Walsh); Operations (Patterson, Rosenthal, Steffes); Product (Budinger, Partain); Sales
  (Crabb, Gibb, Rogers); Shared (Brunner, Hyden, Stoklos); Support (Bourne, Flint, Sander).
Acceptance:
  - [ ] Point Kolux at a folder of 24 agent files across seven departments → seven groups, Support
        expanded, 24 suggestions.
  - [ ] Pick a suggestion and save → a saved agent of that name appears in the rail marked "from a
        suggestion"; + under it adds a not-started session.
  - [ ] A file with no department → listed as unreadable with the reason; the other files still load.
  - [ ] Edit the saved agent's instructions → the source file is unchanged.
  - [ ] No folder chosen → Suggestions explains how to point Kolux at one; nothing else changes.
Compat: none; the agent file header is new and owned by Kolux RS.

### NEW-02 · Connections a saved agent may use

Tier: P1 (new) · Default: build in Phase 3 after every P0 card passes · Recorded 2026-10-06
User does: launches a saved agent, answers its first-message check-in in plain words, and later opens
  the agent's card to edit or clear the saved connections.
User sees: the first time, the agent starts with every connection its AI has; its first message lists
  them, names the ones its header marks useful, and asks which to use; once answered, the agent's card
  shows the allowed connections with Edit and Clear; on the next launch only those connections reach
  the AI.
Rules: the answer binds for that session; Kolux saves it as the agent's allow-list and shows it on the
  card; at the next launch Kolux passes only the allowed connections through the AI's own per-launch
  connection settings and asks the AI to ignore any others where it offers that option (checked for
  Claude Code and Codex; other AIs unchecked); an AI with no per-launch way launches with every
  connection and its card says the restriction is held in conversation only; read before write: reading
  through a connection is fine, a write needs the user's explicit ask in that session, and protected
  actions stay the backstop; a machine-wide policy set by an administrator or the AI's maker overrides
  Kolux's per-launch settings, and the card says so when Kolux can tell; clearing the list brings the
  check-in back. Decided with Txais on 2026-10-06: every connection is visible, none is used until the
  check-in is answered, and use is read-only until he asks for a write.
Acceptance:
  - [ ] Saved agent with no list → launch → the first message lists the connections and asks; the card
        shows none saved.
  - [ ] Answer "only calendar and mail" → the card lists those two; relaunch → the AI is offered only
        those two.
  - [ ] Clear the list → the next launch asks again.
  - [ ] An AI with no per-launch connection setting → its card says the restriction is conversational
        only.
  - [ ] Ask the agent to change something through a connection without an explicit request to write →
        it asks first.
Compat: none.

## 7. Decisions made for Txais

Calls the dirty-room team made where the spec was inconsistent, duplicated, stale or uncertain. The
loop takes these as written; Txais may flip any of them like an open decision.

| ID | Topic | Default taken | Why | Recorded |
|---|---|---|---|---|
| DT-01 | Two quick-count sets for seats: 1 to 12 plus free entry in the classic dialog, against 1, 2, 3, 4, 6 and 8 on the new session page. | One set everywhere: quick picks 1, 2, 3, 4, 6 and 8, plus a number box up to 12. | One rule, same reach. | 2026-10-06 |
| DT-02 | Empty-seat rules in SESS-007 and SESS-015 were not seen working live. | Build as written; the loop checks them against the installed app before marking them done. | The cards are clear; only the evidence was thin. | 2026-10-06 |
| DT-03 | Where the folded Views & sessions knobs land. | Needs-you strip and header density go to Appearance; default pane count and the remove-session default go to Terminal & sessions. | Each lands beside the thing it changes. | 2026-10-06 |
| DT-04 | Where the "open terminal links in" switch lives (TERM-135). | Terminal & sessions. | The browser settings page is cut. | 2026-10-06 |
| DT-05 | Terminal scrollback and orchestration history on import. | Not carried in the first importer; COMPAT.md marks both optional. | History is closer to a cache than to setup; the format question stays unanswered. | 2026-10-06 |
| DT-06 | Grok is the only AI whose hook settings Kolux removes at quit (STAT-018). | Keep it Grok-only, as the card says. | The other AIs keep their hooks between runs by design. | 2026-10-06 |
| DT-07 | With nothing chosen, the default screen is Board in the menu but Terminals for per-screen themes (VIEW-001, VIEW-006). | Terminals everywhere. | One answer; Terminals is where a fresh user lands. | 2026-10-06 |
| DT-08 | The Floor timeline has no visible way in (VIEW-013). | Reachable from the command palette and the View menu; no sidebar item. | P2; a hidden page is a dead page. | 2026-10-06 |
| DT-09 | The Used or Remaining setting changes only the Agents footer while the top pill always reads left (USAGE-025). | The setting governs every usage figure, pill included. | One setting, one meaning. | 2026-10-06 |
| DT-10 | Usage alerts at 80 % and 95 % have a preference but no visible switch (USAGE-009). | An on/off switch on the Notifications page, on by default. | A preference must be reachable. | 2026-10-06 |
| DT-11 | Several profiles were developer-only, but one default profile is on the live path. | Build the single default profile (area 19); several profiles stay skip. | Matches the H table row for profiles. | 2026-10-06 |
| DT-12 | Model ladder per provider (ACCT-034): the Claude top tier and the whole Codex ladder are not spelled out. | Claude: newest top model at high effort for Major, Opus at high for Deep, Sonnet at medium for Build, Haiku for Light. Codex: newest Codex model at high for Major and Deep, medium for Build, low for Light. The loop fills in current model names at build time and logs them. | The clean room picks; names change faster than the spec. | 2026-10-06 |
| DT-13 | The Runs view is carded twice, in areas 05 and 08, both hidden. | Both stay skip; if revived, build it once under orchestration (area 08). | One feature, one owner. | 2026-10-06 |
| DT-14 | Starting Claude Agent Teams in a Kolux terminal does not work on Windows (ORCH-041). | Stays P1; on Windows the picker shows it disabled with a one-line reason. | It may start working; hiding it loses the path. | 2026-10-06 |
| DT-15 | Coordinator runs left by the old app on import. | Not carried; taking over an old run stays skip. | Follows DT-05. | 2026-10-06 |
| DT-16 | The session tab inventory (ORCH-060) might belong with the cuts. | Keep at P2. | The command line and agents read tab lists from it. | 2026-10-06 |
| DT-17 | Where Automations is reached in the new layout. | Its own page, from the sidebar and the command palette; its show-or-hide switch stays under Appearance. | The settings section is cut but the feature keeps its page. | 2026-10-06 |
| DT-18 | The protected-action pause was not verified under the auto permission mode. | The pause applies in every permission mode, auto included; the loop tests it live. | Safety backstop. | 2026-10-06 |
| DT-19 | The Answer in Code path (EDIT-041) was not seen working live. | Build as written; verify live. | P0 and clear. | 2026-10-06 |
| DT-20 | CI check details (EDIT-030) also served GitLab. | GitHub only. | GitLab is cut. | 2026-10-06 |
| DT-21 | Many cards pushed under a top-five theme sit at P1 or P2 (browser cards included). | Keep their tiers: only the core of each theme is P0. | The readers' "core of the theme" reading. | 2026-10-06 |
| DT-22 | Where the skill setup panel lives once the CLI settings section folds (SKILL-028). | On the Skills page. | That page stays. | 2026-10-06 |
| DT-23 | Skills install through a third-party community installer (SKILL-031). | Keep that route; user-facing text calls it "the community skills installer" and names no package. | The contract is kept; the wording stays neutral. | 2026-10-06 |
| DT-24 | A skill for the run command is not among the bundled skills. | The bundled set stays as the skills cards list it; nothing added. | No card asks for it. | 2026-10-06 |
| DT-25 | Skipping onboarding says it can be reopened from Explore Kolux, but it reopens from the sidebar Onboarding entry. | The message names the sidebar Onboarding entry. | Stale copy. | 2026-10-06 |
| DT-26 | Explore Kolux visit state (ONB-023) is lost on import. | Kept in the profile and carried with interface state. | Progress should survive the switch. | 2026-10-06 |
| DT-27 | A one-time "the board moved" hint has no card. | Not built. | It explained a move inside the old app. | 2026-10-06 |
| DT-28 | Zoom steps (SET-019): the acceptance says two presses is roughly 20 %, another reading gives 44 %. | Half-level steps: two presses make one whole level, roughly 20 %. | The rules define a step as half a level. | 2026-10-06 |
| DT-29 | Update check interval: 30 minutes in the spec, 15 in the plan brief. | 30 minutes. | The spec wins. | 2026-10-06 |
| DT-30 | Keep the computer awake while agents run is carded four times (APP-018, TERM-122, VIEW-097, BROW-053), and its Windows behaviour is unknown. | Built once, owned by area 03; the other three point at it; Windows behaviour is checked live. | One feature, one owner. | 2026-10-06 |
| DT-31 | "Your work stays on the computer and no usage data is sent" (APP-070) was raised to P0. | Keep P0. | Privacy is a daily promise. | 2026-10-06 |
| DT-32 | The pet was listed as removed with OpenCode, yet its switch still existed. | The pet stays skip; no switch for it is kept. | Hidden and unwanted. | 2026-10-06 |
| DT-33 | Stale copy: the add-agents link still names OpenCode, and VIEW-097 mentions the paired web client. | Rewrite both for what Kolux RS ships; never mention removed features. | Stale copy. | 2026-10-06 |
| DT-34 | Shortcuts: new agent has no Windows default; add session, remove session, Inbox and Floor are unbound; the dashboard toggle silently does nothing when the dashboard is off. | New agent gets the Ctrl form of its macOS default if free; the other four stay unbound and can be set on Shortcuts; no dashboard toggle is registered. | No dead keys. | 2026-10-06 |
| DT-35 | Bringing in found repositories (PROJ-013): the acceptance expects a sub-group for a folder holding one repository, but the rules fold such folders away. | The fold rule wins; the acceptance case is tested with two repositories in that folder. | Rules over a single example. | 2026-10-06 |
| DT-36 | Theme 6's rank was an open question in PRIORITIES.md. | The rank PRIORITIES.md gives. | Build order is set there. | 2026-10-06 |
| DT-37 | The per-worktree skip-permissions override (VIEW-054) may describe a control that is gone. | Build only if a click-through of the installed app shows it; otherwise mark it SKIPPED in PLAN.md with the reason. | Do not build a ghost. | 2026-10-06 |
| DT-38 | The names of the bundled text-search tool and the diagram renderer show in user-facing text. | Allowed as plain text where the user sees them. | The readers judged them user-facing. | 2026-10-06 |
| DT-39 | Duplicate cards, each built once by the first area named: usage cards over views (USAGE-008 over VIEW-008, USAGE-004 over VIEW-018); projects over views (PROJ-085 over VIEW-027; PROJ-057, PROJ-055, PROJ-053 and PROJ-083 over VIEW-037, VIEW-046, VIEW-053 and VIEW-014); terminals over views (TERM-094 over VIEW-105); skills over views (SKILL-035 and SKILL-036 over VIEW-012; SKILL-027 over VIEW-100); the CLI over skills (CLI-043 and CLI-044 over SKILL-030 and SKILL-031); app lifecycle over projects (APP-037 and APP-039 over PROJ-089); app lifecycle over status and accounts (APP-053 over STAT-054 and ACCT-051); protected actions over status (SAFE-025 over STAT-056). | Build once; the other card's acceptance must pass against the same build. | One behaviour, one owner. | 2026-10-06 |
| DT-40 | Duplicates where every copy is already H or D: status-bar usage chips (two H cards), sharing skills by link (two H cards), the plugin marketplace (two D cards), a session or terminal in its own window (three H cards). | All copies stay skip or cut; reviving one revives the behaviour once. | Nothing to build. | 2026-10-06 |
| DT-A1 | How ACCT-009 seals secrets is left to the build ("the operating system's own protection"). | Windows DPAPI in current-user scope through `windows-sys`; the profile folder is limited to the current user with `icacls`; macOS and Linux only scramble in this build and log it once. Settings fields `claudeOauthToken` and `xaiApiKey`, managed sign-ins one sealed file each under `<profile>\vault\`. | DPAPI is the system's own user-bound protection; no new licence; files inherit the folder's permissions. | 2026-10-09 |
| DT-A2 | ACCT-006 says the renewal opt-out starts off, but OD-01 ships it on. | OD-01 wins: Kolux never renews a managed Claude sign-in and Claude Code keeps it fresh in its own panes; settings field `claudeSignInUpkeepByClaudeCode`, absent = on. The switch and Kolux-side renewal for when it is turned off are T-043-d. | OD-01 is the newer, explicit call on provider sign-in risk. | 2026-10-09 |
| DT-O1 | PROJ-022 says a custom branch prefix Git would refuse is reported as an error; SET-031 says such a prefix warns and is not used. | SET-031 wins: the workspace is still made, on the bare name, and the create message carries the warning. | Refusing to create over a setting the user typed earlier is the worse surprise; both cards agree the prefix is not used. | 2026-10-09 |
| DT-O2 | PROJ-041 says workspace folders are watched, with polling only where file watching is unreliable. | The sidebar polls Git's own worktree list every 5 s while the window is visible, in both layouts; no folder watcher. | Git's list is the truth for worktrees wherever they live (a watcher would need every possible folder), the same 5 s poll already shows branch switches (PROJ-063), and a burst between two polls is one notice. A watcher can feed the same check later if 5 s feels slow. | 2026-10-09 |
| DT-R01 | APP-024's Compat line and COMPAT.md 5.8 want the rebuild's first release on the old feed (TxaisX/kolux-releases, YAML manifest), while OD-20 says Kolux RS gets its own feed. | OD-20 wins: the feed is `https://github.com/TxaisX/kolux-rs-releases/releases/latest/download/latest.json`, Tauri's signed JSON manifest, signature checking always on. The first install is manual. | The open decision already chose a clean break; the old updater format belongs to the old code base. | 2026-10-09 |
| DT-R02 | APP-027 fetches release notes from the public release page. | The notes ride in the signed manifest's `notes` field; headings, blank lines and rules are dropped, list markers stripped, cut to six lines. | One request, signed with the update, and nothing extra can fail. | 2026-10-09 |
| DT-R03 | APP-024: development and unpackaged copies never update themselves, yet the updater must be proven. | Release builds update only when installed (the uninstaller sits beside the program) and a release key is built in; debug builds update only when `KOLUX_RS_UPDATE_ENDPOINT` and `KOLUX_RS_UPDATE_PUBKEY` are both set, which only the evidence harness does. | A shipped copy can never be pointed elsewhere; the proof still runs the real code. | 2026-10-09 |
| DT-R04 | Update timing details the cards leave open. | Backend check timeout 30 s, the page gives up at 45 s; online recheck 5 s after the connection returns; waking from sleep = a gap of more than 3 minutes between minute ticks; focus checks are skipped while a failed check waits out its retry. | Inside "about a minute" and "after a timeout". | 2026-10-09 |
| DT-R05 | APP-026 dismissed versions and background checks. | A requested check of a dismissed version shows it again (the user asked); background checks never show the card, so a newer version returns on the next requested check or as the ready pop-up once downloaded. The tip is marked done when a download starts but stays visible through that download. | Matches "only checks the user asked for bring up the card". | 2026-10-09 |
| DT-R06 | Where the update card and the ready pop-up sit. | Bottom-left, 16 px in, just above the sidebar's "Next that needs you" row, so the Check for updates button stays visible below. | APP-025 says bottom-left corner. | 2026-10-09 |
| DT-R07 | APP-059 says each release carries the installer, its block map and the update manifest (the old electron-builder files). | A Tauri release carries the NSIS installer, its `.sig` signature and `latest.json`; the signature takes the block map's place. | Tauri's updater has no block map; the signature is what it checks. | 2026-10-09 |
| DT-R08 | APP-058 leaves the AI that writes ship messages open. | `claude -p --model <id>` with the staged diff on stdin, default model `haiku`; `--model` takes any id of letters, digits and . _ : - [ ]; `--message` skips the AI. | The cheapest model writes one line; the CLI is already signed in on the owner's PC. | 2026-10-09 |
| DT-R09 | APP-059: where the new version number is written. | Only in the release checkout (package.json, tauri.conf.json, Cargo.toml) just before the build, never committed; the release tag and the hidden source marker carry it. A version-bump commit (`pnpm ship --main --message "Bump to 0.2.0"`) is how x goes up. | Release commits on main would make every ship conflict with the next. | 2026-10-09 |
| DT-R10 | APP-058 --main: how a worktree branch lands on main. | After the merge with origin, the branch is pushed and then pushed again as `HEAD:main`, which only works as a fast-forward; a refused push stops the ship. | No local main checkout is touched, and nothing is ever force-pushed. | 2026-10-09 |
| DT-R11 | APP-059 Compat: the release checkout and the publish target. | Default checkout `~/.kolux-rs/release-checkout` (`KOLUX_RELEASE_CHECKOUT` moves it); signing key `~/.kolux-rs/release-signing/kolux-rs.key` (`KOLUX_RELEASE_KEY`); `gh release create` to TxaisX/kolux-rs-releases runs only when the origin is GitHub or inside GitHub Actions; `KOLUX_RELEASE_PUBLISH_DIR` publishes to a local folder for rehearsals. | A rehearsal against a throwaway repository can never publish for real. | 2026-10-09 |
| DT-R12 | APP-060 leaves open what each CI shard runs besides its quarter of the front-end tests. | Shard 1 cargo test, 2 clippy, 3 cargo-deny, 4 tsc and the licence, plan and workflow checks; a CI result job is green only when all four are. The CI release builds the commit CI checked out (`--repo $GITHUB_WORKSPACE`) after `scripts/ci-gate.mjs` passes. pnpm 12 and Node 24 on windows-latest. | Spreads the slow Rust steps so the shards finish about together. | 2026-10-09 |
| DT-R13 | EDIT-001 opens files from the explorer, Quick Open, terminal links and the command line, and its acceptance check opens an unreadable file | Until T-094 brings the explorer, a File... item in the New tab menu opens a file through the Windows Open dialog; a file that is not UTF-8 text shows its reason and Retry instead of opening; the read-permission check runs from the explorer in T-094 | The Windows dialog refuses an unreadable file before Kolux RS sees it, so the load-failure path is proved here with a non-UTF-8 file. | 2026-10-09 |
| DT-R14 | EDIT-012 rich markdown editor: which editor, what it writes back, what it cannot show | Lexical (MIT) with its own markdown import and export; a rich edit rewrites the file in Lexical's markdown spelling with every word kept; tables, images, HTML, front matter, reference links, footnotes, horizontal rules and underlined headings keep the file in source with the reason; the preview is marked plus DOMPurify and its links are inert | The card names no editor; markdown-it needs argparse, whose Python-2.0 licence the build brief does not allow; Lexical's markdown support has no place for those constructs, so such files keep their exact text in source instead of being changed. | 2026-10-09 |
| DT-R15 | EDIT-027 diff tab: what "showing whitespace changes" means, how it follows git status, where it opens from | Off means changes made only of whitespace are left out of the diff (the text is still shown); the tab reads its two sides again every 2 s while it is in front; until Source Control (T-033) and kolux file diff (T-236) exist, a Changed file diff... item in the New tab menu lists the worktree's staged, unstaged and untracked files | The card does not say whether whitespace display means visible space marks or whitespace-only changes; hiding whitespace-only changes is what lets a reader see the real edits. No git status watcher exists yet, and 2 s keeps the diff current without one. | 2026-10-09 |
| DT-R16 | EDIT-029 All Changes: thresholds, refresh, entry point, what viewed means | A section over 2000 changed lines (added plus removed) waits for Load diff; a text section stops at 560 px and scrolls inside itself; unchanged runs fold to 3 lines of context; png, jpg, gif, webp, bmp, ico and svg show before and after at natural size, other binaries are named only; changes are read every 2 s while the tab is in front; a viewed mark belongs to that exact change and clears when the file changes again, and lasts while the tab is open; the tab opens from New tab > All Changes, one per cell, until Source Control and kolux file exist | The card names a threshold and a ceiling without values; 2000 lines is where a CodeMirror diff starts to take a noticeable moment, 560 px keeps two sections on a laptop screen. A tick that survived a later edit would mark unseen lines as reviewed. No git status watcher exists yet. | 2026-10-09 |
| DT-R17 | EDIT-033 explorer: where it sits, how it opens, what it shows | The explorer is a 280 px card on the right of the Terminals screen, closed at start; Ctrl+Shift+E opens it and puts the keyboard in the tree, and pressed in the tree hides it; the top bar's right-panel button toggles it; folders come first, then names in plain alphabetical order ignoring case (file10 before file2); .git is left out; rows are 22 px; while the tree has the keyboard only global shortcuts apply | The card names the shortcut and the behaviour but not the placement or ordering. Closed at start keeps the first screen as it was. Plain ordering is what a directory listing gives; natural number ordering can come with the explorer toolbar if wanted. | 2026-10-09 |
| DT-R18 | EDIT-034 explorer file operations, part 1: where they start and how undo behaves | New file and New folder are two buttons in the explorer header and add a name row at the top of the highlighted folder (or the folder holding the highlighted file); F2 renames the highlighted row inline, with the name before the extension selected; Delete asks once in a bar inside the explorer; undo of a create sends the new item to the trash; undo history is per explorer and lives only while the app runs; on a WSL share the question says the delete is for good and nothing is kept to undo; refusals and failures show as a line inside the explorer, not a popup; copy path goes through the app side (Win32 clipboard) and falls back to the web clipboard elsewhere; on macOS redo is Mod+Shift+Z only and Mod+Backspace also deletes | The card names the operations and their rules, not where they start. Header buttons and F2 are what desktop file trees use. Sending an undone create to the trash keeps any text typed into it recoverable. Keeping history in memory matches an editor's undo. The web clipboard refuses when the window is not in front, so the app writes it; tauri-plugin-clipboard-manager was not used because two of its crates are BSL-1.0, which is not on the licence list. | 2026-10-09 |
| DT-R19 | EDIT-034 explorer file operations, part 2: copy, drag to move, desktop drop | Mod+C picks the selection and Mod+V copies it into the highlighted folder, or the folder holding the highlighted file; there is no cut; a taken name becomes "name copy.ext", then "name copy 2.ext"; links inside a copied folder are left out and the note says how many; a drag starts after 4 px, lands in the folder under the pointer (a file row means its folder, the empty area below the rows means the worktree root), is outlined while it hovers, and released outside the tree does nothing; a desktop drop lands the same way; undo of a copy or drop sends the copies to the trash, undo of a move moves each item back; a move to another drive is refused for now | The card gives the rules, not the gestures. Mod+C and Mod+V are what file trees use; a cut is left out because a drag covers moving. The " copy" suffix is what Windows and macOS file managers do. A drag works with pointer events because the Windows web view hands HTML drags to the desktop drop handler. | 2026-10-09 |
| DT-R20 | EDIT-036 Quick Open ranking and its missing-ripgrep path | A hit at the start of the file name ranks first, then anywhere in the name, then the query's letters in order in the name, then a hit in the folder path, then letters in order across the path; ties go to the shorter path, then list order; spaces in the query are ignored. At most 50 results. The list is capped at 200,000 files. With no ripgrep the dialog names winget, brew or the package manager, offers Retry, and lists git's tracked and untracked files. The same ranking, 50-row limit, row layout (name, then a dimmed folder) and pointer tooltip apply to the markdown picker (Mod+Shift+O) and the New tab menu's changed-file picker, which is the file search that menu has today | The card gives the order of name over folder hits, not the finer tiers; prefix-first and letters-in-order are what Go to File pickers commonly do. 200,000 keeps a 100,000-file worktree whole. Sharing one picker keeps the three file lists alike, as the card asks for the New tab menu. | 2026-10-09 |
| DT-R21 | SKILL-036 / VIEW-012 Artifacts store and viewer | Each entry is stored in the app data folder under artifacts/<id>/ with one library.json; the id is a hash of the page's original path, so adding the same file again replaces its entry. Only files inside the page's own folder that the page names in src, href or poster are copied, within 100 files, 10 MB each, 50 MB in all and a 10 MB page; CSS url() and srcset are not followed. Pages are served by a kolux-artifact scheme that hands out only that entry's files, with a page policy that lets it load nothing else and post no forms; the frame runs scripts and forms but has no same-origin access. A click on a link to another file of the entry stays in the viewer, a link elsewhere on the scheme does nothing, and any other link goes to the system browser (web and mail links only). A page on a network share is listed as unavailable and never read. Artifacts opens from the sidebar and stays out of the top bar's screen switcher | The card asks for a sandboxed viewer serving only the entry's files; a per-origin id keeps the library free of duplicates. The caps keep one hand-added page from filling the disk. Following CSS and srcset is left until a captured page needs it. | 2026-10-09 |
| DT-R22 | SKILL-035 capture of Claude publishes | Publishes are picked up from Claude Code's session transcripts only (the JSON lines under its config folder's projects folder, CLAUDE_CONFIG_DIR or .claude in the home folder, subagent transcripts included), never from terminal output: the card allows either, and a transcript names the tool, so other tools' look-alike results and prose cannot match. A publish counts only when an Artifact call without asset or a non-publish action, for an .html or .htm page, gets a result that is not an error and carries a claude.ai artifact URL. The watcher polls every 2 s and reads each file from its end when the app starts; a publish whose transcript time is more than 60 s before start is treated as replay (resumed or copied sessions). One entry per URL; the publish with the newest transcript time wins, so a replayed older one never replaces it. Project is the session folder's name, session is its id. Scripts from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm, unpkg.com, cdn.tailwindcss.com and code.jquery.com (the hosts Claude's own artifact viewer allows) are fetched into cdn/<n>.js, at most 16 of 5 MB each within the 50 MB total; a failed fetch keeps the address, and the viewer's page policy now lets scripts load from those hosts too. A path that is not absolute on this machine (a WSL or SSH machine's) is listed as remote and never read | Transcripts are the one place a publish is unambiguous. Reading from the end keeps old history out; the 60 s slack lets a publish made while the app was starting still count. Polling avoids a file-watcher crate for a 2 s delay nobody notices. A publish whose call was written before start and result after it is missed. | 2026-10-09 |
| DT-R23 | CLI-011 / APP-056 kolux open | `open` (and `--json`) first asks a running app over the CLI port to restore its window, show it and take the focus; only when no app answers (no cli.json, or a stale one whose port is dead) does it start the app once and ask again every 250 ms, up to 60 s, then fail with exit 1. Any other failure (a wrong token, say) is reported as it is and nothing is started. The app started is KOLUX_APP_EXECUTABLE when set, else the app program beside the command (kolux-rs.exe beside kolux-dev.exe), started detached so closing the terminal or Ctrl+C leaves it running. The command reads the app's data folder from KOLUX_USER_DATA_PATH when set (COMPAT 7), so a lane or test build can be reached. The result is {ready, started, pid}. KOLUX_OPEN_COMMAND and KOLUX_APP_EXECUTABLE_NEEDS_APP_ROOT are not read: they served the old app's launcher. There is no background terminal service in this build yet, so the wait-for-the-service rule goes to T-075 | Asking first means an open app is never started twice; one start and a time limit mean a broken install fails instead of hanging. 60 s covers a cold debug build (4.4 s seen). | 2026-10-09 |
| DT-R24 | ACCT-001 / ACCT-003 Connect grid and installs | The page shows Claude, Codex and Grok cards in a grid, each with a one-line tagline; until the agent list answers a card is a loading placeholder. A missing agent installs through WinGet: Anthropic.ClaudeCode, OpenAI.Codex and xAI.GrokBuild (xAI's own Grok Build package, which provides `grok`), with `--exact --source winget`, both agreements accepted and interactivity off, run in a hidden terminal so WinGet draws its progress (it prints none into a pipe). Progress is the last `x MB / y MB` or `n%` it printed. After a clean finish the PATH is read again from the registry (machine, then user, expanded), registry folders first and folders only this process had kept after them, and the card checks the program is now found: if not, the install counts as failed with Try installing again. Exit codes from WinGet's public list: already installed and no applicable update count as installed; security check failed is the SmartScreen reason (Open install page); policy block, no packages found and no applicable installer are install-unavailable (Open install page); another install running, no network, disk full, reboot needed and hash mismatch are failures with their own words; others show the hex code. Without WinGet the card offers the install page (x.ai/cli for Grok). Cancel and a second Install stop WinGet itself; an installer it already started may finish. Grok has no vendor mark until a public xAI brand-kit file is obtained. The Codex accounts list stays inside the Codex card until T-138 | WinGet is on every supported Windows and is what the card names; the registry re-read is what a new terminal would see. Checking the program after a clean finish keeps a quiet failure from looking like nothing happened. | 2026-10-11 |
| DT-R25 | ACCT-002 / ACCT-008 Connect card states and Grok sign-in | Grok signs in through the Grok CLI's own `grok login` (browser) or `grok login --device-auth` run hidden against the user's own Grok home, not a private one: the card promises "the Grok CLI's login" and a sign-in the user already made must show as connected. Kolux tells a sign-in by the presence of `auth.json` in `GROK_HOME`, else `~/.grok` (Grok's public authentication guide) and never reads the file. A pasted xAI key is stored sealed in `xaiApiKey` and given to new Grok panes as `XAI_API_KEY`; Grok itself prefers its session over the key, as the card does. Every card offers its other ways in under one "Other ways to connect" menu; Cancel shows while a sign-in runs and whenever a needs-attention note lingers, and with nothing running it wipes that note. A connect choice is greyed while its request is pending and comes back after 30 s. The key field is a password field with the reveal button hidden. Manage and Disconnect on the connected Codex and Grok cards are T-202 | Grok's own login keeps one sign-in for the terminal and Kolux alike, and checking a file's presence keeps Kolux out of the credential itself. | 2026-10-11 |
| DT-R30 | SKILL-001..005 Starter kits | A Starter kits row in the sidebar opens a gallery of six kits (spreadsheet analysis, tidy and merge two files, marketing campaign report, research brief, sales follow-up list, weekly metrics), each with a category badge, an estimated time and its three roles. A role goes to its preferred AI when that AI is connected, otherwise round the connected ones in the order Claude, Codex, Grok; "connected" means installed and not switched off in Agents. Kit results go to a kit-results folder at the project root, one subfolder per role. Try with sample data copies the kit's built-in sample files into one folder per kit inside a samples folder next to the default workspaces folder (kolux-rssamples in the home folder), commits them once as "First commit" under the name Kolux RS samples <samples@kolux-rs.invalid> so it works before Git has a user name, and opens it as a project; a second try changes nothing and never overwrites a file. Inputs typed for a real project are remembered per project and kit in settings; sample runs are not. An Excel workbook is refused with how to save it as CSV; quotes around a pasted path are dropped. | Kits must work on a fresh PC with any one AI; the samples need to be a normal project so the AIs' work lands in Git like any other. The results folder name and the sample identity are new names, easy to change before release. | 2026-10-12 |
| DT-R29 | GIT-061 Start Git in a plain folder | Adding a folder that has no Git (typed, or picked with Browse) opens "Start Git in this folder?" instead of an error. It lists every file the first commit would take, honouring the folder's .gitignore, each with a tick box. Names that look like secrets start unticked and say "looks like a secret, left out": .env and .env.* (not .example, .sample, .template, .dist), *.env, key and certificate files (.pem, .key, .p12, .pfx, .jks, .keystore, .ppk, .kdbx), SSH private keys, .netrc, .npmrc, .pypirc, .git-credentials, credentials files, and data files whose name holds "secret" or "token". Start Git and commit runs git init, adds exactly the ticked files and commits them as "First commit" with the user's own Git name and email; the folder then becomes a project like any repository. If any step fails, the new .git is removed so the folder is as it was. A relative path, a missing folder, or a folder already in Git is refused with a plain sentence. The preview asks Git through a scratch repository in the temp folder, so the folder is not touched until he confirms. | A secret that reaches a first commit stays in history; leaving those names out by default costs one tick when a file is wrongly flagged. Names only, no content scanning, so the check is instant and predictable. | 2026-10-12 |
| DT-R28 | ACCT-015 Disconnect | Every Disconnect asks first. Claude's erases the 1-year key Kolux saved. Codex's removes the active account Kolux made (its listing, the Codex home inside Kolux's own accounts folder, and its sealed copy) and leaves no account active; an entry whose home is anywhere else is only unlisted. With only Codex's own login, or only the Grok CLI's sign-in, Disconnect deletes nothing and explains with a single OK how to sign out in that tool (`codex logout`, `grok logout`). Grok's erases only the xAI key Kolux saved, through the same secret-clear path as Settings. A connected Codex or Grok card has Manage (the ways to add or redo a sign-in, in the same menu as Other ways to connect) beside Disconnect. On quit Kolux cancels every hidden sign-in, key setup and install still running and waits up to 2 s for them to stop. | Txais's own logins stay his to sign out of; the only thing Kolux ever deletes is something it created. Removing the active Codex account does not pick another one, so panes never switch accounts behind his back. | 2026-10-12 |
| DT-R27 | CLI-006 / CLI-010 / CLI-038 Windows shim, reaching the app, safe retry | An installed copy carries `kolux.exe` (a separate `kolux` program built only by the release script, so a development build never puts a `kolux` on its panes' search path) and `kolux.cmd` in a `bin` folder of the install, and new panes put that folder first; the shim declines orchestration send and reply with exit 2 and a missing `kolux.exe` with exit 1. Only a refused connection or a missing endpoint file counts as "Kolux is not running" (with the `open` command to run); an answer that does not come back is `lost_result`, a slow one `timeout`, and an app that does not know a command this CLI knows is a `version_gap`. Every orchestration change gets a lasting UUID retry id; when its answer is lost the CLI prints the exact command to finish it with `--retry-request`, which only takes a UUID. `request-show --request` says whether that change took effect; `reset` needs exactly one of `--all`, `--tasks` (tasks and dispatches) or `--messages` (messages and deliveries), and clears the remembered answers of that scope. New panes drop an inherited `KOLUX_USER_DATA_PATH`. | With default PATHEXT a bare `kolux` in the bin folder finds `kolux.exe` before `kolux.cmd`; that is the safer of the two for multi-line bodies, and which name the system PATH points at is T-250's call. A Kolux started from another copy's terminal otherwise sent its panes' commands to that copy. | 2026-10-12 |
| DT-R26 | SESS-002 / SESS-003 / SESS-006 / SESS-008 / SESS-010 agent menus, default agent and the create menu | A fresh install has no default agent: no row carries the "Default" chip and the new-agent shortcut sits on the first row until the user picks one with "Set as default"; switching the default agent off clears the default. Refresh agents runs one search, tells every window, and a seat whose agent vanished or was switched off goes blank rather than falling back to another agent. A failed search keeps the last list and shows a warning instead of "No agent found". The create menu lists each installed shell once, Windows PowerShell first, then PowerShell 7, Command Prompt, Git Bash, and WSL only when a WSL distribution is set as default; each shell tab names itself in its header. Remove session drops the newest empty chooser first and never closes the last pane when it is a chooser. | The spec forbids Kolux picking an AI for the user, so the old "Claude Code by default" is gone; WSL without a distribution only prints an install message, so it is hidden. | 2026-10-11 |

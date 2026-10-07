# BridgeMind improvement cards (69 parsed)

Sources: repo `docs/research/bridgemind/kolux-improvements-from-bridgemind.md` (id, priority, size, title; no shipped markers in the repo doc) and the vault page (markers). Dates: card-section markers carry date; vault table markers do not. Cards in the "named in tag message" column are from the vault's Correction note 2026-09-28 (v0.12.0, commit 070c3e368), not marked on the card itself. Later HANDOFF.md work citing card ids: PROD-7 protected actions (2026-09-29), WORK-1 restore (2026-09-29), ACCT-7 sign-in opt-out (2026-09-28) are cited in HANDOFF.md Recent work as shipped.

| id | priority | size | title | shipped / unshipped marker |
|---|---|---|---|---|
| ACCT-1 | P0 | S | Stop the installed build from offering cloud features that point at placeholder hosts | Shipped in 0.12.0 (vault table, no date; v0.12.0 tagged 2026-09-28); Shipped in 0.12.0 on 2026-09-28: "cloud features without a server hidden" (vault card section) |
| ACCT-2 | P0 | M | An agent stopped by a usage limit or expired sign-in must not show as "Done" | Shipped in 0.12.0 (vault table, no date; v0.12.0 tagged 2026-09-28); Shipped in 0.12.0 on 2026-09-28: "a Stopped state for agents halted by usage limits or sign-in" (vault card section) |
| AGENT-1 | P0 | S | Multi-seat launches stop silently sharing one folder | Shipped in 0.12.0 (vault table, no date; v0.12.0 tagged 2026-09-28); Shipped in 0.12.0 on 2026-09-28: "new-worktree-per-agent launches with shapes and roles" (vault card section) |
| AGENT-2 | P0 | S | Put shapes and roles back into New session | Named in v0.12.0 tag message (shapes and roles (inferred, not verified)), 2026-09-28 per vault correction note |
| PROD-1 | P0 | S | Send Feedback and crash reports actually reach you | Shipped in 0.12.0 (vault table, no date; v0.12.0 tagged 2026-09-28); Shipped in 0.12.0 on 2026-09-28: "feedback via GitHub issues" (vault card section) |
| TERM-1 | P0 | S | A terminal copy never fails silently | Shipped in 0.12.0 (vault table, no date; v0.12.0 tagged 2026-09-28); Shipped in 0.12.0 on 2026-09-28: "copy-failure toasts" (vault card section) |
| VOICE-1 | P0 | S | Dictated text is never silently lost | Shipped in 0.12.0 (vault table, no date; v0.12.0 tagged 2026-09-28); Shipped in 0.12.0 on 2026-09-28: "dictation that is never lost" (vault card section) |
| ACCT-3 | P1 | M | Out of quota: switch account and resume the same session (Claude and Codex, opt-in automatic) | no marker (unshipped or unrecorded) |
| ACCT-4 | P1 | M | Warn before the limit, and before launching a Swarm on an almost-empty account | no marker (unshipped or unrecorded) |
| ACCT-5 | P1 | S | Say plainly, outside Settings, when an account's sign-in has died | Named in v0.12.0 tag message (sign-in expiry notices), 2026-09-28 per vault correction note |
| ACCT-6 | P1 | M | Launch roles remember an agent and model, and the lineup remembers your last picks | no marker (unshipped or unrecorded) |
| ACCT-7 | P1 | S | Decide and document how Kolux uses Claude subscription sign-ins | Shipped 2026-09-28 (HANDOFF.md Recent work: Claude sign-in opt-out) |
| ACCT-8 | P1 | M | Make the phone companion installable from Kolux-owned links, or say it isn't yet | no marker (unshipped or unrecorded) |
| AGENT-3 | P1 | M | Check a worker's "done" against its real diff | no marker (unshipped or unrecorded) |
| AGENT-4 | P1 | S | Alert when an agent has been "working" with no output for too long | Named in v0.12.0 tag message (quiet-agent alerts), 2026-09-28 per vault correction note |
| AGENT-5 | P1 | M | Warn live when two agents touch the same file | no marker (unshipped or unrecorded) |
| AGENT-6 | P1 | M | Save your own shapes and launch them again in one click | no marker (unshipped or unrecorded) |
| AGENT-7 | P1 | M | One multi-agent control tower, on by default, showing who is on which task | no marker (unshipped or unrecorded) |
| AGENT-8 | P1 | M | Loops: repeat until done, with a required cap and a stop button | no marker (unshipped or unrecorded) |
| AGENT-9 | P1 | M | A "Lead" seat that starts a coordinator from the launcher | no marker (unshipped or unrecorded) |
| PROD-2 | P1 | S | Hide or fix every feature wired to a dead server | Named in v0.12.0 tag message (hidden dead-server features), 2026-09-28 per vault correction note |
| PROD-3 | P1 | S | Release notes you can read before you click Update | Named in v0.12.0 tag message (release notes in update card), 2026-09-28 per vault correction note |
| PROD-4 | P1 | M | Tell the user when an update did not actually install | no marker (unshipped or unrecorded) |
| PROD-5 | P1 | M | Nothing ships until CI is green and the installed app has booted | no marker (unshipped or unrecorded) |
| PROD-6 | P1 | M | Sign the Windows installer, the app and the uninstaller | no marker (unshipped or unrecorded) |
| PROD-7 | P1 | M | A guard that stops agents before irreversible commands | Shipped 2026-09-29 (HANDOFF.md Recent work: Protected actions) |
| TERM-2 | P1 | M | Terminal smoke test on the packaged build before every release is published | no marker (unshipped or unrecorded) |
| TERM-3 | P1 | M | Installed-build load benchmark with published numbers (4 / 8 / 16 agents) | no marker (unshipped or unrecorded) |
| TERM-4 | P1 | M | Focus-storm soak: window unfocus/refocus and rapid pane clicking | no marker (unshipped or unrecorded) |
| TERM-5 | P1 | S | "Copy terminal diagnostics" in the UI instead of a DevTools-only freeze report | Named in v0.12.0 tag message (Copy terminal diagnostics), 2026-09-28 per vault correction note |
| TERM-6 | P1 | M | React to system memory pressure when many terminals are open | no marker (unshipped or unrecorded) |
| TERM-7 | P1 | M | Per-agent terminal conformance run (Claude, Codex, Gemini, Copilot, Aider) | no marker (unshipped or unrecorded) |
| VOICE-2 | P1 | S | Push-to-talk you can trust: test it, bind a mouse button, hear it | Named in v0.12.0 tag message (push-to-talk with test box), 2026-09-28 per vault correction note |
| VOICE-3 | P1 | S | Show where dictation will land | no marker (unshipped or unrecorded) |
| VOICE-4 | P1 | M | Sharpen a prompt before sending, opt-in and scope-guarded | no marker (unshipped or unrecorded) |
| VOICE-5 | P1 | M | Custom vocabulary so product names come out right | no marker (unshipped or unrecorded) |
| VOICE-6 | P1 | M | MCP servers: test the connection, then copy across agents | no marker (unshipped or unrecorded) |
| WORK-1 | P1 | S | Restart and resume fidelity check on the installed build | Shipped 2026-09-29 (HANDOFF.md Recent work: terminal/workspace restore) |
| WORK-2 | P1 | S | "Review before ship" button on the source-control panel | Named in v0.12.0 tag message (Review changes), 2026-09-28 per vault correction note |
| WORK-3 | P1 | M | Revert a commit from the git history panel | no marker (unshipped or unrecorded) |
| WORK-4 | P1 | S | Browser and editor surface checks on the installed build | no marker (unshipped or unrecorded) |
| ACCT-10 | P2 | S | Live model lists for Codex and Gemini, like Claude already has | no marker (unshipped or unrecorded) |
| ACCT-11 | P2 | S | Flag models that bill outside the plan | no marker (unshipped or unrecorded) |
| ACCT-12 | P2 | M | Kolux Cloud go-live checklist for sign-in and entitlements | no marker (unshipped or unrecorded) |
| ACCT-13 | P2 | S | Per-SSH-host startup commands | no marker (unshipped or unrecorded) |
| ACCT-9 | P2 | S | Account sign-in: "copy the sign-in link" fallback and Cancel for Codex | no marker (unshipped or unrecorded) |
| AGENT-10 | P2 | S | A "No sub-agents" switch per launch | no marker (unshipped or unrecorded) |
| AGENT-11 | P2 | S | Say who woke an agent | no marker (unshipped or unrecorded) |
| AGENT-12 | P2 | S | Names that tell seats apart | no marker (unshipped or unrecorded) |
| AGENT-13 | P2 | S | Guidance when a wave gets big | no marker (unshipped or unrecorded) |
| AGENT-14 | P2 | M | Error-feed and ticket triggers for automations | no marker (unshipped or unrecorded) |
| PROD-10 | P2 | S | A short "first 30 minutes" guide behind Help > Docs | no marker (unshipped or unrecorded) |
| PROD-11 | P2 | S | An honest "How Kolux differs" section with real Kolux screenshots | no marker (unshipped or unrecorded) |
| PROD-8 | P2 | M | An automation that triages new GitHub issues | no marker (unshipped or unrecorded) |
| PROD-9 | P2 | M | Roll back to the previous release from inside the app | no marker (unshipped or unrecorded) |
| TERM-10 | P2 | S | Periodic WebGL glyph-atlas budget for long sessions | no marker (unshipped or unrecorded) |
| TERM-11 | P2 | M | Numbered panes you can target by number (keyboard, dictation, CLI) | no marker (unshipped or unrecorded) |
| TERM-12 | P2 | S | Touchscreen scrolling in terminal panes | no marker (unshipped or unrecorded) |
| TERM-13 | P2 | S | Visual check for gutters, ghost scrollbars and fullscreen fit across pane sizes | no marker (unshipped or unrecorded) |
| TERM-8 | P2 | S | Pasting a screenshot into a WSL terminal gives a Linux path | no marker (unshipped or unrecorded) |
| TERM-9 | P2 | S | Paste several copied images at once | no marker (unshipped or unrecorded) |
| VOICE-10 | P2 | M | Create a skill from the Skills page | no marker (unshipped or unrecorded) |
| VOICE-7 | P2 | S | Choose what dictation does with the text: insert, copy, or both | no marker (unshipped or unrecorded) |
| VOICE-8 | P2 | S | Voice setup check and first-run guide | no marker (unshipped or unrecorded) |
| VOICE-9 | P2 | S | Dictate into the built-in browser pane | no marker (unshipped or unrecorded) |
| WORK-5 | P2 | M | Pop a browser or diff tab out into its own OS window | no marker (unshipped or unrecorded) |
| WORK-6 | P2 | M | Let the app's own colors follow the chosen terminal theme | no marker (unshipped or unrecorded) |
| WORK-7 | P2 | S | A polish pass on the status bar and chrome using Kolux's own rubric | no marker (unshipped or unrecorded) |
| WORK-8 | P2 | M | Dev container as an environment recipe | no marker (unshipped or unrecorded) |

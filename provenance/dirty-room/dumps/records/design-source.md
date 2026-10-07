# Design source: "Kolux UI Redesign Concepts"

- Reference text (HANDOFF-HISTORY.md line 88, entry "2026-10-05: Redesign landed on main + design-gap pass", not line 71): `**Design source:** "Kolux UI Redesign Concepts" artifact (https://claude.ai/artifact/AWRPP4zxdVnGSxBqAmJL4B), page "Current design" = boards 6 Terminals, 7 New session, 8 Agents chat, 9 Swarm, 12 Settings > Views & sessions, Board-live. "Archive" page boards are not targets.`
- Location: EXTERNAL, a claude.ai Design (canvas) artifact, https://claude.ai/artifact/AWRPP4zxdVnGSxBqAmJL4B (owned by the user, private). NOT on disk in the old repo. Read read-only via the Artifact tool, `project/canvas.json`, version 1791249933-85da, 34 published files; canvas created 2026-09-29T19:30:00Z (createdOnFiles). Board sources (`*.dc.html`) were not fetched, only the index.
- Related on-disk (different, earlier doc): `docs/redesign/three-mode-shell.md` and `docs/redesign/prototype/three-mode-prototype.html` (the 0.3.0 "three-mode shell").
- Canvas pages: "Current design" (id current), "Archive" (id archive). Canvas title: Kolux UI Redesign Concepts.

## Page "Current design" (the build targets)
- Heading note: "Kolux - the design we are building (6-9, 12, and the live-terminal Board)"
- 6 - Terminals - clean grid of live terminals, in-pane AI + model chooser (TerminalOnly.dc.html)
- 7 - New session - saved teams, how many, you pick each AI (NewSessionPage.dc.html)
- 8 - Agents - chat with an agent you built (AgentChat.dc.html)
- 9 - Swarm - sessions grouped by status, act from each pane (SwarmGrid.dc.html)
- 12 - Settings > Views & sessions - one place for these choices (SettingsViews.dc.html)
- 10 -> Board - each current session is a card with its live terminal inside (no floating terminals) (BoardLive.dc.html)

## Page "Archive" (not targets)
- Heading notes: "Kolux - four redesign directions (same moment: a 3-AI spreadsheet kit, one AI needs you)"; "Chosen: Board (B) + Terminals (C) - user-built agents, add sessions anywhere, you always pick the AI"; "From your references: terminal-only, new session, agent chat, swarm grid"; "Refined after the design review: states, empty states, settings, ready-made teams"
- A - Calm Studio - refined evolution of today's layout (Main)
- B - Mission Board - results first, terminals tucked away
- C - Night Shift - dark, dense, for power users
- D - Kit Launcher - starting a job, redesigned
- 1 - First run - choose Board or Terminals
- 2 - Add sessions - you pick the AI for every one
- 3 - Your agents - build your own
- 4 - Board - cards + results rail, per-card input, in-card chooser
- 5 - (retired - replaced by 6) Terminals with popover
- 10 - Every session state - Board card vs Terminals pane, and what "-" does
- 11 - Empty states - first session, first agent
- 13 - Start from a ready-made team - you choose every AI

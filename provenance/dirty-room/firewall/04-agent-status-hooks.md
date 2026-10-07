# Firewall scrub report: 04 · Agent status, hooks & notifications

- Stage: 3 (Firewall), 2026-10-06
- Input: `provenance/dirty-room/cards-raw/04-agent-status-hooks.json` (60 cards, D-04-001 … D-04-060, all round 0; critic notes applied by the reader)
- Output: `spec/04-agent-status-hooks.md` (ids STAT-nnn, number kept from D-04-nnn)

## Cards written per tier

| Tier | Cards in JSON | Cards in spec |
|---|---|---|
| P0 | 13 | 13 |
| P1 | 39 | 39 |
| P2 | 4 | 4 |
| H | 2 | 2 |
| X | 0 | 0 |
| D | 2 | 2 |
| **Total** | **60** | **60** |

Sorted by tier, then pushed (null last), then id. Every card has at least two acceptance items (124 in all): 45 cards
had a single acceptance item in the JSON, four of them the H/D cards' "n/a — decision item"; the second
item was derived from that card's own rules, not from test titles. H and D cards carry `Decision:`.

## Leaks found and how each was fixed (30)

| Category | Count | Where (raw card) | Fix |
|---|---|---|---|
| Path / file name | 9 | `~/.claude/settings.json` (D-04-007); Codex `config.toml` (008); Kimi `config.toml` (015); Hermes `config.yaml` (016); Antigravity `hooks.json` (010); `/hook/devin` route (001, 019); `curl.exe` (006); `cmd.exe` (055) | Described as "Claude Code's user settings", "Codex's own TOML settings", "Hermes's YAML settings", "one global hooks bundle", "a per-agent address" dropped, "the classic command prompt" |
| Identifier | 15 | setting keys `agentStatusHooksEnabled` (002), `agentStopped` (023), `tabAutoGenerateTitle` (035), `agentTaskComplete` (041), `notifications.*` (023, 041, 045, 058), `quietAgentThresholdMinutes` (045), `minimizeToTrayOnClose` (047); env vars `CLAUDE_CONFIG_DIR` (007), `COPILOT_HOME` (017), `GROK_HOME` (018), `APPDATA` (019); keybinding id `terminals.focusNextNeedsYou` (051); Cursor camelCase event names (012); Hermes snake_case hook names (016); MiMo plugin event names incl. `AskUserQuestion` (020) | Settings named as shown or as "the saved on/off choice"; env vars as "the config-folder / home-folder override"; event names spelled out in words; keybinding id kept by reference ("keep the old keybinding command id") |
| Schema | 3 | notification settings field list incl. `customSoundId/Path/Volume` (042); sound ids `system, two-tone, bong …` (043); hook payload shape "JSON over local HTTP … pane key and token" (001) | Replaced by "carry over every saved choice", "nine short built-in tones", "address, token and pane identity the hooks need" |
| UI copy | 1 | synthetic tab titles `'<agent> ready'`, `'<agent> - action required'` (035) | Described in words ("the agent's name followed by ready or by action required") |
| Library / tool | 1 | `curl` with connect and total time limits (006) | "the delivery step has a connection limit and an overall limit"; Windows: "the system's own HTTP command-line tool" |
| Error text | 0 | none quoted in the raw cards | — |
| Verbatim prose (script) | 1 | `code-keyword` false positive "import C" (Devin: "set to import Claude Code's settings") | Reworded to "load Claude Code's settings" |

Quoted labels kept (all ≤ 6 words, things the user clicks or reads as a control): 'Agent status hooks',
'Agent Stopped', 'Agent Task Complete', 'Answer in Code', 'Auto-generate tab titles', 'Clear completed',
'Next That Needs You', 'Notifications', 'Open in Code', 'Open Settings', 'Send Test Notification',
'Show Inbox', 'Sign in again', 'Suppress While Focused', 'Thought'.

## Similarity hunt

1. Brief method: 3 phrases per card (7-word windows from the middle of each card's three longest
   clauses) = **180 phrases**, `rg -iF` against `src`, `tests`, `docs`, `README.md`, `HANDOFF.md`,
   `HANDOFF-HISTORY.md` → **0 hits**.
2. Extra, stricter pass: every 6-word window inside a clause of the spec prose (3,250 windows), same
   paths → **12 distinct windows matched** on the first pass, in 11 sentences. All 11 sentences were
   rewritten; the re-run gave 0 hits for both passes.

| Matched window (old repo) | Spec card | Rewrite |
|---|---|---|
| "an attention dot on the tray icon" | scope paragraph | "a tray icon that gains a dot when something wants the user" |
| "when the terminal is git bash" | STAT-055 | "even if the user's shell is Git Bash" |
| "returns an idle session to done" | STAT-021 | "once it closes a session with nothing running goes back to done" |
| "ends a stuck working row as" | STAT-029 | "compacting by hand settles a row stuck on working into a quiet done" |
| "only while the window is hidden" | STAT-047 | "shown only when the window is minimised or out of sight" |
| "whose process cannot be proven dead" | STAT-030 | "whose process might still be alive" |
| "an agent on an ssh host" | STAT-060 | "starts an agent on a remote machine reached over SSH" |
| "even when kolux runs on windows" | STAT-060 | "even from a Windows computer" |
| "for the rest of the session" / "dropped for the rest of the" | STAT-031 | "any late events for it are ignored until Kolux quits" |
| "while the agent is still working" | STAT-014 | "a fresh prompt appearing in the transcript mid-turn" |
| "and it clears as soon as" | STAT-027 | "the card goes away once the agent resumes after being answered" |

Tooling note: the ripgrep available here (VS Code's bundled `rg.exe` 15.0.0; none is on PATH) searched
only 75 files when handed all six paths in one call, but 22,009 files when run path by path. Both
passes above were therefore run path by path (src 21,225 files, tests 709, docs 72, plus the three
root files).

## Final script line

`firewall-check: 0 hit(s) across 1 file(s)`

## Allowlist candidates (rewritten around, not added)

- Cursor hook events (public, camelCase): `beforeSubmitPrompt`, `preToolUse`, `postToolUse`,
  `postToolUseFailure`, `beforeShellExecution`, `beforeMCPExecution`, `afterAgentResponse`,
  `sessionStart`, `sessionEnd`
- Hermes hook points (public, snake_case): `on_session_start`, `pre_llm_call`, `post_llm_call`,
  `pre_tool_call`, `post_tool_call`, `pre_approval_request`, `post_approval_response`,
  `on_session_end`, `on_session_finalize`, `on_session_reset`
- Agent CLI environment overrides: `CLAUDE_CONFIG_DIR`, `COPILOT_HOME`, `GROK_HOME`
- Keybinding command id: `terminals.focusNextNeedsYou` (a regex for dotted keybinding ids would cover it
  and `view.inbox`)

## Residual risks

- Hook event names kept verbatim in Compat lines that pass the script without being on the allowlist:
  `StopFailure`, `PostCompact`, `BeforeAgent`, `AfterAgent`, `BeforeTool`, `AfterTool`,
  `PreInvocation`, `PostInvocation`, `ErrorOccurred`, `PostCompaction`. Treated as the agents' public
  protocol; worth adding to the allowlist so the next run documents that choice.
- Amp plugin event names (`session.start`, `agent.start`, `tool.call`, `tool.result`, `agent.end`) kept
  verbatim (they pass the script). Not verified whether they are Amp's published names or names inside
  Kolux's own plugin.
- MiMo plugin events were described in words because they may be Kolux's own plugin protocol rather than
  MiMo's; the clean room designs its own.
- `view.inbox` kept as a keybinding command id (allowed class) and `OSC 9999` kept as the in-band status
  channel; the OSC payload format is not specified, so old scripts may not be fully compatible.
- STAT-055 and STAT-056 (kolux.yaml setup/archive scripts and their trust prompt) look like area 01
  material; exact kolux.yaml entry names were not verified.
- Overlaps from the critic notes are cross-referenced only via the Related areas line, not merged:
  STAT-054 vs D-07-051 / D-19-053 (process-tree kill), STAT-033 vs D-03-058 (title-based identity).
- Reader flagged that Grok is the only agent whose hooks are removed at quit (STAT-018); intent not
  confirmed by the owner.
- Numeric limits (60/160/8,000/16,000/40/120 characters, 32 children, 30 minutes, 12 frames a second,
  200 ms, 268/240 px, badge cap) are carried over as behaviour facts.

## Wave 2 patch (2026-10-06)

Coverage-critic gaps from the hook-events registry, patched in round 4.

Cards added:
- STAT-061 / D-04-061 (P1) · Grok questions show needs you with the question. Registry
  `grok|PreToolUse`; question tool start means waiting with the question text, its end means
  working, a failure report never rebuilds the card.
- STAT-062 / D-04-062 (P1) · Late events after a finished Antigravity or Amp turn never bring back
  working. Registry `antigravity|PostInvocation`, `antigravity|PostToolUse`, `amp|tool.call`,
  `amp|tool.result`. Placed after STAT-028.

Cards amended (one rule clause each, in both cards-raw and spec; cards-raw rules start "Wave 2:"):
- STAT-018 / D-04-018 · Grok notices judged by wording (permission or feedback means needs you, idle
  input prompt means done, only the generic per-tool permission notice is routine); notice text
  never kept as the prompt; Grok's prompt wrapper stripped. Registry `grok|Notification`.
- STAT-019 / D-04-019 · Kolux's Claude Code hook stays silent inside a Devin session; OpenClaude has
  no such check. Registry `claude|*` (Windows wrapper column).
- STAT-029 / D-04-029 · The machine-written continuation message after a compaction is not a new
  prompt for Claude Code, OpenClaude and Kimi. Registry `claude|UserPromptSubmit`,
  `openclaude|UserPromptSubmit`, `kimi|UserPromptSubmit`.

Tier counts line updated: P1 39 → 41.

Leaks fixed: none needed. Firewall script: 0 hit(s) on the first run after the patch. Six-word
similarity hunt: every six-word window of the new and amended text (564 windows) searched
case-insensitively over the old repo's src, tests, docs, README, HANDOFF and HANDOFF-HISTORY: 0
matches (the hunt was sanity-checked with a known test-title phrase, which it found).

Residual risks:
- STAT-061 and STAT-018 describe Grok's notice and question handling by meaning only; the exact
  wording Kolux matched (permission, approval, feedback, question words; idle-prompt hints) stays in
  the old code cited by cards-raw evidence, so the clean room designs its own matching.
- STAT-029's continuation message is described, not quoted; the clean room must learn the agents'
  current continuation wording from their public behaviour.

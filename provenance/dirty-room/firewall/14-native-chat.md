# Firewall scrub report · 14 · Native chat

- Date: 2026-10-06 (first pass 11:16, re-verification pass 15:40–15:50)
- Input: `provenance/dirty-room/cards-raw/14-native-chat.json` (44 cards, round 0 only, no `notes`
  field; last modified 11:02, before the spec was written, so the spec is built from the final JSON)
- Output: `spec/14-native-chat.md` (887 lines, ids CHAT-001 … CHAT-044, number taken from D-14-nnn)
- Generator (dirty-room scratch, not shipped): rewritten prose held in the session scratchpad
  (`fw14-native-chat/chat-data.js` + `gen14fw.js`), rendered by a small script so sorting, tier
  counts and the H/D lists are mechanical. The re-verification pass re-rendered it to a scratch copy
  and confirmed it is byte-identical to the published spec.

## Cards written per tier

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 0 | 0 |
| P2 | 0 | 0 |
| H | 41 | 41 |
| X | 0 | 0 |
| D | 3 | 3 |
| **Total** | **44** | **44** |

Structural check (script, re-verification pass): 44 headings, 44 unique ids, every `Source:` maps to
a raw card with the same number; tier, pushed and state match the JSON card by card; every card has
User does / User sees / Rules / Acceptance (≥ 2) / Compat / Decision; order is tier, then pushed
ascending with `null` (shown as `Pushed: —`) last, then id. Related areas line equals the union of the
cards' `related` fields (01, 02, 03, 04, 05, 07, 10, 12, 13, 17, 18).
Decisions: 24 H cards carry "H: default build" (D-14-002 and D-14-006 … D-14-028, because the live
Agents view renders supported sessions as chat with the flag off); 17 H cards carry "H: default skip"; 3 D cards carry "default cut: … Revive via DECISIONS.md."
(area 18 cut). Each matches the raw `decision` field's verdict.

## Leaks found and fixed (17)

| # | Category | Where (raw card) | Leaked token | Fix in spec |
|---|---|---|---|---|
| 1 | identifier (settings key) | D-14-001 compat | `experimentalNativeChat` | "three stored yes/no preferences, each off by default" |
| 2 | identifier (settings key) | D-14-001 compat | `openAgentTabsInChatByDefault` | same sentence |
| 3 | identifier (settings key) | D-14-001 compat | `experimentalStructuredNativeChat` | same sentence |
| 4 | identifier (settings key) | D-14-024 compat | `nativeChatSessionOptions` | "one stored set of launch choices per agent, empty by default" |
| 5 | identifier / schema field | D-14-003 compat | `viewMode` field in the saved session file | "each tab's chosen view is part of the saved session layout" |
| 6 | identifier (env var) | D-14-007 compat | `CLAUDE_CONFIG_DIR` | "Claude's own config-folder environment variable" |
| 7 | identifier (env var) | D-14-007 compat | `CODEX_HOME` | "Codex's own home environment variable" |
| 8 | identifier (env var) | D-14-007 compat | `GROK_HOME` | "each agent's own home environment variable" |
| 9 | identifier (env var) | D-14-007 compat | `OMP_CODING_AGENT_DIR` | same |
| 10 | identifier (agent tool name) | D-14-014 rule | `MultiEdit` (with Edit, Write) | "Claude's edit, write and multi-edit tools" |
| 11 | identifier (snake_case tool) | D-14-014 rule | `apply_patch` | "the Codex patch tool" |
| 12 | identifier (snake_case tool) | D-14-014 acceptance | `apply_patch` | "A Codex patch touching two files" |
| 13 | identifier (tag name) | D-14-010 acceptance | `system-reminder` block | "a system reminder block" |
| 14 | path / file name | D-14-025 acceptance | `src/app.ts:12:3` | "a file reference in a reply that names line 12, column 3" |
| 15 | path | D-14-019 acceptance | `@src/ma` | "@ and the start of a folder and file name" |
| 16 | library | D-14-034 compat | `SQLite` journal | "a small embedded database" |
| 17 | schema / format name | D-14-007 compat | `Claude JSONL` | "Claude's event-per-line log" |

By category: identifier 13 (settings keys 4, schema field 1, env vars 4, tool names 3, tag name 1),
path 2, library 1, schema/format 1. No hits in the categories UI copy over six words, verbatim error
text, or verbatim test-title / HANDOFF prose (the similarity hunt below confirms the last). Quoted
labels kept are all six words or fewer (Default view, Terminal chat, Chat UI, Load earlier messages,
Thought, Context compacted, Details, Copied, Jump to latest, Attach file, Sending…, Cancel, Next,
Skip, Submit, Review plan, Allow, Deny, Retry, Step 1).

Other rewrites (not forbidden tokens, but internal jargon replaced with behaviour words):
"bridge chat" → terminal-backed chat; "PTY" → terminal connection; "TUI" → the agent's own terminal
screen; "seed" → starting prompt; "mailto links" → email links; "Agent Session History" → session
history; "Mod+Shift+J (no keybinding id)" and "Mod+=, Mod+-, Mod+0" → fixed chords, not rebindable
commands; "the server refuses" → "the app refuses"; "lifecycle frames" → lifecycle messages. Every
sentence of every card was rewritten in new words rather than lightly edited.

Format completions (28 acceptance checks added; raw 73 usable checks → spec 101):
- 19 cards had a single acceptance check (D-14-008, 011, 023, 026, 027, 029, 030, 031, 034, 035, 036,
  037, 038, 039, 040, 041) or an "n/a - decision item" placeholder (D-14-032, 043, 044). Each now has
  two checks; the added one is derived from that card's own rules or "user sees" text. For D cards the
  pair is "the rebuild does not offer it" plus "if revived: …".
- 6 cards got a third check derived from one of their own rules: D-14-004 (structured menu lists no
  terminal-only items), 007 (a crashed turn stops showing as working), 009 (content stays after a
  read failure), 014 (copied diff lines start with plus or minus), 025 (a user-typed path does not
  open), 033 (a second owner is refused and the first owner named).
- D-14-039 had no rules; one rule was derived from its "user sees" text (focus moves to the chat only
  when its workspace is active; otherwise only the sidebar status changes).

## Similarity hunt

- Phrases checked: 4,625 unique six-word windows taken from all spec prose (scope paragraph, titles,
  user does/sees, rules, acceptance, compat, decisions, H/D list text), in two forms: raw with
  punctuation kept, and punctuation-stripped within each clause. Searched in one pass with
  `rg -iF -o -f <windows> src tests docs README.md HANDOFF.md HANDOFF-HISTORY.md` in the old repo.
- Pass 1 (first pass): 4 hits, all rewritten.

| Phrase | Old-repo location | Spec card | Rewrite |
|---|---|---|---|
| "while the agent is working and" | tests/e2e/orchestration-idle-mail-delivery.spec.ts:302 | CHAT-011 rule | "appears only during an active turn, and only when it runs ahead of the transcript" |
| "the tab holds a single pane" | src/renderer/src/components/dashboard/agent-row-pane-live-title.ts:8 | CHAT-003 rule | "the tab title is used to guess the agent only for tabs with one pane" |
| "an owner that can no longer" | src/renderer/src/components/terminal-pane/command-code-done-settle.ts:23 | CHAT-033 rule | "if the owning session cannot prove its agent process still runs, it lets its claim lapse" |
| "a journal written by a newer" | src/main/native-chat/agent-session-journal/journal-write-guards.ts:16 | CHAT-034 rule | "a journal saved by a later app version can be read but is never written back" |

- Pass 2 (first pass, after the fixes and a later wording pass on CHAT-007 and CHAT-024): 0 hits.
- Pass 3 (re-verification pass, fresh run over the same 4,625 windows regenerated from the source
  data): 0 hits. Positive control: one six-word phrase lifted from the old README, appended to the
  window list, was found (README.md:5), so the search itself works.
- Tooling note: `rg` is not on this machine's PATH; the hunt used the ripgrep 15.0.0 binary bundled
  with VS Code (`…/@vscode/ripgrep-universal/bin/win32-x64/rg.exe`).

## Final firewall script line

```text
firewall-check: 0 hit(s) across 1 file(s)
```

The script reported 0 hits on every run (first pass and re-verification); the leaks above were
removed while rewriting, before the first run.

## Allowlist candidates (not edited; rewritten around for now)

- `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GROK_HOME`, `OMP_CODING_AGENT_DIR`: home-folder environment
  variables the agent CLIs themselves define, which users set by hand. Same standing as hook event
  names.
- `apply_patch`: the Codex CLI's public tool name, part of the agent protocol the transcript reader
  decodes.

## Residual risks

1. Tuned constants carried over as behaviour: 300-message first page and 200 per older page;
   1/2/4/8 s then 10 s retries capped at 60 s; 48 px follow zone; 0.8x–1.6x zoom in tenths; 8 pending
   bubbles per pane; four files per turn; about eight composer lines. They are user-visible behaviour,
   but they are the old app's chosen numbers.
2. The 28 added acceptance checks and the derived CHAT-039 rule are inferred from each card's own
   text, not taken from an old test. A critic may want to confirm them.
3. "Codex's session rollout" and "Claude's event-per-line log" name the agents' own transcript formats.
   They are the agent vendors' terms, not Kolux identifiers.
4. "OpenClaude" and "omp" are kept as agent names under the agent-name allowance.
5. Shared scratchpad collision (first pass): another firewall agent (area 09) wrote its own generator
   under the same name in the shared session scratchpad. One run of that file, meant for this area,
   re-rendered `spec/09-automations.md` from area 09's own data file (no content of this area went
   into it). That agent should re-run its generator and firewall check before it finishes. This
   area's files live in private scratch subfolders (`fw14-native-chat/`, `fw14/`).
6. The raw JSON carries no critic-round (round 1–3) cards. The round-1 coverage file
   (`coverage/14-native-chat-r1.csv`, 111 rows: 85 MAPPED, 16 NOT-USER-FACING, 7 DROP, 3 OTHER-AREA,
   no MISSING) shows the critic folded its additions into existing cards as extra rules, all present
   in the spec. If a later critic round appends cards, this spec must be regenerated.

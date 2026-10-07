# Firewall scrub report · 02 Sessions & launching

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/02-sessions-launching.json` (50 cards, generated 2026-10-06, all round 0; critic r1 edits folded in place, see `coverage/02-sessions-launching-r1.csv`)
- Output: `spec/02-sessions-launching.md` (ids SESS-nnn, number taken from D-02-nnn)
- Starting point: a spec draft for this area already existed on disk (written 11:17, after the final JSON at 11:06) with no scrub report. This pass audited that draft card by card against the JSON, re-ran every check below, and rewrote what failed. It was not regenerated from scratch.

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 13 | 13 |
| P1 | 25 | 25 |
| P2 | 2 | 2 |
| H | 3 | 3 |
| X | 1 | 1 |
| D | 6 | 6 |
| **Total** | **50** | **50** |

Structural check (node script over the spec and the JSON): every D-02-nnn has exactly one SESS-nnn card; tier, pushed and
state match the JSON on every card; sort order is tier, then pushed (null last), then id; field order is User does, User
sees, Rules, Acceptance, Compat, (Decision), Source; every card has at least two acceptance items; Decision appears on the
3 H and 6 D cards only; every Source line names its own D-02-nnn. `Tier counts` line and the D (6) and H (3) summary
lists match.

Acceptance items: where a raw card had a single acceptance item (or "n/a" on H/D cards), the firewall stage added a
second check derived from that card's own rules or decision (for H/D: what the default build must not show). These
added checks are not in cards-raw.

## Leaks found and how each was fixed

Method: (1) the raw card prose (no evidence column) was rendered to a scratch file and run through
`scripts/firewall-check.ps1`; (2) the raw prose and the spec were run through an exhaustive six-word similarity hunt
(below); (3) manual read of the spec against the forbidden list, plus a hyphenated-token sweep checked against old `src`.

| Category | Found | Where | Fix |
|---|---|---|---|
| Identifier (camelCase keybinding ids) | 3 tokens | D-02-011 compat: `tab.newAgent` (twice, plain and per-agent form), `tab.newTerminal` | Compat describes both tab-group commands and the per-agent form (plain id + dot + agent's stable id); exact spelling withheld pending allowlist. `sessions.add`, `sessions.remove`, `workspace.create` kept as typed (they pass). |
| Identifier (SCREAMING_SNAKE env var) | 1 token | D-02-027 compat: Goose's mode variable | Described as "its mode environment variable given the value auto"; exact name withheld pending allowlist. |
| Identifier (stored enum value) | 1 token | D-02-045 rules: the custom-agent change-scope value spelled as in code (`custom-agents.ts:9`) | Rewritten as plain words: "that last one, any file". |
| Identifier-shaped compounds | 5 tokens | Draft wording in SESS-011 (default-agent, new-tab), SESS-009 (display-name), SESS-026 (setup-script), SESS-041 (the chat flag written as a hyphenated name, from D-02-041) | Each rewritten as ordinary words: "shortcut for the default agent", "open-in-a-new-tab command", "a match on the shown name", "launch mode for setup scripts", "the experimental flag that opens agents as chat". Three of these hyphenations also exist as names in old `src`. |
| Path / file name | 0 in prose | 50 cards' `evidence` references | Evidence is never rendered; it stays in cards-raw. |
| UI copy over six words | 0 | — | Quoted labels, all five words or fewer: Refresh agents, Hide agents, Choose agent..., Show more agents, Manage agents, Set as default, Separate copy for each AI, Same folder for all, Give each its own copy, Same for all, Use last lineup, Save as team, Add project, No parent, Create workspace, Create more, More…. Empty-state and toast wording described, never quoted. |
| Error text | 0 | — | Failure toasts and refusals described by meaning only. |
| Schema / stored keys | 0 | — | Importer carry-overs (turned-off agents, default agent, saved shapes, per-agent overrides, setup launch mode) described as behaviour, no key names. |
| Library names | 0 | — | — |
| Verbatim prose (code comments, UI strings, test titles) | 7 spec sentences (22 six-word windows) | See similarity hunt | Rewritten; see next section. |

## Similarity hunt

Two passes over `src`, `tests`, `docs`, `README.md`, `HANDOFF.md`, `HANDOFF-HISTORY.md` of the old repo (21,947 files that
ripgrep searches by default), using every six-word window of the spec rather than a three-per-card sample:

1. Literal: 3,525 distinct six-word phrases (split at hard punctuation, with and without commas), `rg -iF -f` in one run.
2. Normalised: 5,569 distinct six-word windows (lower-case, punctuation and hyphens folded to spaces, comment markers
   stripped, lines of each old file joined so wrapped prose and multi-line comments are caught). Old files were read only
   through `rg` output piped to a script in the scratchpad.

First pass on the existing draft: 22 matching windows in 7 sentences, all rewritten:

| Spec card | Matched in old repo | Rewrite |
|---|---|---|
| Intro paragraph | improvement-cards research doc (agent-per-worktree decision line) | "whether every agent works in a worktree of its own" |
| SESS-027 compat | the agent no-prompt flag sequence in constants tests and permissions module | Restructured: "for Claude Code, … with the value auto; for Codex, the single flag …"; the flags themselves are the agent CLIs' public interfaces and stay as typed |
| SESS-001 rules | the agent catalogue in selection and telemetry modules (names in the same order) | Catalogue order kept (it is behaviour: menus fall back to it) but written as a numbered list 1–34 plus the hidden 35th entry |
| SESS-017 user sees | picker and launch-grid source comments | "is greyed out and carries a set-up link pointing to AI connections" |
| SESS-012 rules | launch roles module | "a seat's first message puts the role's brief first and the shared task after it" |
| SESS-015 rules | New session page test title | "the Same for all button stays greyed out until at least one seat is complete" |
| SESS-014 user sees | isolation toggle source (label plus "button") | "a one-click fix labelled "Give each its own copy" that switches back" |

For reference, the raw card prose itself matched in 15 sentences (23 windows: catalogue list, flag list, set-up link
wording, keyboard tab-stop rule, non-git default, launch-disabled rule, saved-shape compat, quick-count list, Same for
all rule, parallel-agent rule block, last-lineup rule, role brief order, chat fallback, reuse-branch rule). None of those
windows remains in the spec.

Final pass after all rewrites: literal 0 matches, normalised 0 matches.

## Final script line

`firewall-check: 0 hit(s) across 1 file(s)`

## Allowlist candidates (not edited; for the coordinator)

- `tab.newAgent` — keybinding command id (new agent tab with the default agent); used inside backticks.
- `tab.newTerminal` — keybinding command id (new terminal tab).
- `re:^tab\.newAgent\.[a-z0-9-]+$` — per-agent keybinding ids (plain id + dot + agent's stable id).
- `GOOSE_MODE` — Goose's own public environment variable (agent CLI interface, set to auto by default).

Once accepted, SESS-011 and SESS-027 compat lines can spell these out instead of describing them.

## Residual risks

- SESS-001 reproduces the old catalogue's ordering (as a numbered list). Order is user-visible behaviour and agent names
  are allowed, but the sequence itself mirrors the old source list.
- SESS-027 keeps third-party agent flags verbatim (Codex's long bypass flag, Gemini CLI, Aider, Claude Code permission
  mode). They are the agent CLIs' public interfaces, not Kolux text.
- Short quoted labels (five words or fewer) exist verbatim in the old UI by design.
- Added acceptance items (second checks) are the firewall stage's own derivations, not reader or critic evidence.
- The draft was inherited from an earlier pass of this stage; the content audit compared every card to the JSON and found
  it faithful, but phrasing not caught by the six-word hunt (shorter overlaps) could still echo old wording.
- The old repo's searchable file count read 21,951 in one pass and 21,947 in the others, so something transient touched
  its tree during this stage (not this agent, which only read it).

## Wave 2 patch (2026-10-06)

Gap from the coverage critics: registry agent-catalog, all 35 rows (detect, launch, expected-process
and prompt-mode columns). No existing card held the per-agent mapping (SESS-001 names the agents,
SESS-032 lists the delivery routes), so a new card was added rather than amending one.

| Change | Card | Notes |
|---|---|---|
| Added | SESS-051 · Each catalogue agent's program, start line and opening-prompt route (raw D-02-051, round 4, P0, pushed 1, live-unverified) | Program name per agent for detection and foreground recognition, second names, Claude Agent Teams requirements, fixed start arguments (Kiro, Command Code, Hermes), and which agent takes the opening prompt by which route; evidence from the agent-catalog registry plus the agent config, startup plan, Hermes query and process-recognition modules |
| Amended | none | — |
| Tier counts | P0 13 → 14 | — |

Leaks fixed: none needed. Program names of third-party agents are written as plain words (single
lowercase words are not on the allowlist inside backticks); the bare double-dash separator and the
one-letter interactive switch are described in words; only `kolux claude-teams` and `--flag`
tokens sit in backticks.

Checks run:

- Firewall on the spec file: `firewall-check: 0 hit(s) across 1 file(s)`.
- Six-word hunt: every six-word window of SESS-051 and of D-02-051's prose (1,930 windows, with and
  without punctuation) searched case-insensitively as literals over the old repo's src, tests,
  docs, README, HANDOFF and HANDOFF-HISTORY: 0 matches (pipeline sanity-checked with a known test
  title, which matched). Explicit phrases also searched with 0 matches: "opens directly on its chat
  screen", "its plain prompt option quits once", "an unrelated open-source tool ships a program".

Residual risk: the program-name list mirrors the old catalogue's order and values; these are the
agent vendors' public program names (their interfaces, like their flags), not Kolux text.

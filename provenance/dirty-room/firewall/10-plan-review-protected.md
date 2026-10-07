# Firewall scrub report · 10-plan-review-protected

Date: 2026-10-06 · Stage 3 (Firewall) · Prefix SAFE
Input: `provenance/dirty-room/cards-raw/10-plan-review-protected.json` (30 cards, after critic r1)
Output: `G:\Dev\kolux-rs\spec\10-plan-review-protected.md` (681 lines)

## Cards written

| Tier | JSON | Spec | Ids |
|---|---|---|---|
| P0 | 16 | 16 | SAFE-023, 024 (pushed 2); 001–004 (pushed 3); 009–015, 019, 021, 022 (pushed 5) |
| P1 | 9 | 9 | SAFE-005–007 (pushed 3); 016–018, 020, 025, 026 (pushed 5) |
| P2 | 2 | 2 | SAFE-027 (pushed 5), SAFE-028 (pushed 9) |
| H | 1 | 1 | SAFE-008 |
| X | 0 | 0 | — |
| D | 2 | 2 | SAFE-030 (pushed 2), SAFE-029 (pushed 5) |
| **Total** | **30** | **30** | sorted tier → pushed → id; number taken from D-10-nnn |

Format additions: every card now has at least two acceptance items. Where the JSON had one item or
"n/a — decision item" (D-10-003, D-10-007, D-10-008, D-10-029, D-10-030), a second item was derived
from that card's own rules; the H and D items are worded "If built" / "If revived". One acceptance
item was added to SAFE-009 from the notes' UNKNOWN (ask behaviour under Claude's automatic permission
mode and skip-permissions mode, never verified at 0.15.0).

## Leaks found and fixed (37)

| Category | Count | Examples from cards-raw | Fix |
|---|---|---|---|
| Path | 13 | source-folder search path, home Documents path, temp test folder with app name, dist glob, packages/web, two Windows system paths plus a file under one, a Linux var/lib path, migrations folder, feature/login branch path, two attacker share paths | Described by role: "the documents folder", "a scratch folder in /tmp", "the Windows folder", "a double-slash share path", "a feature branch" |
| File name / extension | 8 | dependency folder name, Next build folder, a PowerShell script file name, Codex's TOML config file name, extension lists (OneNote/web-query/SYLK; batch, JS, exe, shortcut), ADS-suffixed exe, plain txt | "the dependency folder", "a script file", "its configuration", "a batch file, a JavaScript file, a Windows program or a shortcut" |
| Identifier | 12 | exit-plan tool name, tool-input plan key, hook-specific-output and hook-event-name keys, permission-decision and reason keys, tool-name and tool-input-command keys, Stripe live-key prefix with underscores, a test subscription id, a SCREAMING_SNAKE build-dir variable, an env-var placeholder | Rewritten as behaviour ("the exit-plan tool", "a hook-specific output block that sets the permission decision to ask", "the live-key prefix", "a path held in a shell variable", "env -u NAME") |
| UI copy | 2 | the read-only notice sentence of the plan sheet (7 words verbatim in D-10-007); the protected-action reason sentence paraphrased closely in D-10-009 | "a notice that the plan prompt has closed"; "explains that the command waits for the user and stays blocked if refused" |
| Schema | 2 | D-10-015 compat listing the settings block's fields; D-10-020 compat with the literal empty-object reply | Stated as what an import must carry over / "one JSON object, either empty or the ask reply" |
| Error text | 0 | — | — |
| Library | 0 | none of the old app's libraries appeared in the cards | — |
| Verbatim prose | see similarity | — | — |

Allowed interface tokens kept as typed: hook event names PreToolUse and PermissionRequest; kolux.yaml;
DECISIONS.md in Decision lines; shell commands the agent would type in acceptance checks (git, rm, rd,
del, Remove-Item, terraform, vercel, stripe, npx, sudo, timeout, nice, env, powershell switches), each
under six words per command.

## Similarity hunt

- Method: every 6-word window of the spec's prose (titles, does/sees, rules, acceptance, compat,
  decision, scope paragraph, footer lists) — 5,732 windows in the final run, a superset of the
  "up to three per card" rule — searched with `rg -iF -o -f <windows>` against src, tests, docs,
  README.md, HANDOFF.md and HANDOFF-HISTORY.md of the old repo, one path per invocation.
- First run: 5 six-word matches, all rewritten:
  1. "is left exactly as it was." (SAFE-023 acceptance) → "does not change at all."
  2. "as if the user had picked" (SAFE-003) → "the same way it would had the user chosen allow".
  3. "the starting directory stands in for" (SAFE-013) → "the directory the command began in is used instead".
  4. "git push --force origin main, git" (SAFE-010, same list order as the old defaults' examples) → list reordered.
  5. "blank lines inside a fenced code" (SAFE-002, a test title fragment) → "where the empty line falls within a fenced code block".
- Extra pass at 5 words against the area's own old sources (plan-review components, settings panes,
  shared protected-action modules, the two audit docs, the English locale): 5 near-copies tightened
  (the read-only notice phrase, "never fall back to plain", "with up to two adjacent",
  "characters so the user can", "a fenced block with a"). Remaining 5-word overlaps are bare shell
  commands used as test inputs ("git push --force origin main", "git push --force origin @",
  "timeout 30s terraform apply -auto-approve") and the generic "for as long as the".
- Final 6-word run: 0 matches.

## Firewall script

Final line: `firewall-check: 0 hit(s) across 1 file(s)` (clean on the first run after the rewrite;
the leaks above were removed while rewriting, before the first check).

## Allowlist candidates (not edited; rewritten around)

Claude Code's public hook protocol tokens, the same class as the already allowed hook event names:
ExitPlanMode, hookSpecificOutput, hookEventName, permissionDecision, permissionDecisionReason,
tool_input, tool_name. The rebuild needs them to implement SAFE-001, SAFE-009 and SAFE-020; the spec
describes them in words for now.

## Residual risks

- Acceptance checks reuse short generic shell commands that also appear as examples in the old
  defaults and tests (git push variants, terraform apply -auto-approve, rd /s/q build, sudo -u root
  ls build). Each is a command a user or agent types, under six words; kept for precision.
- Quoted UI labels, all six words or fewer: the seven built-in rule names, Ask before protected
  actions, Approve, Request changes, Add rule, Reset to defaults, Clear, Don't run, Run hooks.
- Numeric limits mirror old constants (120-character rule label, 16,000-character plan payload, 128
  drafts, 500-character pattern, 4,096-character regex input, 50 attempts, 2,000-character stored
  command, 12 names per pre-trust batch, about 0.25 s trust batching, about 3 s feedback ceiling).
  They are behaviour, not code, but they are the old app's numbers.
- Audit finding labels S1–S7, I2, I3, I5 are the old audit document's own ids; kept as dates-and-ids
  references only.
- SAFE-025 describes the same feature as STAT-056 (area 04); the spec says to build it once. SAFE-028
  (settings normalisation) most likely belongs to areas 17/03/12.
- UNKNOWN carried from the cards: the protected-action ask has never been verified against a live
  signed-in Claude session, nor under Claude's automatic permission mode or skip-permissions.
- Tooling note: one combined `rg -iF -f <file>` call naming all six old-repo paths at once printed
  nothing, even for a known phrase; the same pattern file searched one path per call works, so the
  hunt was run per path. Single-phrase `rg -iF` across all six paths works normally.

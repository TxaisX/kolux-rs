# Firewall scrub report · 06 Usage & limits

- Date: 2026-10-06
- Input: `provenance/dirty-room/cards-raw/06-usage-limits.json` (33 cards, generated 2026-10-06, all round 0;
  critic r1 tier/pushed fixes already applied in the JSON)
- Output: `spec/06-usage-limits.md` (ids USAGE-nnn, number taken from D-06-nnn)

## Cards written

| Tier | Raw JSON | Spec |
|---|---|---|
| P0 | 11 | 11 |
| P1 | 10 | 10 |
| P2 | 6 | 6 |
| H | 4 | 4 |
| X | 1 | 1 |
| D | 1 | 1 |
| **Total** | **33** | **33** |

Sort order in the spec: tier (P0, P1, P2, H, X, D), then `pushed`, then id. Tier, pushed and state
were taken from the raw JSON by the generator for every card, and the generator checked that every
raw card has a rewrite, every H and D card has a Decision line, and every card has at least two
acceptance items. All prose (title, user does, user sees, rules, acceptance, compat, decision) was
rewritten, not transcribed.

Format notes:
- The raw H cards and the D card carried a single "n/a — decision item" acceptance line. Each now
  has two checks that verify the default decision (skip: the thing is absent; build: the forecast
  shows in the pill's hover; cut: no WSL/SSH/phone usage path).
- The X card (USAGE-020) carries its replacement rule in Rules, not a Decision line, because the
  shared format puts Decision on H and D cards only (same as the X cards in area 21).
- USAGE-028 had one acceptance item in the raw card; a second (a terminal opened after the reload is
  listed the same way) was added from the same rule.

## Leaks found and how each was fixed

Method: (1) a naive render of the raw card prose was run through `scripts/firewall-check.ps1`
(18 hits); (2) the raw card prose was run through the same six-word similarity hunt used on the
spec (2,234 phrases); (3) manual read against the forbidden list for what the script cannot see
(home-folder paths, a camelCase key with an inner acronym, format names).

| Category | Found | Where (raw card) | Fix |
|---|---|---|---|
| Old-app identifiers / settings keys (schema) | 8 | D-06-006 cap-switch key; D-06-007 auto-resume key; D-06-009 alert preference key and fired-marker key plus its stored key shape; D-06-026 Gemini opt-in key (inner acronym, missed by the script); D-06-027 three MiniMax keys | Compat rewritten as plain carry-over rules: which choice exists, its default, and what record is kept (for example "which threshold already fired for each provider and window, tied to that window's reset time"). No key names. |
| Third-party interface tokens (agent CLIs' own env vars, config keys, statusline and session-log fields) | 9 | D-06-006 Claude Code auto-compact env var and two Codex per-run config keys; D-06-021 three statusline fields; D-06-017 Codex event type; D-06-022 Codex home env var; D-06-027 Kimi home env var | Described in words ("Claude Code's auto-compact window environment variable", "per-run config overrides for its model context window and its auto-compact token limit", "the token-count events", "Codex's home-folder environment variable"). Listed below as allowlist candidates, because the build needs the exact names to interoperate. |
| File names and paths | 3 | D-06-022 Codex default home folder; D-06-026 Gemini CLI credential file name; D-06-027 Kimi default home folder | Replaced by "Codex's default folder in the user's home", "the Gemini CLI's own saved browser sign-in", "Kimi's own saved sign-in from its home folder". |
| Format / schema words | 1 | D-06-016 transcript file format named by extension | "session transcripts, one record per line". |
| Verbatim prose (test titles) | 13 sentences | D-06-006 (two rules: a window the user already chose; a saved command being replayed), D-06-007 (six rules: foreground unreadable, no known reset time, 30-minute give-up, refused send not retried, reset passed while closed, weekly window not falling back), D-06-008 user sees (percent of the week left, tint by fullness of the week), D-06-009 (two rules: already at or above 95%, window rolling to a new reset), D-06-021 (live Claude terminal owning the refresh), D-06-022 (not signed in) | Each sentence rewritten from scratch with different structure and vocabulary. |
| Verbatim prose (docs) | 1 sentence | D-06-032 (profiles still on the old default; a redesign doc) | Rewritten ("profiles that had upgraded and kept the earlier default"). |
| UI copy over six words | 0 | — | Labels kept to three words or fewer: Copy image, Copied, Share on X, Share, Enable Claude, Enable Codex, Usage percentages, Used, Remaining, Overview, Launch agents, Stats & Usage. The empty-page invitation and the overview's empty-state line are paraphrased, not quoted. |
| Error text | 0 | — | Grok, MiniMax and Kimi failure states are described ("usage says the cookie has expired"), never quoted. |
| Library names | 0 | — | — |
| Paths / identifiers in evidence | — | `evidence` arrays | Not rendered; they stay in cards-raw only. Not counted as leaks. |

Leaks fixed (counted): 8 + 9 + 3 + 1 + 13 + 1 = **35**.

## Firewall script

- First run on the generated spec: `firewall-check: 0 hit(s) across 1 file(s)`.
- Final run (after the similarity rewrites): `firewall-check: 0 hit(s) across 1 file(s)`.

## Similarity hunt

- Method: exhaustive, stronger than three phrases per card. Every six-word window inside each
  punctuation-free clause of every card, the scope paragraph, the related-areas line and the
  Dropped / Hidden lines was searched.
  - Pass 1: ripgrep fixed-string, case-insensitive, binary-as-text, over `src`, `tests`, `docs`,
    `README.md`, `HANDOFF.md`, `HANDOFF-HISTORY.md`; the final run was repeated with `--no-ignore
    --hidden` so the cross-version checkouts under `tests/e2e` were also searched.
  - Pass 2: a tokenised, whitespace- and comment-marker-normalised word-window match over every
    text file (ts, tsx, js, mjs, cjs, jsx, md, mdx, txt, json, yaml, html, snap, csv, tsv, sh, ps1,
    css) under `src`, `tests`, `docs` plus README and both HANDOFF files (92,730 files), to catch
    phrases split by line wraps, multi-line comments or string concatenation. Validated with control
    phrases known to be in the old repo (5 of 5 found).
- Draft: 2,882 phrases, 7 matches, all fixed:
  - Scope "how much of the week is" (pill test title) → "gives the unused share of the weekly allowance".
  - Scope "continue prompt into a claude pane" (auto-resume source comment) → "nudge a stopped Claude
    session with a brief keep-going message after the limit window rolls over".
  - USAGE-007 "does not fall back to the" (generic, several test titles) → "is never swapped for the
    5-hour one".
  - USAGE-008 "by how full the week is" (pill test title) → "coloured according to how much of the
    weekly allowance is spent"; same sentence's "how much of this week is left" also reworded.
  - USAGE-022 "when the user is not signed" (Codex usage test title) → "if no sign-in exists no Codex
    process is launched".
  - USAGE-032 "profiles still on the old default" (redesign doc), twice → "profiles that had upgraded
    and kept the earlier default".
  - USAGE-033 "on the reset time carried by" (auto-resume test title) → "use only the reset time that
    their own stop event reports".
- Final: **2,887 phrases checked, 0 matches** in pass 1 (with and without ignore rules) and in pass 2.
  Similarity hits fixed: **7**.
- Tooling notes: `rg` is not on PATH; the ripgrep 15.0.0 binary bundled with VS Code was used. With
  `-j4` and a pattern file it silently returned partial results here (2 of 16 known raw-prose hits),
  so every final search pinned `-j1`, and pass 2 does not depend on ripgrep at all. The shared
  scratchpad is used by other agents at the same time (a same-named phrase file was overwritten
  mid-run); all final runs used a private `fw06` subfolder.

## Allowlist candidates

Third-party agent CLI interfaces that the build needs verbatim to interoperate (same class as the
hook event names already allowed). Rewritten around in the spec for now:

- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (Claude Code environment variable; USAGE-006)
- `model_context_window`, `model_auto_compact_token_limit` (Codex per-run config keys; USAGE-006)
- `rate_limits`, `resets_at`, `context_window` (Claude Code statusline fields; USAGE-021, USAGE-005)
- `token_count` (Codex session-log event type; USAGE-017)
- `CODEX_HOME` (Codex environment variable; USAGE-022, USAGE-017)
- `KIMI_CODE_HOME` (Kimi Code environment variable; USAGE-027)
- `oauth_creds.json` (Gemini CLI's credential file; USAGE-026) and the default home folders
  `~/.codex` and `~/.kimi-code` (path-shaped, so lower priority)

## Residual risks

1. Interoperability depends on the candidates above: until they are allowlisted (or carried in
   COMPAT.md), the clean room only has word descriptions of the exact env var, config keys and log
   fields it must use.
2. Duplicates with area 05 for the merge stage: the weekly pill (D-05-008 = USAGE-008), the Agents
   screen usage line (D-05-018 = USAGE-004 footer), the retired provider usage chips (D-05-102 =
   USAGE-029) and provider logos in usage UI (D-05-104 overlaps USAGE-020).
3. Owner decision: the Used/Remaining setting (USAGE-025) only governs the Agents view footer while
   the top pill always reads left; and the usage-alerts preference (USAGE-009) has no visible switch
   at 0.15.0.
4. Gemini, Antigravity, Kimi and MiniMax usage (USAGE-026, USAGE-027) has no on-screen display at
   0.15.0; only alerts and launch warnings use it. The cards describe reading rules, not a screen.
5. USAGE-021 states the order in which Claude's saved sign-in is looked up (per-account credential
   store entry, older shared entry, sign-in file). It is written as behaviour, but it mirrors how
   Claude Code stores its sign-in; a reviewer may want it softened.
6. USAGE-015 keeps concrete price multipliers (1.25x and 2x of base input for 5-minute and 1-hour
   cache writes). These are the provider's published pricing, not the old app's text.
7. USAGE-016 "ownership moves back" was interpreted from the raw card and its evidence as: when the
   original file is deleted, the copied turns are still counted once, under the remaining fork file.

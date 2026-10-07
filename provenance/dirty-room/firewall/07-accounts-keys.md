# Firewall scrub report: 07 · Accounts, sign-in & keys

- Stage: 3 (Firewall), 2026-10-06
- Input: `provenance/dirty-room/cards-raw/07-accounts-keys.json` (65 cards, D-07-001 … D-07-065;
  D-07-064 from critic round 1, D-07-065 from round 2, rule additions from rounds 1–3 included)
- Output: `spec/07-accounts-keys.md` (ids ACCT-nnn, number kept from D-07-nnn)

## Cards written per tier

| Tier | Cards in JSON | Cards in spec |
|---|---|---|
| P0 | 12 | 12 |
| P1 | 27 | 27 |
| P2 | 16 | 16 |
| H | 4 | 4 |
| X | 0 | 0 |
| D | 6 | 6 |
| **Total** | **65** | **65** |

Sorted by tier, then pushed (null last), then id. Every card has at least two acceptance items (136 in
all). 39 cards had a single item, or the "n/a — decision item" placeholder (H/D), in the JSON:
D-07-010, 018, 020, 022, 025–030, 033, 036–063. Their second item was derived from that card's own
rules or user_sees text (for H/D cards: "absent in the default build" checks), not from test titles.
H and D cards carry `Decision:`; no other card does. The spec ends with the D list (6 lines) and the
H list (4 lines).

## Leaks found and how each was fixed (45 occurrences)

Counted by running the firewall script over a plain rendering of the raw card prose (33 hits) plus
a manual read for what the script does not catch (kebab-case ids, file types outside its list, a
camelCase key with an inner acronym).

| Category | Count | Where (raw card) | Fix |
|---|---|---|---|
| Schema (saved-data keys of the old app) | 30 | `claudeOauthToken`, `claudeOauthTokenCreatedAt`, `claudeConnectionMode` (004, 009, 026); `claudeManagedAccounts`, `activeClaudeManagedAccountId` (005, 026); `claudeSelfManagedSignIn` (006, 026); `grokApiKey` (008, 009, 026); `keyVaultCredentialMigrationAcknowledged` (009); `codexManagedAccounts`, `activeCodexManagedAccountId`, `activeCodexManagedAccountIdsByRuntime` (019, 026); `createdAt` (026); `minimaxGroupId`, `minimaxUsageModels`, `minimaxEndpoint` (028); `geminiCliOAuthEnabled` (026, 029; missed by the script because of the inner "OAuth"); `skipCodexRateLimitResetConfirm` (037); `localAccountRuntime`, `localAccountWslDistro` (040) | Compat lines name the carried-over data in words ("the saved key, its creation date and the connection mode carry over", "which one is active, including the older per-runtime record", "whether the one-off sealing pass already ran", "the saved choice to skip that confirmation") |
| Identifier (environment variables) | 4 | `CLAUDE_CODE_OAUTH_TOKEN` (004, 024); `KOLUX_MULTI_PROFILE_UI` (038); `NODE_ENV` (048) | "Claude Code's published OAuth-token environment variable"; "a developer environment variable set to 1" (Compat: the rebuild picks its own); "nothing from Kolux's own runtime mode or packaging" |
| Identifier (connection-method ids, kebab-case) | 7 | `claude-token`, `claude-account`, `codex-chatgpt`, `codex-device-code`, `grok-login`, `grok-device-code`, `grok-api-key` (002 compat) | "seven ways to connect: Claude by 1-year key, Claude by account, Codex by ChatGPT sign-in, …" |
| Path / file name | 3 | `cmd.exe` (004); Codex `config.toml` (021); "a .nim file" (062) | "the classic command prompt"; "the user's Codex TOML settings file"; "a Nim source file" |
| Code keyword (script false positive) | 1 | "import history" (022), plus "imported" in its title and "to import" in 026 compat | "session history is read from", "past sessions come from", "carry over", "bring in a profile" |
| UI copy over six words | 0 | 24 quoted labels in the raw cards, all ≤ 6 words | Kept: "Add Account", "Cancel", "Check again", "Connect", "Disconnect", "Install", "Manage", "Manage accounts (advanced)", "Open install page", "Open sign-in page", "Other ways to connect", "Re-authenticate", "Refresh usage", "Remove", "Renew", "Reset", "Sign in again", "Sign in with a code", "System default", "Try again", "Try installing again", "Use a 1-year key instead", "Use an xAI API key", "Use my Claude account instead" |
| Error text | 0 | none quoted verbatim in the raw cards | Messages are described by meaning ("a message to try again in a moment", "an already-added message") |
| Library | 0 | none of the old app's dependencies named | Third-party user tools kept as environment facts: Powerlevel10k, conda, SmartScreen, Microsoft Store, Git Bash |

Every sentence was rewritten in fresh words from the card's meaning; no raw card sentence was carried
over as is.

## Similarity hunt

1. Brief method: 3 phrases per card (a 7-word window from the middle of each card's three longest
   clauses, fewer when a card is short) = **194 phrases**, `rg -iF` against `src`, `tests`, `docs`,
   `README.md`, `HANDOFF.md`, `HANDOFF-HISTORY.md` → **0 hits** on the first and on the final run.
2. Stricter pass: every 6-word window inside a clause of the spec prose (scope paragraph, titles,
   user does/sees, rules, acceptance, compat, decisions, D and H list notes) = **3,516 windows** on
   the first run, **3,511** after the rewrites. First run: **5 distinct windows matched** in 5
   sentences; all 5 sentences were rewritten, the firewall script re-run (0 hits), and both passes
   re-run → 0 hits. The final pass 2 was also repeated with ignore rules off for `tests` and `docs`
   (716 and 84 files) → 0 hits.

| Matched window | Where it occurs in the old repo | Spec card | Rewrite |
|---|---|---|---|
| "rather than falling back to the" | several source and test files | ACCT-004 | "the card goes to needs attention and never retries through the command prompt" |
| "falls back to the system default" | account-removal dialog copy and locale strings | ACCT-019 | "when the active account is removed the system default takes over" |
| "as not detected on this machine" | locale strings | ACCT-034 | "each carrying a mark that this computer lacks it" |
| "when a claude session stops because" | accounts settings copy, settings-search text, locale strings | ACCT-013 | "if a key runs out mid-session, the Claude card switches to key expired" |
| "also clears a stale needs-attention state" | Codex connect test title | ACCT-002 | "with nothing in progress, it also wipes a leftover needs-attention state" |

Similarity phrases checked: 194 + 3,511 = **3,705** (final runs). Hits fixed: **5**.

Tooling note: `rg` is not on PATH; the ripgrep 15.0.0 binary bundled with VS Code was used, pinned to
`-j1` with a pattern file, path by path. Control check before the hunt: `--files` saw 21,225 files in
`src`, 709 in `tests`, 72 in `docs`, and the control word "claude" matched 2,150 files in `src`. All
working files were kept in a private `fw07` scratch folder.

## Final script line

`firewall-check: 0 hit(s) across 1 file(s)`

## Allowlist candidates (rewritten around, not added)

- `CLAUDE_CODE_OAUTH_TOKEN` — Claude Code's own public environment variable for the long-lived key;
  the rebuild must set it in key-mode Claude panes and remove it elsewhere (ACCT-004, ACCT-024).
- `CLAUDE_CONFIG_DIR` and `CODEX_HOME` — the agent CLIs' public folder overrides behind "a private
  Claude configuration folder" and "a private Codex home" per account (ACCT-005, ACCT-007, ACCT-019).
  Not named in the raw cards; listed because the build needs them to interoperate.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` — the "Anthropic key or token" overrides that block a
  managed-account Claude pane (ACCT-024). The old account code references both; whether the blocking
  check covers exactly these two and no others was not verified.

## Residual risks

- Carry-over (Compat) lines name saved data by meaning only. A rebuild that must read an older
  profile cannot learn the old key names from the spec; the importer needs a mapping decided outside
  the clean room (or listed in COMPAT.md under an owner decision).
- ACCT-034: the Claude top-tier default model and the whole Codex default ladder are not specified
  (the reader did not copy them either); the clean room has to pick defaults.
- 19 cards are terminal, file-access, worktree, task-source, review-bot and editor behaviours that
  landed here by test keyword (ACCT-046 … 063, 065). They are written in full but likely duplicate
  cards in areas 03, 01, 11 and 12; the merge step should de-duplicate rather than build twice.
- ACCT-040 (WSL accounts, D): the 2026-10-06 HANDOFF says WSL paths are local again; the owner should
  confirm that WSL-run accounts stay cut.
- ACCT-036 (account switcher, H): named in this area's scope but only rendered in menus that stopped
  showing on 2026-10-05; decision left as default skip with a note that the owner may mark it build.
- ACCT-038 (profiles, H): only switching and moving are developer-only; the single default profile
  is on the live path, noted in the Decision line and pointed at area 19.
- ACCT-011's last rule describes a test guard (a build check against clear-text credentials), not
  something the user sees; kept as an engineering requirement.
- ACCT-032 is half-done: the acceptance item for the live lookup is conditional on it being wired to
  the picker.
- Every sign-in card is live-unverified: per the HANDOFF known gap, no real browser authorisation
  has been verified end to end.
- Numeric facts carried over as behaviour: 1-year key validity, 30-day renewal warning, 10-minute
  setup timeout, 5-minute renewal window, 15-minute install limit, 30-second connect re-enable,
  5-second status check, about 2 seconds sign-in wait, 340-day backdating test, 100 MB output test.
- Quoted labels (24, all ≤ 6 words) are the old app's button and heading texts; they pass the rule but
  the rebuild may want its own wording.

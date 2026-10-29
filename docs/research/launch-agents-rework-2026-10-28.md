# Launch + agents rework, 2026-10-28

Txais's evening asks: a chooser instead of an instant terminal, no starter kits, one default model and effort,
OpenCode back, every agent in one dropdown with Install, then a faster install that people pick from.

## What shipped

| Round | Tasks | Main |
|---|---|---|
| 1 | T-568 kits removed · T-569 new workspace opens the launch chooser · T-570 agent dropdown + Install · T-571 one default model/effort (opus/high) · T-572 OpenCode back, Hermes wired · T-573/T-574/T-576 install table, `agents_install`, `--install-agents`, OFFICIAL allow-list · T-575 status-line test · T-577 merge fixes | 52e03a72 -> 7c2a924b |
| 2 | T-578 batch engine (`agents_install_many`, `agent-install-progress` event, npm in one call, scripts 4 at once, winget/uv in order; installer no longer installs agents) · T-579 "Install coding agents" picker in the first-run wizard and Settings > Agents | 7c2a924b -> b246e387 |

## Measurements

- Round 1 install-all on this PC, one at a time: 25 installed, 6 already present, OpenClaw failed (Node 24.19.0 below its engines floor), ante/trae/rovo website-only; about 10-15 min.
- Round 2 engine: 5 npm agents reinstalled in 48 s (evidence/T-578-timing.txt).
- Live picker check (scratch profile, Settings > Agents, only OpenClaw ticked): button read "Install selected (1)", row went Installing… -> Installed in 95 s.
- Real `--install-agents --interactive openclaw` after Txais upgraded Node to 26.13.0: ok in 1 min 43 s, `openclaw --version` = OpenClaw 2026.10.8.

## Round 2 merge gates (lane/launch-merge-2)

cargo build ok · clippy 0 · cargo test --lib 2551 passed · integration tests 246 passed, 0 failed (scratch USERPROFILE/HOME, real RUSTUP_HOME/CARGO_HOME) · tsc 0 · pnpm test 4975/4975 (676 files, TEMP scratch) · plan-check OK · firewall 0 new · smoke 4/4 (evidence/smoke-776488f9.txt).
cargo-deny: advisories FAILED with no Cargo.lock change since round 1 (new RUSTSEC entries; after-list row). overlap.mjs not run (needs an attached app).

## Found on the way (after-list rows)

- A scratch app run that installs OpenClaw writes the scratch npm folder into the real user PATH (HKCU); detection then counts OpenClaw as installed. Removed by hand.
- OpenClaw's Node engines floor gives an unclear failure sentence.
- New RUSTSEC advisories: zip (via tauri-plugin-updater) and pulldown-cmark, plus unmaintained zbus crates.
- PC note, not Kolux: Node 26 no longer ships corepack, which broke every `pnpm` shim; fixed with `npm i -g corepack` + `corepack enable --install-directory ~/.local/bin pnpm` (same pnpm 12.0.0).

## Decisions (overrulable, in DECISIONS-history.md)

Kits gone; one default model/effort; chooser on new workspaces; OpenCode back; the installer installs no agents and every installable, not-installed agent starts ticked in the picker.

# Scratch homes for the Rust integration tests, as scripts/test-env.ps1 makes them, for macOS and Linux
# shells. Source it in the shell that runs the tests:  . scripts/test-env.sh && cargo test
root="${TMPDIR:-/tmp}/krs-scratch"
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}" RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
mkdir -p "$root/home" "$root/claude-config" "$root/codex" && : > "$root/.kolux-rs-scratch"
export USERPROFILE="$root/home" HOME="$root/home" CLAUDE_CONFIG_DIR="$root/claude-config" CODEX_HOME="$root/codex"
echo "scratch homes under $root"

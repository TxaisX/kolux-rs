#!/usr/bin/env bash
# The cloud proof (DT-C51 / DT-C54) for one checkout, as the merge gate.
#   proof.sh <checkout> <outdir> [quick]
# quick = front end + checks + Windows compile + clippy only (no full cargo test).
# Every step runs even if an earlier one fails; a summary line per step goes to <outdir>/summary.txt.
set -u
WT="$(cd "$1" && pwd)"; OUT="$2"; MODE="${3:-full}"
mkdir -p "$OUT"; : > "$OUT/summary.txt"
export CARGO_TARGET_DIR=/home/user/kolux-rs/src-tauri/target CARGO_BUILD_JOBS=3 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 VITEST_MAX_WORKERS=2
[ -e "$WT/node_modules" ] || ln -s /home/user/kolux-rs/node_modules "$WT/node_modules"
step() { # name, command...
  local name="$1"; shift
  local t0=$(date +%s)
  ( cd "$WT" && "$@" ) > "$OUT/$name.log" 2>&1
  local rc=$?
  echo "$name exit=$rc $(( $(date +%s) - t0 ))s" | tee -a "$OUT/summary.txt"
}
step tsc           npx tsc --noEmit
step vitest        npx vitest run
step license       node scripts/license-check.mjs
step plan-check    node scripts/plan-check.mjs
step workflow      node scripts/workflow-check.mjs
step invoke        node scripts/invoke-contract.mjs
step vite-build    bash -c 'npx vite build && node scripts/bundle-budget.mjs'
step win-check     bash -c 'cd src-tauri && cargo check --target x86_64-pc-windows-gnu --all-targets'
step win-clippy    bash -c 'cd src-tauri && cargo clippy --target x86_64-pc-windows-gnu --all-targets -- -D warnings'
# linux-clippy dropped: Windows-only code reads as dead on Linux; the gate is the windows-gnu clippy (DT-C51)
step deny          bash -c 'cd src-tauri && cargo deny check'
if [ "$MODE" = full ]; then
  step cargo-test  bash -c 'cd src-tauri && . ../scripts/test-env.sh >/dev/null && cargo test --no-fail-fast'
  grep -hE "^test .* FAILED$|^failures:$|test result:" "$OUT/cargo-test.log" | grep -E "FAILED|failed; [1-9]" > "$OUT/cargo-failed.txt" || true
fi
grep -E "FAIL|✗|×" "$OUT/vitest.log" | grep -vE "^\s*$" | head -60 > "$OUT/vitest-failed.txt" || true
echo "done $(date -u +%FT%TZ)" >> "$OUT/summary.txt"

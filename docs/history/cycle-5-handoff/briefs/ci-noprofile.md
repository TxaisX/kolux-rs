# Unit ci-noprofile: the two terminal-service tests that fail on and off on GitHub's Windows runners

On 2026-11-01 GitHub's Windows runner failed these on PRs that do not touch the terminal service (#58 `kolux open`, #37 Artifacts), while the same job passed on #53-#57 and #59 the same day:

- `pty::link::tests::t184b_a_pane_routed_through_the_service_types_resizes_outlives_its_window_and_is_adopted_back`
  panicked at src/pty_link.rs:626 "timed out waiting for the routed typing's output"
- `pty::service::tests::t075b_a_terminal_outlives_its_window_and_a_new_window_gets_its_output_back`
  panicked at src/pty_service.rs:1161 "marker not seen", with the captured screen showing the runner's
  PowerShell 7 ("Administrator: C:\Program Files\PowerShell\7\pwsh.exe") still starting up.

Precedent: PR #48 (merge d1fbcc29, commit c5df3ab6) fixed the same kind of flake in TERM-045 (src-tauri/tests/cards_03.rs) by starting the test shells with `-NoProfile` when the first shell command is pwsh.exe or powershell.exe ("A profile is the user's, not the test's: a runner profile that starts a child makes the idle shell look busy..."). Read that commit (git show c5df3ab6).

What to do:
1. Read both tests and find how they start their shell (through the service's spawn op with the default shell, `shell_commands`, or a test helper). Find the narrowest test-only way to start the shell without a profile on Windows (pwsh/powershell get `-NoProfile`; cmd and Unix shells unchanged). Do NOT change what the product starts for users; this is a test-harness change only. If the spawn op needs a test-only hook, keep it behind #[cfg(test)].
2. Where a test waits on a fixed timer for a real shell, check the wait is long enough for a cold Windows runner, using the same budget other terminal tests in the repo use (do not just inflate it blindly; say why).
3. Prove what can be proven here: cargo check and clippy for x86_64-pc-windows-gnu (all targets), and on Linux the two tests still compile (they are in the Linux baseline failure list because they test Windows behaviour; do not try to make them pass on Linux). The real proof is GitHub's Windows CI run on the PR: say so in the PR body and the evidence file, and list the runs where they failed before (PR #58 run 41353268593, PR #37 run 41362353012).
4. Open the PR titled in plain words, e.g. "CI: start the terminal-service test shells without a PowerShell profile". Evidence file evidence/ci-noprofile.txt. No PLAN tick (no task line), but add a short line where small CI fixes are recorded (look at how #48 was recorded).

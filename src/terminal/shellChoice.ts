// TERM-043 (T-219): choosing the Windows shell for a new terminal. The installed list comes from
// the `shell_list` command (pty.rs); this decides what the menu shows and which icon a tab keeps.
export type ShellEntry = { id: string; name: string; program: string; args: string[] };

/**
 * The shell menu: only for a local Windows client; PowerShell, Command Prompt and Git Bash (the WSL
 * entry belongs to the WSL card and is dropped); the first entry is the one a plain new terminal opens.
 */
export function windowsShellMenu(shells: ShellEntry[], o: { windows: boolean; local: boolean }): ShellEntry[] {
  if (!o.windows || !o.local) return [];
  return shells.filter((s) => s.id !== "wsl");
}

export type ShellIcon = "pwsh" | "powershell" | "cmd" | "gitbash" | "shell";

/** The shell icon a tab keeps: by the program it actually started (a path or a bare name), not by what was asked for. */
export function shellIconOf(started: string | null | undefined): ShellIcon {
  if (!started) return "shell";
  const norm = started.replace(/\\/g, "/").toLowerCase();
  const stem = (norm.split("/").pop() ?? "").replace(/\.exe$/, "");
  if (stem === "pwsh") return "pwsh";
  if (stem === "powershell") return "powershell";
  if (stem === "cmd") return "cmd";
  if ((stem === "bash" || stem === "sh") && /\/git\/(?:usr\/)?bin\//.test(norm)) return "gitbash";
  return "shell";
}

/** PowerShell Auto: PowerShell 7 when it is installed (a real one, not the store stub), else Windows PowerShell. */
export const autoPowerShell = (shells: ShellEntry[]): ShellEntry | null => shells.find((s) => s.id === "pwsh") ?? shells.find((s) => s.id === "powershell") ?? null;

/** The settings field's pick put first (an uninstalled pick or "auto" leaves the list as it is). */
export function withDefaultFirst(shells: ShellEntry[], pick: unknown): ShellEntry[] {
  const i = typeof pick === "string" ? shells.findIndex((s) => s.id === pick) : -1;
  return i <= 0 ? shells : [shells[i], ...shells.slice(0, i), ...shells.slice(i + 1)];
}

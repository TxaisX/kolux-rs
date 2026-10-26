// TERM-043: the icon a Windows tab keeps for the shell it actually started (shellChoice.shellIconOf).
import "../launch/plusMenuExtras.css";
import type { ShellIcon } from "./shellChoice";

const LABEL: Record<Exclude<ShellIcon, "shell">, [string, string]> = {
  pwsh: ["PS7", "PowerShell 7"],
  powershell: ["PS", "Windows PowerShell"],
  cmd: ["cmd", "Command Prompt"],
  gitbash: ["git", "Git Bash"],
};

export default function ShellMark({ icon }: { icon: Exclude<ShellIcon, "shell"> }) {
  const [text, name] = LABEL[icon];
  return (
    <span className="shell-mark" data-shell={icon} role="img" aria-label={name}>
      {text}
    </span>
  );
}

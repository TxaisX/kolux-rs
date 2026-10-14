// TERM-074: files dropped onto a pane are typed into THAT pane as quoted, space-separated paths with no
// line end, so the user finishes the command. Quoting follows the shell the pane runs: Windows PowerShell
// and pwsh take single quotes (a quote inside doubles), Command Prompt takes double quotes, a POSIX shell
// (Git Bash) takes single quotes with the Windows path written with forward slashes (which Git Bash
// understands and which never read as escapes), and an agent's prompt takes double quotes. Pure, so the
// shapes are tested; the webview's drop event and the write chain stay in the pane.

export type ShellKind = "powershell" | "cmd" | "posix" | "other";

/** Which quoting the program in the pane wants, from the program that really started (ACCT-046). */
export function shellKind(program: string | null | undefined, agent: string = "shell"): ShellKind {
  if (agent !== "shell") return "other";
  const stem = (program ?? "").split(/[\\/]/).pop()?.replace(/\.exe$/i, "").toLowerCase() ?? "";
  if (stem === "powershell" || stem === "pwsh") return "powershell";
  if (stem === "cmd") return "cmd";
  if (["bash", "sh", "zsh", "fish", "dash", "ksh"].includes(stem)) return "posix";
  return "other";
}

/** One path, quoted for the shell. Always quoted: a space, an ampersand or a bracket is common in a Windows path. */
export function quotePath(path: string, kind: ShellKind): string {
  switch (kind) {
    case "powershell":
      return `'${path.replace(/'/g, "''")}'`;
    case "cmd":
      return `"${path}"`;
    case "posix":
      return `'${path.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
    default:
      return `"${path.replace(/"/g, '\\"')}"`;
  }
}

/** What gets typed: the quoted paths, space-separated, no Enter. Control characters never go in. */
export function dropText(paths: readonly string[], kind: ShellKind): string {
  return paths
    .filter((p) => p.length > 0 && !/[\x00-\x1f\x7f]/.test(p))
    .map((p) => quotePath(p, kind))
    .join(" ");
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tif", "tiff", "ico", "avif", "heic"]);

/** An image is recognised by its extension (the card's rule); the path is typed the same way. */
export function isImage(path: string): boolean {
  const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return ext !== "" && IMAGE_EXT.has(ext);
}

/** The header line after a drop: counts only, never the paths (which may be private). */
export function dropSummary(paths: readonly string[]): string {
  const images = paths.filter(isImage).length;
  const n = paths.length;
  const what = n === 1 ? "1 path" : `${n} paths`;
  return images > 0 ? `${what} dropped (${images === n ? (n === 1 ? "an image" : "all images") : `${images} image${images === 1 ? "" : "s"}`})` : `${what} dropped`;
}

/** Is the pointer over this pane's box (webview coordinates, already scaled)? */
export function overRect(x: number, y: number, r: { left: number; top: number; right: number; bottom: number }): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

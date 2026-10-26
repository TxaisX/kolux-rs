// T-241-b (BROW-039): what a document preview's chip does besides copying the path, and what a
// document dropped on a tab does. The dispatch is pure over injected senders so it is tested without a window.
import { chipCommit } from "./preview";

/** Sends one Tauri command / event; BrowserPane passes `invoke` and `emit`. */
export type Call = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
export type Emit = (event: string, payload: unknown) => Promise<unknown>;

const HTML = /\.html?$/i;

/** A full path to an HTML document (a tab's start address that is one gets a preview, not a search). */
export function documentPathOf(url: string | undefined): string | null {
  if (!url) return null;
  const c = chipCommit(url, "");
  return c.kind === "document" && HTML.test(c.path) ? c.path : null;
}

/** "Open source": the existing `cli-workspace` file-open event the window already turns into an editor tab. */
export function openSource(path: string, cwd: string | null, emit: Emit): Promise<string | null> {
  if (!cwd) return Promise.resolve("Open this tab in a workspace to open the source in the editor.");
  return emit("cli-workspace", { kind: "file-open", path, worktree: cwd, branch: null }).then(
    () => null,
    (err) => String(err),
  );
}

/** "Open in app": hands the file to the system through the same command the chat and terminal links use. */
export function openWithSystemApp(path: string, call: Call): Promise<string | null> {
  return call("open_path", { path }).then(
    () => null,
    (err) => String(err),
  );
}

/** What a drop on a tab does: the first HTML document in it opens as the tab's preview. */
export type DropVerdict = { kind: "preview"; path: string } | { kind: "say"; text: string };
export function dropVerdict(paths: readonly string[]): DropVerdict {
  const doc = paths.map((p) => p.trim()).find((p) => HTML.test(p));
  return doc ? { kind: "preview", path: doc } : { kind: "say", text: "Drop an .html or .htm document here to preview it in this tab." };
}

/** Is the pointer (webview coordinates, scaled) inside the pane's box? */
export function overPane(x: number, y: number, r: { left: number; top: number; right: number; bottom: number }): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** Previews the document at `path`; answers its address, or why not. */
export function previewAddress(path: string, call: Call): Promise<{ url: string } | { error: string }> {
  return call("browser_preview", { path }).then(
    (r) => ({ url: (r as { url: string }).url }),
    (err) => ({ error: String(err) }),
  );
}

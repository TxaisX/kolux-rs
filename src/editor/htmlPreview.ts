// EDIT-025 (T-317): an HTML file opens rendered in a Kolux browser tab. The back end serves the file's folder on a
// loopback address (browser_preview); the browser pane's own openInBrowser makes the tab. Offered on edit tabs, and
// on diffs only while the file still exists on disk.
import { invoke } from "@tauri-apps/api/core";
import { openInBrowser } from "../browser/BrowserPane";

export const isHtml = (path: string) => /\.html?$/i.test(path);

/** Whether the preview button shows: an HTML file, and (on a diff) one that is still on disk. */
export const offersPreview = (path: string, onDisk: boolean | null = true) => isHtml(path) && onDisk !== false;

export const fileOnDisk = (path: string) => invoke<(unknown | null)[]>("file_stamps", { paths: [path] }).then((r) => (r?.[0] ?? null) !== null, () => false);

/** Opens the preview tab; resolves with an error sentence to show, or null. */
export async function previewHtml(path: string, ask: (p: string) => Promise<{ url: string }> = (p) => invoke("browser_preview", { path: p }), open: (url: string) => void = openInBrowser): Promise<string | null> {
  try {
    open((await ask(path)).url);
    return null;
  } catch (e) {
    return `The preview did not open: ${String(e)}`;
  }
}

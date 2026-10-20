// EDIT-014 (T-234-b): the click side of note links, shared by the preview and the rich view. A plain
// click does nothing (the note stays editable and nothing navigates); Mod+click (Ctrl, or Cmd on
// macOS) follows the link: an anchor in this note scrolls to its heading, anything else goes to
// `onLink` with whether Shift was held (Mod+Shift sends a web link to the system browser).
import { resolveLink, slugOf, type Action } from "./noteLinks";

export type LinkHandler = (a: Action, shift: boolean) => void;

/** The heading element an anchor names: GitHub's slug of its words, repeats numbered -1, -2 ... */
export function headingEl(page: ParentNode, slug: string): HTMLElement | null {
  const want = decodeURIComponent(slug.replace(/%(?![0-9a-f]{2})/gi, "%25")).toLowerCase();
  const seen = new Map<string, number>();
  for (const h of Array.from(page.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"))) {
    const base = slugOf(h.textContent ?? "");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    if ((n === 0 ? base : `${base}-${n}`) === want) return h;
  }
  return null;
}

/** Follows one link address from a note: an anchor in this note scrolls to its heading, anything else goes to `onLink`. */
export function openHref(href: string, page: ParentNode, note: string, root: string | null, shift: boolean, onLink?: LinkHandler): void {
  const act = resolveLink(href, note, root);
  if (act.kind === "here") {
    if (act.heading) headingEl(page, act.heading)?.scrollIntoView({ block: "start" });
  } else if (act.kind !== "none") onLink?.(act, shift);
}

/** Handles a click inside a note's page. True when it was a link follow (the caller stops there). */
export function followClick(e: MouseEvent, page: HTMLElement, note: string, root: string | null, onLink?: LinkHandler): boolean {
  if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!a || !page.contains(a)) return false;
  e.preventDefault();
  e.stopPropagation();
  openHref(a.getAttribute("href") ?? "", page, note, root, e.shiftKey, onLink);
  return true;
}

/** EDIT-014: the toast for a link to a file that is not there (null when it exists). `stamps` is file_stamps: null = gone. */
export async function missingFileToast(path: string, stamps: (paths: string[]) => Promise<unknown[]>): Promise<string | null> {
  try {
    const [stamp] = await stamps([path]);
    return stamp === null || stamp === undefined ? `Cannot open ${path.split(/[/\\]/).pop() ?? path}: the file is not there (or is outside this project).` : null;
  } catch {
    return null; // a failed check never blocks the open; the open itself reports its own error
  }
}

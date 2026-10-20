// VIEW-113 (T-310 rest): the two Markdown view choices that have a control. The front matter block is shown above the note or
// hidden (remembered per file by mdPrefs), and the contents panel is dragged by its left edge, held between its width limits.
import { clampTocWidth } from "./mdPrefs";

/** The front matter block to draw above a note: its text without the closing line's end, or null when there is none or the file hides it. */
export function frontBlock(front: string, hide: boolean): string | null {
  if (hide) return null;
  const text = front.replace(/\r?\n$/, "");
  return text === "" ? null : text;
}

/** What the header control says: nothing when the note has no front matter, else the action it would take. */
export function frontControl(front: string, hide: boolean): { label: string; pressed: boolean } | null {
  if (front === "") return null;
  return { label: hide ? "Show front matter" : "Hide front matter", pressed: !hide };
}

/** The contents panel sits on the right, so dragging its edge to the left (x smaller) widens it; the result stops at the limits. */
export function draggedWidth(startWidth: number, startX: number, x: number): number {
  if (!Number.isFinite(startX) || !Number.isFinite(x)) return clampTocWidth(startWidth);
  return clampTocWidth(startWidth + (startX - x));
}

/** The pane's style for the contents panel width: the CSS variable shell.css reads for the panel and the note's right padding. */
export function tocVar(width: number): Record<string, string> {
  return { "--toc-w": `${clampTocWidth(width)}px` };
}

/** A key on the drag handle: arrows move it 16px, Home and End go to the limits; null for any other key. */
export function nudgedWidth(width: number, key: string, min: number, max: number): number | null {
  if (key === "ArrowLeft") return clampTocWidth(width + 16);
  if (key === "ArrowRight") return clampTocWidth(width - 16);
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}

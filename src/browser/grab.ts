// BROW-035: grab a page element. The picker (annotate.ts) highlights the element under the pointer
// and reports a pick; this is the rest: the details sheet's rows, the crop that cuts the element's
// picture out of the page capture, and the message that sends the element to an agent.
import { cut, fold, type Pick, TEXT_MAX } from "./annotate";
import { cleanUrl, maskSecrets } from "./scrub";

type Box = NonNullable<Pick["box"]>;

/** Room kept around the element in its picture, in CSS pixels. */
export const CROP_PAD = 6;
/** The longest side the element's picture keeps, in picture pixels. */
export const CROP_MAX = 1200;

export type Crop = { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number };

/** The part of the page picture (`picW` x `picH` pixels, showing `cssW` x `cssH` CSS pixels) that holds the
 * element, with `CROP_PAD` around it, cut to the picture's edges and shrunk to `CROP_MAX`.
 * `null` when the element is off the screen or has no size. */
export function cropRect(box: Box, picW: number, picH: number, cssW: number, cssH: number): Crop | null {
  if (![box.x, box.y, box.width, box.height, picW, picH, cssW, cssH].every(Number.isFinite) || picW < 1 || picH < 1 || cssW < 1 || cssH < 1) return null;
  if (box.width <= 0 || box.height <= 0) return null;
  const kx = picW / cssW;
  const ky = picH / cssH;
  const x0 = Math.max(0, Math.floor((box.x - CROP_PAD) * kx));
  const y0 = Math.max(0, Math.floor((box.y - CROP_PAD) * ky));
  const x1 = Math.min(picW, Math.ceil((box.x + box.width + CROP_PAD) * kx));
  const y1 = Math.min(picH, Math.ceil((box.y + box.height + CROP_PAD) * ky));
  if (x1 <= x0 || y1 <= y0) return null;
  const sw = x1 - x0;
  const sh = y1 - y0;
  const shrink = Math.min(1, CROP_MAX / Math.max(sw, sh));
  return { sx: x0, sy: y0, sw, sh, dw: Math.max(1, Math.round(sw * shrink)), dh: Math.max(1, Math.round(sh * shrink)) };
}

export type Row = { label: string; value: string };

/** The details sheet's rows for a pick: the element's tag, selector, text, box and, when the page is a React
 * app in development, the component and source. Empty fields leave no row. */
export function detailRows(p: Pick): Row[] {
  const rows: Row[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value && value.trim()) rows.push({ label, value });
  };
  add("Tag", p.tag && `<${p.tag}>`);
  add("Selector", p.selector);
  add("Text", p.text && cut(fold(p.text), TEXT_MAX));
  if (p.box) add("Box", `${p.box.width}×${p.box.height} at ${p.box.x},${p.box.y}`);
  add("Path", p.path);
  add("Component", p.component);
  add("Source", p.source);
  const attrs = Object.entries(p.hints ?? {}).filter(([k]) => k !== "class");
  add("Attributes", attrs.map(([k, v]) => `${k}="${v}"`).join(" "));
  add("Class", p.hints?.class);
  add("Styles", Object.entries(p.styles ?? {}).map(([k, v]) => `${k}: ${v}`).join("; "));
  return rows;
}

/** The message to the agent: the element's details, and where its picture is when there is one. */
export function grabMessage(p: Pick, title: string, url: string, path: string | null): string {
  const bare = cleanUrl(url) ?? "";
  const lines = [`Element grabbed from ${maskSecrets(title) || bare} (${bare}):`, ""];
  for (const r of detailRows(p)) lines.push(`${r.label.toLowerCase()}: ${r.label === "Selector" ? "`" + r.value + "`" : r.value}`);
  if (path) lines.push(`picture: ${path}`);
  return lines.join("\n") + "\n";
}

/** The details as plain text for the clipboard. */
export const detailsText = (p: Pick): string =>
  detailRows(p)
    .map((r) => `${r.label}: ${r.value}`)
    .join("\n");

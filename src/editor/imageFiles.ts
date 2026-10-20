// EDIT-029 / EDIT-009 (T-235-b, T-234-b): the plain rules behind the image viewer tab and the local pictures in
// notes. Which files are pictures, how far the viewer may zoom and how a zoom keeps the point under the pointer
// still, why a picture would not load, where a note's picture lives on disk, and what name a pasted picture gets.
// No DOM here; the pieces that touch the page are ImageView.tsx and notePictureLoad.ts.

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif", svg: "image/svg+xml" };

const extOf = (path: string) => /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? "";

/** A raster picture file the image viewer opens (an SVG is a picture and text, see isSvg). */
export const isPicture = (path: string) => ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"].includes(extOf(path));
/** An SVG file: drawn like a picture, and text too, so its source can be read and diffed. */
export const isSvg = (path: string) => extOf(path) === "svg";
/** The media type of a picture file name ("" for anything else). */
export const mimeOf = (path: string) => TYPES[extOf(path)] ?? "";

/** The most a picture is shown at, and the least. */
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 32;
export const clampZoom = (z: number) => (Number.isFinite(z) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) : 1);

export type Size = { w: number; h: number };
/** Where the picture's top-left corner sits in the viewer, and how big one picture pixel is on screen. */
export type View = { scale: number; x: number; y: number };

/** A small picture opens at its real size (100%); one bigger than the window opens shrunk to fit it. */
export function startScale(natural: Size, box: Size): number {
  if (natural.w <= 0 || natural.h <= 0 || box.w <= 0 || box.h <= 0) return 1;
  return clampZoom(Math.min(1, box.w / natural.w, box.h / natural.h));
}

/** The scale at which the whole picture fits the box (a small picture is blown up to it, within the limits). */
export function fitScale(natural: Size, box: Size): number {
  if (natural.w <= 0 || natural.h <= 0 || box.w <= 0 || box.h <= 0) return 1;
  return clampZoom(Math.min(box.w / natural.w, box.h / natural.h));
}

/** The picture centred in the box at `scale`. */
export function centred(natural: Size, box: Size, scale: number): View {
  return { scale, x: (box.w - natural.w * scale) / 2, y: (box.h - natural.h * scale) / 2 };
}

/** Zooms by `factor` (inside the limits) so the picture point under (px, py) stays under it. */
export function zoomToward(v: View, factor: number, px: number, py: number): View {
  const scale = clampZoom(v.scale * factor);
  const k = scale / v.scale;
  return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

/** The zoom factor of one wheel turn (Ctrl or Cmd held; a trackpad pinch arrives the same way with small deltas). */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-600, Math.min(600, px)) * 0.0015);
}

/** The zoom factor of a two-finger pinch that moved from `before` to `now` apart (screen pixels). */
export function pinchFactor(before: number, now: number): number {
  return before > 0 && now > 0 ? now / before : 1;
}

/** The distance between two touch points. */
export const apart = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

const MB = (n: number) => `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;

/** The line that says why a picture did not load (instead of an empty tab). */
export function whyNotLoaded(err: unknown, name: string): string {
  const t = String(err instanceof Error ? err.message : err);
  if (/too large/i.test(t)) return `${name} is too large to show${/\(([^)]*)\)/.exec(t) ? ` (${/\(([^)]*)\)/.exec(t)?.[1]})` : ""}.`;
  if (/outside|share|drive|fence|projects/i.test(t)) return `${name} is outside your projects, so Kolux does not open it.`;
  if (/no such file|cannot find|not found|os error (2|3)\b/i.test(t)) return `${name} is not there any more; it was moved or deleted.`;
  if (/denied|permission|os error 5\b/i.test(t)) return `${name} could not be read: access was denied.`;
  if (t === "decode") return `${name} could not be drawn: it is not a picture this window understands, or the file is damaged.`;
  if (t === "empty") return `${name} is empty.`;
  return `${name} could not be loaded: ${t.slice(0, 200)}`;
}

/** "640 x 480 px, 12.3 KB" for the viewer's header. */
export function describe(natural: Size, bytes: number): string {
  const size = bytes >= 1024 * 1024 ? MB(bytes) : `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${natural.w} x ${natural.h} px, ${size}`;
}

/** The text of a percent-escaped address back, leaving a broken escape as typed. */
function unescaped(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const FWD = (p: string) => p.replace(/\\/g, "/");
const DRIVE = /^[A-Za-z]:\//;

/** Folds "." and ".." out of a slash path; null when it climbs above its root. */
function fold(p: string): string | null {
  const m = /^([A-Za-z]:)?(\/*)(.*)$/.exec(p);
  const [, drive = "", lead, rest] = m ?? [];
  const out: string[] = [];
  for (const part of rest.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return `${drive}${lead}${out.join("/")}`;
}

/**
 * Where a picture named in a note lives on disk: the address resolved against the note's folder, or the full
 * path when it is one. Null for anything that is not a local file (web, data and blob addresses, another
 * scheme, a share), for a path that climbs out of the drive, and for a name that is not a picture type.
 */
export function localPicturePath(src: string, notePath: string): string | null {
  const raw = src.trim().replace(/^<|>$/g, "");
  if (!raw || raw.startsWith("#")) return null;
  let s = raw.split(/[?#]/)[0];
  if (/^file:\/\//i.test(s)) s = s.replace(/^file:\/\/\/?/i, "");
  else if (/^[A-Za-z][A-Za-z0-9+.-]+:/.test(s) && !/^[A-Za-z]:[\\/]/.test(s)) return null; // https:, data:, blob:, mailto: ...
  s = FWD(unescaped(s));
  if (s.startsWith("//")) return null; // a share
  const dir = FWD(notePath).replace(/\/[^/]*$/, "");
  const joined = DRIVE.test(s) ? s : s.startsWith("/") ? s : `${dir}/${s}`;
  const done = fold(joined);
  if (!done || !DRIVE.test(done) || !mimeOf(done)) return null;
  return done;
}

/** The picture addresses a block of note text names: ![alt](address) and ![alt](<address with spaces>), in order. */
export function pictureRefs(text: string): { alt: string; src: string }[] {
  const out: { alt: string; src: string }[] = [];
  const re = /!\[([^\]]*)\]\(\s*(?:<([^>]*)>|([^()\s]*(?:\([^()\s]*\)[^()\s]*)*))(?:\s+"[^"]*")?\s*\)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const src = m[2] ?? m[3] ?? "";
    if (src) out.push({ alt: m[1], src });
  }
  return out;
}

const PICTURE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp" };
/** The file ending for a pasted picture's media type, or null when it is not one the note can keep. */
export const extFor = (type: string) => PICTURE_TYPES[type.trim().toLowerCase()] ?? null;

/** A name for a picture saved beside a note: the wanted name, or "-2", "-3" ... when it is taken. Never overwrites. */
export function freeName(wanted: string, taken: (name: string) => boolean): string {
  const m = /^(.*?)(\.[A-Za-z0-9]+)$/.exec(wanted);
  const [stem, ext] = m ? [m[1], m[2]] : [wanted, ""];
  if (!taken(wanted)) return wanted;
  for (let n = 2; n < 1000; n++) if (!taken(`${stem}-${n}${ext}`)) return `${stem}-${n}${ext}`;
  return `${stem}-${Date.now()}${ext}`;
}

/** The name a pasted picture gets: pasted-YYYYMMDD-HHMMSS.ext from the clock given. */
export function pastedName(ext: string, now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `pasted-${p(now.getFullYear(), 4)}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.${ext}`;
}

/**
 * Text pasted from a terminal that is one Windows path to a picture (maybe in quotes, maybe with a line end):
 * the path to insert as a picture; null for anything else, which pastes as the text it is.
 */
export function pastedPicturePath(text: string): string | null {
  const t = text.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (!/^[A-Za-z]:[\\/]/.test(t) || /[\r\n\t<>|*?"]/.test(t)) return null;
  return mimeOf(t) && !isSvg(t) ? t : null;
}

/** Folder and file name of a path with either slash. */
export function splitPath(path: string): { dir: string; name: string } {
  const p = FWD(path);
  const at = p.lastIndexOf("/");
  return { dir: at < 0 ? "" : path.slice(0, at), name: at < 0 ? path : path.slice(at + 1) };
}

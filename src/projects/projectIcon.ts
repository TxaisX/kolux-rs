// PROJ-019: a project's icon, chosen by hand. The Rust side (projects.rs clean_icon) is the judge of
// what is kept; this file is how the sidebar reads and builds the same three kinds of value:
// "emoji:<emoji>", "icon:<built-in name>" and "image:<data URL>". No choice means the automatic icon.

/** The built-in icons the picker offers, in order. ProjectIcon.tsx draws each; a name it does not
 *  know (one saved by a newer version) is drawn as a folder. */
export const ICON_NAMES = ["folder", "rocket", "box", "globe", "chip", "book", "pulse", "megaphone", "cup", "moon", "clock", "table", "plug", "spark", "target", "merge", "shell", "pin", "bell"] as const;

/** The most a picture icon may take as the whole value; the same limit projects.rs enforces. */
export const ICON_IMAGE_MAX = 64 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

export type IconView = { kind: "emoji"; emoji: string } | { kind: "icon"; name: string } | { kind: "image"; src: string } | { kind: "auto"; letter: string };

/** PROJ-018: what the repository offers as an icon (see `auto_icon` on the Rust side): a picture as a
 *  data URL, or a web address the page loads itself (a picture on the web, or the owner's avatar). */
const AUTO_TYPES = ["png", "jpeg", "gif", "webp", "svg+xml", "x-icon"];
export type AutoIcon = { kind: "image" | "remote" | "avatar"; src: string };

/** A found icon that is safe to draw: a small picture data URL, or a plain https address. Anything else is no icon. */
export function autoIconView(auto: AutoIcon | null | undefined): IconView | null {
  if (!auto || typeof auto.src !== "string") return null;
  const { kind, src } = auto;
  let ok = false;
  if (kind === "image") {
    const at = src.indexOf(";base64,");
    const type = src.startsWith("data:image/") && at > 0 ? src.slice("data:image/".length, at) : "";
    ok = AUTO_TYPES.includes(type) && src.length <= ICON_IMAGE_MAX && /^[A-Za-z0-9+/=]+$/.test(src.slice(at + ";base64,".length));
  } else if (kind === "remote" || kind === "avatar") {
    // plain https only: no quotes, spaces, angle brackets or backslashes
    ok = src.startsWith("https://") && src.length <= 2048 && !/[\s"'<>\\]/.test(src);
  }
  return ok ? { kind: "image", src } : null;
}

/** What to draw for a project: its chosen icon; else the icon found in its repository (`auto`); else a
 *  folder symbol once the search found nothing (`auto === null`); until then the first letter of its
 *  name. A damaged or empty value is no choice. */
export function iconView(value: string | undefined, name: string, auto?: AutoIcon | null): IconView {
  const at = value ? value.indexOf(":") : -1;
  const rest = value && at > 0 ? value.slice(at + 1) : "";
  if (rest) {
    const kind = value!.slice(0, at);
    if (kind === "emoji") return { kind, emoji: rest };
    if (kind === "icon") return { kind, name: rest };
    if (kind === "image" && rest.startsWith("data:image/")) return { kind, src: rest };
  }
  const found = autoIconView(auto);
  if (found) return found;
  if (auto === null) return { kind: "icon", name: "folder" };
  return { kind: "auto", letter: (Array.from(name.trim())[0] ?? "?").toUpperCase() };
}

/** Why a picture cannot be an icon, or null when it can. */
export function pictureProblem(type: string, size: number): string | null {
  if (!IMAGE_TYPES.includes(type)) return "Pick a PNG, JPEG, GIF, WebP or SVG picture.";
  // The data URL is about a third bigger than the file; leave room for its header.
  if (Math.ceil((size * 4) / 3) + 40 > ICON_IMAGE_MAX) return `That picture is too large; an icon may take about ${Math.floor((ICON_IMAGE_MAX * 3) / 4 / 1024) - 1} KB.`;
  return null;
}

/** The value to save for a picture's data URL. */
export const pictureIcon = (dataUrl: string): string => `image:${dataUrl}`;
export const emojiIcon = (emoji: string): string => `emoji:${emoji.trim()}`;
export const builtInIcon = (name: string): string => `icon:${name}`;

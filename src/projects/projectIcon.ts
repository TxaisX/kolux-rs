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

/** What to draw for a project: its chosen icon, else the automatic one (the first letter of its
 *  name, until the repository's own icon is found). A damaged or empty value is no choice. */
export function iconView(value: string | undefined, name: string): IconView {
  const at = value ? value.indexOf(":") : -1;
  const rest = value && at > 0 ? value.slice(at + 1) : "";
  if (rest) {
    const kind = value!.slice(0, at);
    if (kind === "emoji") return { kind, emoji: rest };
    if (kind === "icon") return { kind, name: rest };
    if (kind === "image" && rest.startsWith("data:image/")) return { kind, src: rest };
  }
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

// APP-038 (T-324-b): screenshots on a feedback report. Pure rules: which files are taken, which are
// refused and why. The dialog reads the files and puts the first image on the clipboard; the app
// still sends nothing, so the images only ever travel by the user pasting them into the issue page.
export const MAX_IMAGES = 4;
export const MAX_BYTES = 8 * 1024 * 1024;

export type Kind = "png" | "jpeg" | "webp" | "gif";
export const MIME: Record<Kind, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** A file the user picked, already read. */
export type Pick = { name: string; type: string; bytes: Uint8Array };
export type Shot = { name: string; kind: Kind; bytes: Uint8Array };

function starts(b: Uint8Array, sig: number[], at = 0): boolean {
  return b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
}

/** What the bytes really are, whatever the file is called: the signature decides. */
export function sniff(b: Uint8Array): Kind | null {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "gif";
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  return null;
}

const ALLOWED = new Set(Object.values(MIME));
const mb = (n: number) => `${n / (1024 * 1024)} MB`;

export type Added = { shots: Shot[]; refused: string[] };

/** Takes the picks in order. A crash report takes none. An empty file, a file that is not really a
 *  PNG, JPEG, WebP or GIF, or one over 8 MB is refused by name and does not count toward the limit;
 *  once four are held, the rest are left out and the limit is named once. */
export function addImages(held: Shot[], picks: Pick[], crash = false): Added {
  if (crash) return { shots: held, refused: picks.length ? ["Crash reports take no images; the diagnostic bundle is copied instead."] : [] };
  const shots = [...held];
  const refused: string[] = [];
  let over = 0;
  for (const p of picks) {
    if (p.bytes.length === 0) {
      refused.push(`${p.name} is empty.`);
      continue;
    }
    const kind = sniff(p.bytes);
    if (!kind || (p.type && !ALLOWED.has(p.type))) {
      refused.push(`${p.name} is not a PNG, JPEG, WebP or GIF image.`);
      continue;
    }
    if (p.bytes.length > MAX_BYTES) {
      refused.push(`${p.name} is over ${mb(MAX_BYTES)}.`);
      continue;
    }
    if (shots.length >= MAX_IMAGES) {
      over++;
      continue;
    }
    shots.push({ name: p.name, kind, bytes: p.bytes });
  }
  if (over) refused.push(`Only ${MAX_IMAGES} images can go with a report; ${over} left out.`);
  return { shots, refused };
}

/** The line shown once the issue page is open. */
export function clipboardNote(count: number, copied: boolean): string {
  if (count === 0) return "";
  const n = count === 1 ? "1 screenshot" : `${count} screenshots`;
  if (!copied) return `${n} attached, but the first could not be put on the clipboard; add it to the issue page yourself.`;
  return count === 1 ? "Your screenshot is on the clipboard: paste it into the issue page." : `The first of your ${n} is on the clipboard: paste it into the issue page; add the others by hand.`;
}

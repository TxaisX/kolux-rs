import type { InvokeArgs } from "@tauri-apps/api/core";
// EDIT-009 / EDIT-029 (T-234-b, T-235-b): pictures that live in files. Reading a picture's bytes for the image viewer
// and for a note, and saving a pasted or inserted picture beside its note (files.rs: file_bytes, file_write_picture).
// The Tauri call is passed in, so every rule here is tested without the app.
import { extFor, freeName, localPicturePath, mimeOf, pastedName, pastedPicturePath, splitPath } from "./imageFiles";
import { imageLink } from "./richFormat";

export type Call = <T>(cmd: string, args?: InvokeArgs, options?: { headers: Record<string, string> }) => Promise<T>;

/** The bytes of a picture file. Rejects with "empty" for a file with nothing in it. */
export async function readPicture(path: string, call: Call): Promise<Uint8Array> {
  const buf = await call<ArrayBuffer | number[]>("file_bytes", { path });
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf);
  if (bytes.byteLength === 0) throw new Error("empty");
  return bytes;
}

/** An address for the page to show a picture from: the bytes as a blob. `make` is URL.createObjectURL in the app. */
export async function pictureUrl(path: string, call: Call, make: (blob: Blob) => string): Promise<string> {
  const bytes = await readPicture(path, call);
  return make(new Blob([bytes as BlobPart], { type: mimeOf(path) || "application/octet-stream" }));
}

/** Saves picture bytes as a new file `dir/name` (never over an existing file; the app refuses that too). */
export function writePicture(path: string, bytes: Uint8Array, call: Call): Promise<void> {
  return call<void>("file_write_picture", bytes, { headers: { "x-file-path": encodeURIComponent(path) } });
}

const names = async (dir: string, call: Call): Promise<Set<string>> => {
  const list = await call<{ name: string }[]>("dir_list", { path: dir });
  return new Set(list.map((e) => e.name.toLowerCase()));
};

/** The markdown for a picture the user picked: linked in place when it is in the note's folder or below it, else a copy is saved beside the note. */
export async function insertPicked(notePath: string, picked: string, call: Call): Promise<string> {
  const fwd = (p: string) => p.replace(/\\/g, "/");
  const { dir } = splitPath(notePath);
  const base = fwd(dir).toLowerCase() + "/";
  if (fwd(picked).toLowerCase().startsWith(base)) return imageLink(notePath, picked);
  const bytes = await readPicture(picked, call);
  const taken = await names(dir, call);
  const name = freeName(splitPath(picked).name, (n) => taken.has(n.toLowerCase()));
  const target = `${dir}${dir.includes("\\") ? "\\" : "/"}${name}`;
  await writePicture(target, bytes, call);
  return imageLink(notePath, target);
}

/** The markdown for a picture pasted from the clipboard (or dropped): saved beside the note as pasted-<date>.<ext>. */
export async function insertPasted(notePath: string, file: { type: string; arrayBuffer(): Promise<ArrayBuffer> }, call: Call, now = new Date()): Promise<string> {
  const ext = extFor(file.type);
  if (!ext) throw new Error(`A ${file.type || "this kind of"} picture cannot be kept in a note; use png, jpeg, gif, webp or bmp.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("The pasted picture is empty.");
  const { dir } = splitPath(notePath);
  const taken = await names(dir, call);
  const name = freeName(pastedName(ext, now), (n) => taken.has(n.toLowerCase()));
  const target = `${dir}${dir.includes("\\") ? "\\" : "/"}${name}`;
  await writePicture(target, bytes, call);
  return imageLink(notePath, target);
}

type PicFile = { type: string; arrayBuffer(): Promise<ArrayBuffer> };
export type Pasted = { file: PicFile } | { path: string };
/** What a paste holds that the note should keep as a picture: a picture file (a screenshot, a copied image) or one Windows picture path as text. Null for any other paste, which goes on as it was. */
export function pastedPicture(clip: { files?: ArrayLike<PicFile> | null; getData(type: string): string }): Pasted | null {
  const files = Array.from(clip.files ?? []);
  const file = files.find((f) => extFor(f.type));
  if (file) return { file };
  const path = pastedPicturePath(clip.getData("text/plain"));
  return path ? { path } : null;
}

/** The markdown to put in the note for a pasted picture, saving a copy beside the note when it is not already there. */
export const insertPastedPicture = (notePath: string, p: Pasted, call: Call, now = new Date()): Promise<string> => ("file" in p ? insertPasted(notePath, p.file, call, now) : insertPicked(notePath, p.path, call));

/** What to do with pasted text that is one Windows path to a picture: the same as picking that picture. */
export const insertPath = insertPicked;

/** The words for a picture that could not be inserted. */
export function insertError(e: unknown): string {
  const t = String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, "");
  if (t === "empty") return "Could not insert the picture: the file is empty.";
  if (/already exists/i.test(t)) return "Could not insert the picture: a file with that name is already there. Try again.";
  return `Could not insert the picture: ${t}`;
}

/**
 * Fills in the pictures of a rendered note: each <img> whose address is a local file is fetched and shown from its bytes.
 * Pictures are fetched when they come within `ahead` pixels of the visible part (watch), so a long note does not read every
 * file at once and the ones about to scroll in are ready before they arrive. A picture that fails is replaced by a short
 * line saying why. Returns the stop function (revokes the blob addresses).
 */
export type Imgs = { src: string; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; replaceWith(...n: unknown[]): void; alt?: string };
export type Watch = (el: Imgs, show: () => void) => () => void;

export function showLocalPictures(imgs: Imgs[], notePath: string, call: Call, watch: Watch, make: (b: Blob) => string, drop: (url: string) => void, note: (text: string) => unknown): () => void {
  const made: string[] = [];
  const stops: (() => void)[] = [];
  let alive = true;
  for (const img of imgs) {
    const path = localPicturePath(img.getAttribute("src") ?? "", notePath);
    if (!path) continue;
    img.setAttribute("data-local-picture", path);
    stops.push(
      watch(img, () => {
        void pictureUrl(path, call, make).then(
          (url) => {
            if (!alive) return drop(url);
            made.push(url);
            img.setAttribute("src", url);
          },
          (e) => alive && img.replaceWith(note(pictureWhy(e, splitPath(path).name))),
        );
      }),
    );
  }
  return () => {
    alive = false;
    stops.forEach((s) => s());
    made.forEach(drop);
  };
}

/** The line shown in place of a note's local picture that could not be read. */
export function pictureWhy(e: unknown, name: string): string {
  const t = String(e instanceof Error ? e.message : e);
  if (t === "empty") return `Picture not shown: ${name} is empty.`;
  if (/too large/i.test(t)) return `Picture not shown: ${name} is too large.`;
  if (/outside|share|drive/i.test(t)) return `Picture not shown: ${name} is outside your projects.`;
  if (/no such file|cannot find|not found|os error (2|3)\b/i.test(t)) return `Picture not shown: ${name} is not there.`;
  return `Picture not shown: ${name} could not be read.`;
}

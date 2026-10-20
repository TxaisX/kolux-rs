// TERM-070 (T-220): pasting while the clipboard holds an image saves the image as a file and pastes
// its path for the agent to read. Text clipboards skip the image step entirely, an image is still
// tried when reading the text fails, the path goes in bracketed even when the program never asked
// for bracketed paste, and a failure to extract or paste is reported, never swallowed. One image
// per paste (several at once are not shipped). Pure over a small clipboard shape so it tests bare.
import { BRACKET_CLOSE, BRACKET_OPEN } from "./paste";

/** The part of a clipboard event this reads: text, and the items that may be files. */
export type Clip = {
  getData?: (kind: string) => string;
  items?: ArrayLike<{ kind: string; type: string; getAsFile: () => File | null }> | null;
  files?: ArrayLike<File> | null;
};

/** The path as the program receives it: bracketed whatever the program asked for. */
export const bracketedPath = (path: string) => BRACKET_OPEN + path + BRACKET_CLOSE;

/** The clipboard's text, or null when reading it threw (the image is then still tried). */
export function textOf(clip: Clip): string | null {
  try {
    return clip.getData?.("text") ?? "";
  } catch {
    return null;
  }
}

/** The first image file the clipboard holds, or null. */
export function imageOf(clip: Clip): File | null {
  for (const it of Array.from(clip.items ?? [])) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return Array.from(clip.files ?? []).find((f) => f.type.startsWith("image/")) ?? null;
}

/** What a paste does: `text` leaves it to the ordinary paste, `image` is ours. */
export function decide(clip: Clip): { take: "text" } | { take: "image"; file: File } {
  const text = textOf(clip);
  // A text clipboard never looks at images; an unreadable one still tries the image.
  if (text !== null && text !== "") return { take: "text" };
  const file = imageOf(clip);
  return file ? { take: "image", file } : { take: "text" };
}

export type Deps = {
  /** Saves the bytes and answers the file's path; rejects with a sentence when it cannot. */
  save: (bytes: Uint8Array, kind: string) => Promise<string>;
  /** Sends text to the program (already bracketed). */
  send: (data: string) => unknown;
  /** Says out loud that the screenshot could not be pasted. */
  report: (message: string) => void;
};

/** Saves the image and pastes its path; any failure goes to `report`. Resolves true when the path went in. */
export async function pasteImage(file: File, d: Deps): Promise<boolean> {
  let path: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    path = await d.save(bytes, file.type);
  } catch (e) {
    d.report(typeof e === "string" ? e : e instanceof Error ? e.message : "The screenshot could not be saved; nothing was pasted.");
    return false;
  }
  try {
    await d.send(bracketedPath(path));
    return true;
  } catch {
    d.report("The screenshot was saved but its path could not be pasted into the terminal.");
    return false;
  }
}

/**
 * Listens for paste on `target` (registered before the text paste handler, so an image clipboard is
 * ours and a text one falls through). Returns the detach.
 */
export function attachScreenshotPaste(target: EventTarget | null | undefined, d: Deps): () => void {
  const on = (e: Event) => {
    const clip = (e as ClipboardEvent).clipboardData;
    if (!clip) return;
    const pick = decide(clip);
    if (pick.take !== "image") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    void pasteImage(pick.file, d);
  };
  target?.addEventListener("paste", on, { capture: true });
  return () => target?.removeEventListener("paste", on, { capture: true });
}

/** The clipboard's image read through the async clipboard API (the menu and chord paste, which have no paste event); null when there is none or reading is refused. */
export async function clipboardImage(): Promise<File | null> {
  try {
    for (const item of (await navigator.clipboard?.read?.()) ?? []) {
      const kind = item.types.find((t) => t.startsWith("image/"));
      if (kind) return new File([await item.getType(kind)], "clipboard", { type: kind });
    }
  } catch {
    // refused or unsupported: the caller reports the original failure
  }
  return null;
}

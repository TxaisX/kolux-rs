// TERM-070: a screenshot on the clipboard is saved and its path pasted, bracketed; text skips the image step.
import { expect, test, vi } from "vitest";
import { attachScreenshotPaste, bracketedPath, decide, imageOf, pasteImage, textOf, typedPath, type Clip } from "./screenshotPaste";
import { BRACKET_CLOSE, BRACKET_OPEN } from "./paste";

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
const imageClip = (text: string | (() => string) = ""): Clip => ({
  getData: typeof text === "function" ? text : () => text,
  items: [{ kind: "file", type: "image/png", getAsFile: () => png() }],
});
const paste = (target: EventTarget, clip: Clip) => {
  const e = Object.assign(new Event("paste", { cancelable: true }), { clipboardData: clip });
  target.dispatchEvent(e);
  return e;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

test("TERM-070: the path is bracketed even though the program never asked for bracketed paste", () => {
  expect(bracketedPath("C:\\p\\a b.png")).toBe(BRACKET_OPEN + "C:\\p\\a b.png" + BRACKET_CLOSE);
});

test("T-249-c: the saved image's path is typed quoted when it holds a space or a splitting character, plain otherwise", async () => {
  expect(typedPath("C:\\Users\\Ann Lee\\AppData\\shot.png")).toBe('"C:\\Users\\Ann Lee\\AppData\\shot.png"');
  expect(typedPath("C:\\p\\a&b.png")).toBe('"C:\\p\\a&b.png"');
  expect(typedPath("C:\\p\\shot.png")).toBe("C:\\p\\shot.png");
  const sent: string[] = [];
  await pasteImage(png(), { save: async () => "C:\\x y\\s.png", send: (d) => sent.push(d), report: () => {} });
  expect(sent).toEqual([BRACKET_OPEN + '"C:\\x y\\s.png"' + BRACKET_CLOSE]);
});

test("TERM-070: a text clipboard skips the image check entirely, even with an image beside the text", () => {
  const items = vi.fn(() => png());
  const clip: Clip = { getData: () => "hello", items: [{ kind: "file", type: "image/png", getAsFile: items }] };
  expect(decide(clip)).toEqual({ take: "text" });
  expect(items).not.toHaveBeenCalled();
});

test("TERM-070: the image is still tried when reading the clipboard text fails", () => {
  const clip = imageClip(() => {
    throw new Error("clipboard denied");
  });
  expect(textOf(clip)).toBeNull();
  expect(decide(clip).take).toBe("image");
});

test("TERM-070: an empty clipboard with no image is left to the ordinary paste; non-image files are not images", () => {
  expect(decide({ getData: () => "" })).toEqual({ take: "text" });
  expect(imageOf({ items: [{ kind: "file", type: "application/pdf", getAsFile: () => new File([], "a.pdf") }] })).toBeNull();
  expect(imageOf({ files: [png()] })?.type).toBe("image/png");
});

test("TERM-070: pasting a screenshot saves the bytes and sends the bracketed path once", async () => {
  const target = new EventTarget();
  const save = vi.fn(async (bytes: Uint8Array, kind: string) => {
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
    expect(kind).toBe("image/png");
    return "C:\\profile\\pasted-images\\paste-1-0.png";
  });
  const sent: string[] = [];
  attachScreenshotPaste(target, { save, send: (d) => sent.push(d), report: () => {} });
  const e = paste(target, imageClip());
  expect(e.defaultPrevented).toBe(true);
  await flush();
  expect(sent).toEqual([BRACKET_OPEN + "C:\\profile\\pasted-images\\paste-1-0.png" + BRACKET_CLOSE]);
});

test("TERM-070: plain text is not touched, so the ordinary paste types it as usual", async () => {
  const target = new EventTarget();
  const save = vi.fn();
  attachScreenshotPaste(target, { save, send: () => {}, report: () => {} });
  const e = paste(target, { getData: () => "ls -la" });
  expect(e.defaultPrevented).toBe(false);
  await flush();
  expect(save).not.toHaveBeenCalled();
});

test("TERM-070: a failed save is reported with its own sentence and nothing is sent", async () => {
  const sent: string[] = [];
  const said: string[] = [];
  const ok = await pasteImage(png(), { save: async () => Promise.reject("The clipboard image was empty; nothing was pasted."), send: (d) => sent.push(d), report: (m) => said.push(m) });
  expect(ok).toBe(false);
  expect(sent).toEqual([]);
  expect(said).toEqual(["The clipboard image was empty; nothing was pasted."]);
});

test("TERM-070: a path that cannot be pasted is reported too, not swallowed", async () => {
  const said: string[] = [];
  const ok = await pasteImage(png(), { save: async () => "p.png", send: () => Promise.reject(new Error("closed")), report: (m) => said.push(m) });
  expect(ok).toBe(false);
  expect(said[0]).toMatch(/could not be pasted/);
});

test("TERM-070: detach stops listening", async () => {
  const target = new EventTarget();
  const save = vi.fn(async () => "p.png");
  const detach = attachScreenshotPaste(target, { save, send: () => {}, report: () => {} });
  detach();
  paste(target, imageClip());
  await flush();
  expect(save).not.toHaveBeenCalled();
});

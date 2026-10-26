// APP-038: screenshots on a feedback report. Real file signatures, not stand-in strings.
import { expect, test } from "vitest";
import { addImages, clipboardNote, MAX_BYTES, MAX_IMAGES, sniff, type Pick, type Shot } from "./images";
import { closed, reduce } from "./model";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const bytes = (sig: number[], extra = 4) => new Uint8Array([...sig, ...new Array(extra).fill(7)]);
const pick = (name: string, b: Uint8Array, type = "image/png"): Pick => ({ name, type, bytes: b });

test("the four allowed formats are told by their signature", () => {
  expect(sniff(bytes(PNG))).toBe("png");
  expect(sniff(bytes(JPG))).toBe("jpeg");
  expect(sniff(bytes(GIF))).toBe("gif");
  expect(sniff(bytes(WEBP))).toBe("webp");
  expect(sniff(new TextEncoder().encode("hello, not an image"))).toBeNull();
  expect(sniff(new Uint8Array([0x89, 0x50]))).toBeNull();
  expect(sniff(bytes([0x47, 0x49, 0x46, 0x38, 0x31, 0x61]))).toBeNull();
});

test("five images: the fifth is refused and the limit is named", () => {
  const five = [1, 2, 3, 4, 5].map((n) => pick(`s${n}.png`, bytes(PNG)));
  const r = addImages([], five);
  expect(r.shots.map((s) => s.name)).toEqual(["s1.png", "s2.png", "s3.png", "s4.png"]);
  expect(r.refused).toEqual([`Only ${MAX_IMAGES} images can go with a report; 1 left out.`]);
});

test("images beyond the limit are all left out, counted once", () => {
  const held: Shot[] = [1, 2, 3].map((n) => ({ name: `h${n}.png`, kind: "png", bytes: bytes(PNG) }));
  const r = addImages(held, [1, 2, 3].map((n) => pick(`n${n}.png`, bytes(PNG))));
  expect(r.shots).toHaveLength(4);
  expect(r.refused).toEqual(["Only 4 images can go with a report; 2 left out."]);
});

test("an empty file is refused by name the moment it is added and does not count", () => {
  const r = addImages([], [pick("blank.png", new Uint8Array()), pick("ok.png", bytes(PNG))]);
  expect(r.refused).toEqual(["blank.png is empty."]);
  expect(r.shots.map((s) => s.name)).toEqual(["ok.png"]);
});

test("a file that is not really an image is refused by name and does not count toward the limit", () => {
  const fake = pick("notes.png", new TextEncoder().encode("just text with a png name"));
  const r = addImages([], [fake, ...[1, 2, 3, 4].map((n) => pick(`p${n}.png`, bytes(PNG)))]);
  expect(r.refused).toEqual(["notes.png is not a PNG, JPEG, WebP or GIF image."]);
  expect(r.shots).toHaveLength(4);
});

test("a declared type outside the four is refused even with image bytes", () => {
  const r = addImages([], [pick("a.bmp", bytes(PNG), "image/bmp"), pick("b.svg", bytes(PNG), "image/svg+xml"), pick("c.jpg", bytes(JPG), "image/jpeg")]);
  expect(r.shots.map((s) => s.name)).toEqual(["c.jpg"]);
  expect(r.refused).toHaveLength(2);
  expect(addImages([], [pick("d.webp", bytes(WEBP), "")]).shots).toHaveLength(1);
});

test("8 MB is the most one image may be", () => {
  const edge = new Uint8Array(MAX_BYTES);
  edge.set(PNG);
  const over = new Uint8Array(MAX_BYTES + 1);
  over.set(PNG);
  expect(addImages([], [pick("edge.png", edge)]).shots).toHaveLength(1);
  const r = addImages([], [pick("big.png", over)]);
  expect(r.shots).toHaveLength(0);
  expect(r.refused).toEqual(["big.png is over 8 MB."]);
});

test("a crash report takes no images", () => {
  const r = addImages([], [pick("a.png", bytes(PNG))], true);
  expect(r.shots).toEqual([]);
  expect(r.refused[0]).toContain("Crash reports take no images");
  expect(addImages([], [], true).refused).toEqual([]);
});

test("the note says how many screenshots there are and whether the first is on the clipboard", () => {
  expect(clipboardNote(0, false)).toBe("");
  expect(clipboardNote(1, true)).toContain("paste");
  expect(clipboardNote(3, true)).toContain("first of your 3 screenshots");
  expect(clipboardNote(2, false)).toContain("could not be put on the clipboard");
});

test("a sent report's note carries the screenshot line", () => {
  const s = reduce({ ...closed, open: true }, { t: "sent", trimmed: false, extra: clipboardNote(1, true) });
  expect(s.note).toContain("A new-issue page opened");
  expect(s.note.endsWith("paste it into the issue page.")).toBe(true);
});

import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENTS, dropHere, isImageName, nameOf, pastedName, refusal, saving, sendable, update, withPaths, without, type Attachment } from "./attach";

const a = (id: string, over: Partial<Attachment> = {}): Attachment => ({ id, name: id, image: false, state: "ready", path: `C:\\f\\${id}`, ...over });

describe("CHAT-021 attachments", () => {
  it("Send stays held while any attachment is saving", () => {
    const list = [a("1", { state: "saving", path: undefined, image: true })];
    expect(saving(list)).toBe(true);
    expect(sendable("hello", list)).toBe(false);
    expect(sendable("hello", update(list, "1", { state: "ready", path: "C:\\x.png" }))).toBe(true);
  });
  it("attachments alone are enough to send, a failed one is not", () => {
    expect(sendable("", [a("1")])).toBe(true);
    expect(sendable("", [a("1", { state: "failed" })])).toBe(false);
    expect(sendable("  ", [])).toBe(false);
  });
  it("an agent that cannot take images refuses a pasted one", () => {
    expect(refusal([], "omp", true)).toMatch(/cannot take images/);
    expect(refusal([], "claude", true)).toBeNull();
    expect(refusal([], "omp", false)).toBeNull();
    expect(refusal([], undefined, true)).toMatch(/cannot take images/);
  });
  it("too many waiting at once are refused", () => {
    const full = Array.from({ length: MAX_ATTACHMENTS }, (_, i) => a(String(i)));
    expect(refusal(full, "claude", false)).toMatch(/At most 5/);
    expect(refusal(full.slice(1), "claude", false)).toBeNull();
  });
  it("pasted images get a plain generic name; picked files keep theirs", () => {
    expect(pastedName("image/png", 1)).toBe("Pasted image 1.png");
    expect(pastedName("image/jpeg", 2)).toBe("Pasted image 2.jpg");
    expect(pastedName("image/unknown", 3)).toBe("Pasted image 3.png");
    expect(nameOf("C:\\Users\\me\\report final.pdf")).toBe("report final.pdf");
    expect(nameOf("/a/b/c.txt")).toBe("c.txt");
    expect(isImageName("x.PNG")).toBe(true);
    expect(isImageName("x.pdf")).toBe(false);
  });
  it("the message carries the ready paths after the text, quoted when they hold spaces", () => {
    expect(withPaths("look", [a("1"), a("2", { path: "C:\\my files\\b.png" })])).toBe('look\nC:\\f\\1 "C:\\my files\\b.png"');
    expect(withPaths("look", [a("1", { state: "failed" })])).toBe("look");
    expect(withPaths("", [a("1")])).toBe("C:\\f\\1");
    expect(withPaths("look  \n", [a("1")])).toBe("look\nC:\\f\\1");
  });
  it("removing a chip drops only that one", () => {
    expect(without([a("1"), a("2")], "1").map((x) => x.id)).toEqual(["2"]);
  });
  it("a drop counts only when it lands on this pane", () => {
    const rect = { left: 0, top: 0, right: 400, bottom: 300 };
    expect(dropHere({ x: 100, y: 100 }, rect, true)).toBe(true);
    expect(dropHere({ x: 100, y: 100 }, rect, false)).toBe(false);
    expect(dropHere({ x: 900, y: 100 }, rect, true)).toBe(false);
  });
});

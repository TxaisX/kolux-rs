import { describe, expect, it, vi } from "vitest";
import { documentPathOf, dropVerdict, openSource, openWithSystemApp, overPane, previewAddress } from "./previewActions";

describe("BROW-039 the preview chip's actions", () => {
  it("open source sends the window's own file-open event for the worktree", async () => {
    const emit = vi.fn().mockResolvedValue(undefined);
    expect(await openSource("C:\\w\\site\\index.html", "C:\\w", emit)).toBeNull();
    expect(emit).toHaveBeenCalledWith("cli-workspace", { kind: "file-open", path: "C:\\w\\site\\index.html", worktree: "C:\\w", branch: null });
  });

  it("open source says so when the tab has no workspace, and sends nothing", async () => {
    const emit = vi.fn();
    expect(await openSource("C:\\w\\a.html", null, emit)).toMatch(/workspace/);
    expect(emit).not.toHaveBeenCalled();
  });

  it("open source reports a failed send instead of dropping it", async () => {
    expect(await openSource("C:\\w\\a.html", "C:\\w", () => Promise.reject(new Error("no window")))).toMatch(/no window/);
  });

  it("open in app hands the full path to open_path and nothing else", async () => {
    const call = vi.fn().mockResolvedValue("opened");
    expect(await openWithSystemApp("C:\\w\\a.html", call)).toBeNull();
    expect(call).toHaveBeenCalledWith("open_path", { path: "C:\\w\\a.html" });
  });

  it("open in app shows the refusal (a path outside the roots, a missing file)", async () => {
    expect(await openWithSystemApp("C:\\gone.html", () => Promise.reject("C:\\gone.html is not a file"))).toBe("C:\\gone.html is not a file");
  });
});

describe("BROW-039 a document dropped on a tab", () => {
  it("the first HTML document previews, whatever else came with it", () => {
    expect(dropVerdict(["C:\\a\\notes.txt", "C:\\a\\Page.HTM", "C:\\a\\b.html"])).toEqual({ kind: "preview", path: "C:\\a\\Page.HTM" });
  });
  it("anything else says what can be dropped", () => {
    expect(dropVerdict(["C:\\a\\notes.txt"])).toMatchObject({ kind: "say" });
    expect(dropVerdict([])).toMatchObject({ kind: "say" });
  });
  it("only a drop inside the pane's box counts, edges included", () => {
    const r = { left: 10, top: 10, right: 110, bottom: 60 };
    expect(overPane(10, 60, r)).toBe(true);
    expect(overPane(9, 30, r)).toBe(false);
    expect(overPane(50, 61, r)).toBe(false);
  });
  it("previewAddress answers the preview's address or the error text", async () => {
    expect(await previewAddress("C:\\a.html", () => Promise.resolve({ url: "http://127.0.0.1:5/t/a.html" }))).toEqual({ url: "http://127.0.0.1:5/t/a.html" });
    expect(await previewAddress("C:\\a.html", () => Promise.reject("not an HTML document"))).toEqual({ error: "not an HTML document" });
  });
});

describe("T-241 a preview tab the app opens itself", () => {
  it("a full path to an HTML document is a preview, with either slash and a UNC or posix root", () => {
    expect(documentPathOf("C:\\w\\site\\index.html")).toBe("C:\\w\\site\\index.html");
    expect(documentPathOf("C:/w/site/a.htm")).toBe("C:/w/site/a.htm");
    expect(documentPathOf('"/home/u/a.html"')).toBe("/home/u/a.html");
  });
  it("a web address, a non-HTML file, a blank or nothing is not", () => {
    expect(documentPathOf("https://example.com/a.html")).toBeNull();
    expect(documentPathOf("C:\\w\\notes.md")).toBeNull();
    expect(documentPathOf("")).toBeNull();
    expect(documentPathOf(undefined)).toBeNull();
  });
});

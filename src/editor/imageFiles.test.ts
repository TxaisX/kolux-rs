import { describe, expect, it } from "vitest";
import { apart, centred, clampZoom, describe as describePicture, extFor, fitScale, freeName, isPicture, isSvg, localPicturePath, mimeOf, pastedName, pastedPicturePath, pictureRefs, pinchFactor, splitPath, startScale, wheelFactor, whyNotLoaded, zoomToward, ZOOM_MAX, ZOOM_MIN } from "./imageFiles";

// EDIT-029 / EDIT-009 (T-235-b, T-234-b): the rules behind the image viewer and local pictures in notes.
const NOTE = String.raw`C:\w\docs\a.md`;

describe("which files are pictures", () => {
  it("knows raster pictures, treats SVG as a picture and as text, and nothing else", () => {
    for (const f of ["a.PNG", "b.jpeg", "c.webp", "d.gif", "e.bmp", "f.ico", "g.avif", "C:\\x\\h.JPG"]) expect(isPicture(f)).toBe(true);
    expect(isPicture("a.svg")).toBe(false);
    expect(isSvg("a.SVG")).toBe(true);
    expect(mimeOf("a.svg")).toBe("image/svg+xml");
    expect(mimeOf("a.jpg")).toBe("image/jpeg");
    expect(mimeOf("a.txt")).toBe("");
    expect(isPicture("png")).toBe(false);
  });
});

describe("zoom", () => {
  it("opens a small picture at 100% and shrinks a big one to fit", () => {
    expect(startScale({ w: 100, h: 50 }, { w: 800, h: 600 })).toBe(1);
    expect(startScale({ w: 1600, h: 400 }, { w: 800, h: 600 })).toBe(0.5);
    expect(startScale({ w: 400, h: 1200 }, { w: 800, h: 600 })).toBe(0.5);
    expect(startScale({ w: 0, h: 0 }, { w: 800, h: 600 })).toBe(1);
    expect(startScale({ w: 100000, h: 10 }, { w: 800, h: 600 })).toBe(ZOOM_MIN);
  });

  it("fits the whole picture to the box, either way", () => {
    expect(fitScale({ w: 100, h: 50 }, { w: 400, h: 400 })).toBe(4);
    expect(fitScale({ w: 1000, h: 500 }, { w: 400, h: 400 })).toBe(0.4);
    expect(fitScale({ w: 0, h: 5 }, { w: 400, h: 400 })).toBe(1);
  });

  it("centres the picture in the box", () => {
    expect(centred({ w: 100, h: 50 }, { w: 300, h: 200 }, 1)).toEqual({ scale: 1, x: 100, y: 75 });
  });

  it("zooms toward the pointer so the point under it stays put", () => {
    const v = { scale: 1, x: 10, y: 20 };
    const next = zoomToward(v, 2, 110, 120);
    expect(next.scale).toBe(2);
    // the picture point under the pointer is (110-10, 120-20) = (100, 100) before and after
    expect((110 - next.x) / next.scale).toBeCloseTo(100);
    expect((120 - next.y) / next.scale).toBeCloseTo(100);
  });

  it("stops at the fixed limits and does not drift when it is already at one", () => {
    const top = zoomToward({ scale: ZOOM_MAX, x: 5, y: 6 }, 3, 50, 50);
    expect(top).toEqual({ scale: ZOOM_MAX, x: 5, y: 6 });
    const bottom = zoomToward({ scale: 1, x: 0, y: 0 }, 0.00001, 0, 0);
    expect(bottom.scale).toBe(ZOOM_MIN);
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(1000)).toBe(ZOOM_MAX);
  });

  it("turns a wheel step or pinch into a factor", () => {
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100)).toBeCloseTo(1 / wheelFactor(100));
    expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48, 0));
    expect(wheelFactor(1e9)).toBeGreaterThan(0.3); // one wild event cannot flip it
    expect(pinchFactor(100, 150)).toBe(1.5);
    expect(pinchFactor(0, 150)).toBe(1);
    expect(apart({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("why a picture would not load", () => {
  it("names the reason in plain words", () => {
    expect(whyNotLoaded("a.png is too large to load (40 MB; up to 32 MB)", "a.png")).toBe("a.png is too large to show (40 MB; up to 32 MB).");
    expect(whyNotLoaded("Kolux opens files only from your projects and their worktrees, or a file you picked: C:\\x is outside them", "a.png")).toContain("outside your projects");
    expect(whyNotLoaded("C:\\w\\a.png: The system cannot find the file specified. (os error 2)", "a.png")).toContain("not there any more");
    expect(whyNotLoaded("x: Access is denied. (os error 5)", "a.png")).toContain("access was denied");
    expect(whyNotLoaded("decode", "a.png")).toContain("not a picture this window understands");
    expect(whyNotLoaded("empty", "a.png")).toBe("a.png is empty.");
    expect(whyNotLoaded(new Error("boom"), "a.png")).toBe("a.png could not be loaded: boom");
  });

  it("describes a loaded picture", () => {
    expect(describePicture({ w: 640, h: 480 }, 12595)).toBe("640 x 480 px, 12.3 KB");
    expect(describePicture({ w: 1, h: 1 }, 3 * 1024 * 1024)).toBe("1 x 1 px, 3 MB");
  });
});

describe("where a note's picture lives", () => {
  it("resolves relative, parent, escaped and absolute addresses", () => {
    expect(localPicturePath("pic.png", NOTE)).toBe("C:/w/docs/pic.png");
    expect(localPicturePath("./img/my%20pic.png", NOTE)).toBe("C:/w/docs/img/my pic.png");
    expect(localPicturePath("../assets/x.JPG", NOTE)).toBe("C:/w/assets/x.JPG");
    expect(localPicturePath("img\\win.png", NOTE)).toBe("C:/w/docs/img/win.png");
    expect(localPicturePath("C:\\other\\p.gif", NOTE)).toBe("C:/other/p.gif");
    expect(localPicturePath("file:///C:/other/p.gif", NOTE)).toBe("C:/other/p.gif");
    expect(localPicturePath("pic.png?raw=1#top", NOTE)).toBe("C:/w/docs/pic.png");
    expect(localPicturePath("<a b.png>", NOTE)).toBe("C:/w/docs/a b.png");
    expect(localPicturePath("logo.svg", NOTE)).toBe("C:/w/docs/logo.svg");
  });

  it("leaves web, data, share, off-drive and non-picture addresses alone", () => {
    for (const s of ["https://x.com/a.png", "data:image/png;base64,AAAA", "blob:abc", "//server/share/a.png", "mailto:a@b.c", "a.txt", "#frag", "", "../../../../a.png", "/rooted.png"]) expect(localPicturePath(s, NOTE)).toBeNull();
    expect(localPicturePath("%E0%A4%A.png", NOTE)).toBe("C:/w/docs/%E0%A4%A.png"); // a broken escape stays as typed
  });

  it("finds the pictures a block of note text names", () => {
    expect(pictureRefs("a ![one](a.png) b ![](<my pic.png> \"t\") c ![w](x(1).png) [link](no.png)")).toEqual([
      { alt: "one", src: "a.png" },
      { alt: "", src: "my pic.png" },
      { alt: "w", src: "x(1).png" },
    ]);
    expect(pictureRefs("no pictures $x$")).toEqual([]);
    expect(pictureRefs("![empty]()")).toEqual([]);
  });
});

describe("saving a pasted picture", () => {
  it("picks the file ending from the media type", () => {
    expect(extFor("image/png")).toBe("png");
    expect(extFor("IMAGE/JPEG")).toBe("jpg");
    expect(extFor("image/svg+xml")).toBeNull();
    expect(extFor("text/plain")).toBeNull();
  });

  it("never reuses a name", () => {
    expect(freeName("a.png", () => false)).toBe("a.png");
    expect(freeName("a.png", (n) => n === "a.png")).toBe("a-2.png");
    expect(freeName("a.png", (n) => ["a.png", "a-2.png", "a-3.png"].includes(n))).toBe("a-4.png");
    expect(freeName("noext", (n) => n === "noext")).toBe("noext-2");
    expect(freeName("a.png", () => true)).toMatch(/^a-\d{5,}\.png$/);
  });

  it("names a paste by the clock", () => {
    expect(pastedName("png", new Date(2026, 9, 20, 7, 5, 9))).toBe("pasted-20261020-070509.png");
  });

  it("takes a Windows path copied from a terminal as a picture to insert", () => {
    expect(pastedPicturePath(String.raw`C:\Users\me\shots\a b.png`)).toBe(String.raw`C:\Users\me\shots\a b.png`);
    expect(pastedPicturePath(String.raw`"C:\Users\me\a.PNG"` + "\r\n")).toBe(String.raw`C:\Users\me\a.PNG`);
    expect(pastedPicturePath(String.raw`C:\Users\me\notes.txt`)).toBeNull();
    expect(pastedPicturePath("see C:\\a.png now")).toBeNull();
    expect(pastedPicturePath("C:\\a.png\nC:\\b.png")).toBeNull();
    expect(pastedPicturePath("https://x.com/a.png")).toBeNull();
    expect(pastedPicturePath("relative\\a.png")).toBeNull();
  });

  it("splits a path with either slash", () => {
    expect(splitPath(String.raw`C:\w\docs\a.md`)).toEqual({ dir: String.raw`C:\w\docs`, name: "a.md" });
    expect(splitPath("C:/w/a.md")).toEqual({ dir: "C:/w", name: "a.md" });
    expect(splitPath("a.md")).toEqual({ dir: "", name: "a.md" });
  });
});

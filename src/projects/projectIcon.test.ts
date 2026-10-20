import { describe, expect, it } from "vitest";
import { builtInIcon, emojiIcon, ICON_IMAGE_MAX, iconView, pictureIcon, pictureProblem } from "./projectIcon";

describe("PROJ-019 iconView", () => {
  it("reads the three kinds of chosen icon", () => {
    expect(iconView("emoji:\u{1F680}", "api")).toEqual({ kind: "emoji", emoji: "\u{1F680}" });
    expect(iconView("icon:rocket", "api")).toEqual({ kind: "icon", name: "rocket" });
    expect(iconView("image:data:image/png;base64,AAAA", "api")).toEqual({ kind: "image", src: "data:image/png;base64,AAAA" });
  });

  it("falls back to the automatic icon, the first letter, when nothing or something damaged is saved", () => {
    expect(iconView(undefined, "api")).toEqual({ kind: "auto", letter: "A" });
    expect(iconView("", "api")).toEqual({ kind: "auto", letter: "A" });
    expect(iconView("emoji:", "api")).toEqual({ kind: "auto", letter: "A" });
    expect(iconView("rocket", "api")).toEqual({ kind: "auto", letter: "A" });
    expect(iconView("image:https://example.com/a.png", "api")).toEqual({ kind: "auto", letter: "A" });
    expect(iconView("html:<b>", "api")).toEqual({ kind: "auto", letter: "A" });
    expect(iconView(undefined, "  ")).toEqual({ kind: "auto", letter: "?" });
    expect(iconView(undefined, "école")).toEqual({ kind: "auto", letter: "É" });
  });

  it("keeps an unknown built-in name so the drawing side can show a folder for it", () => {
    expect(iconView("icon:from-the-future", "api")).toEqual({ kind: "icon", name: "from-the-future" });
  });
});

describe("PROJ-019 picture icons", () => {
  it("accepts small pictures of the listed types and refuses the rest", () => {
    expect(pictureProblem("image/png", 2000)).toBeNull();
    expect(pictureProblem("image/svg+xml", 500)).toBeNull();
    expect(pictureProblem("image/bmp", 100)).toMatch(/PNG/);
    expect(pictureProblem("text/html", 100)).toMatch(/PNG/);
  });

  it("refuses a picture whose data URL would pass the limit", () => {
    const fits = Math.floor(((ICON_IMAGE_MAX - 40) * 3) / 4);
    expect(pictureProblem("image/png", fits)).toBeNull();
    expect(pictureProblem("image/png", fits + 8)).toMatch(/too large/);
  });

  it("builds the saved values", () => {
    expect(emojiIcon(" \u{1F680} ")).toBe("emoji:\u{1F680}");
    expect(builtInIcon("box")).toBe("icon:box");
    expect(pictureIcon("data:image/png;base64,AAAA")).toBe("image:data:image/png;base64,AAAA");
  });
});

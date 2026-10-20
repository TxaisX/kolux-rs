import { describe, expect, test } from "vitest";
import { autoIconView, iconView } from "./projectIcon";

const png = "data:image/png;base64,iVBORw0KGgo=";

describe("PROJ-018 the icon found in the repository", () => {
  test("a picture found in the repository becomes the project icon", () => {
    expect(iconView(undefined, "api", { kind: "image", src: png })).toEqual({ kind: "image", src: png });
  });

  test("an owner's avatar or a picture on the web is drawn from its https address", () => {
    expect(iconView(undefined, "api", { kind: "avatar", src: "https://github.com/octo.png" })).toEqual({ kind: "image", src: "https://github.com/octo.png" });
    expect(iconView(undefined, "api", { kind: "remote", src: "https://example.org/favicon.ico" })).toEqual({ kind: "image", src: "https://example.org/favicon.ico" });
  });

  test("a search that found nothing shows the folder symbol; a search not done yet shows the letter", () => {
    expect(iconView(undefined, "api", null)).toEqual({ kind: "icon", name: "folder" });
    expect(iconView(undefined, "api")).toEqual({ kind: "auto", letter: "A" });
    expect(iconView(undefined, "api", undefined)).toEqual({ kind: "auto", letter: "A" });
  });

  test("a icon chosen by hand beats the found one", () => {
    expect(iconView("icon:rocket", "api", { kind: "image", src: png })).toEqual({ kind: "icon", name: "rocket" });
    expect(iconView("emoji:\u{1F680}", "api", null)).toEqual({ kind: "emoji", emoji: "\u{1F680}" });
  });

  test("an address or data that is not plainly safe to draw is no icon", () => {
    for (const src of ["http://example.org/a.png", "javascript:alert(1)", "https://example.org/a b.png", "https://example.org/a\"onerror=x", "data:text/html;base64,AAAA", "https://x.org/\\evil"]) {
      expect(autoIconView({ kind: "remote", src })).toBeNull();
    }
    expect(autoIconView({ kind: "image", src: "https://example.org/a.png" })).toBeNull();
    expect(autoIconView({ kind: "image", src: "data:image/png;base64,AA AA" })).toBeNull();
    expect(autoIconView({ kind: "image", src: "data:image/html;base64,AAAA" })).toBeNull();
    expect(autoIconView({ kind: "image", src: "data:image/png;base64," + "A".repeat(70 * 1024) })).toBeNull();
    // a bad find falls back like no find at all
    expect(iconView(undefined, "api", { kind: "remote", src: "http://example.org/a.png" })).toEqual({ kind: "auto", letter: "A" });
    expect(autoIconView(undefined)).toBeNull();
  });
});

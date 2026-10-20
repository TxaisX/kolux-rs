import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectIcon } from "./IconView";
import { AUTO_ICON_FILE_MAX, autoIconView, ICON_IMAGE_MAX, iconView, pictureProblem } from "./projectIcon";

const png = "data:image/png;base64,iVBORw0KGgo=";

describe("PROJ-018 the icon found in the repository", () => {
  test("a picture found in the repository becomes the project icon", () => {
    expect(iconView(undefined, "api", { kind: "image", src: png })).toEqual({ kind: "image", src: png });
  });

  test("the owner's avatar is drawn from the hosting site's own avatar addresses, and only those", () => {
    expect(iconView(undefined, "api", { kind: "avatar", src: "https://github.com/octo.png" })).toEqual({ kind: "image", src: "https://github.com/octo.png" });
    expect(iconView(undefined, "api", { kind: "avatar", src: "https://avatars.githubusercontent.com/u/1?v=4" })).toEqual({ kind: "image", src: "https://avatars.githubusercontent.com/u/1?v=4" });
  });

  test("no other web address is ever drawn, so nothing a repository names is requested (FIX-4)", () => {
    const stray = ["https://example.org/favicon.ico", "https://tracker.example/pixel.png", "https://github.com.evil.example/octo.png", "https://evil.example/https://github.com/octo.png", "https://192.168.1.1/a.png", "https://localhost:8080/a.png", "https://user@github.com/octo.png", "https://github.com:8443/octo.png"];
    for (const src of stray) {
      expect(autoIconView({ kind: "avatar", src }), `avatar ${src}`).toBeNull();
      expect(autoIconView({ kind: "remote" as unknown as "avatar", src }), `remote ${src}`).toBeNull();
      expect(iconView(undefined, "api", { kind: "avatar", src })).toEqual({ kind: "auto", letter: "A" });
    }
    // even an allowed address is refused as a "remote" find: Rust no longer sends that kind
    expect(autoIconView({ kind: "remote" as unknown as "avatar", src: "https://github.com/octo.png" })).toBeNull();
  });

  test("a web picture is asked for without a Referer, and a refused address makes no <img> at all", () => {
    const html = (src: string) => renderToStaticMarkup(createElement(ProjectIcon, { value: undefined, name: "api", auto: { kind: "avatar", src } }));
    expect(html("https://github.com/octo.png")).toMatch(/<img[^>]*referrerPolicy="no-referrer"/i);
    expect(html("https://tracker.example/pixel.png")).not.toContain("<img");
    expect(html("https://tracker.example/pixel.png")).not.toContain("tracker.example");
  });

  test("AUTO_ICON_FILE_MAX is the biggest file whose data URL still fits ICON_IMAGE_MAX (same figure as projects.rs)", () => {
    expect(AUTO_ICON_FILE_MAX).toBe(49_122);
    const body = (bytes: number) => "A".repeat(Math.ceil(bytes / 3) * 4);
    const edge = `data:image/svg+xml;base64,${body(AUTO_ICON_FILE_MAX)}`;
    expect(edge.length).toBeLessThanOrEqual(ICON_IMAGE_MAX);
    expect(autoIconView({ kind: "image", src: edge })).toEqual({ kind: "image", src: edge });
    // the same budget the picker uses: base64 text plus 40 characters of header
    expect(pictureProblem("image/png", AUTO_ICON_FILE_MAX)).toBeNull();
    expect(pictureProblem("image/png", AUTO_ICON_FILE_MAX + 3)).toMatch(/too large/);
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
      expect(autoIconView({ kind: "avatar", src })).toBeNull();
    }
    expect(autoIconView({ kind: "image", src: "https://example.org/a.png" })).toBeNull();
    expect(autoIconView({ kind: "image", src: "data:image/png;base64,AA AA" })).toBeNull();
    expect(autoIconView({ kind: "image", src: "data:image/html;base64,AAAA" })).toBeNull();
    expect(autoIconView({ kind: "image", src: "data:image/png;base64," + "A".repeat(70 * 1024) })).toBeNull();
    // a bad find falls back like no find at all
    expect(iconView(undefined, "api", { kind: "avatar", src: "http://example.org/a.png" })).toEqual({ kind: "auto", letter: "A" });
    expect(autoIconView(undefined)).toBeNull();
  });
});

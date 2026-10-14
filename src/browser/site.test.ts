import { describe, expect, it } from "vitest";
import { iconAt, iconFound } from "./site";

describe("BROW-023 site icon", () => {
  const gh = { site: "https://github.com", src: "data:image/png;base64,AA==" };

  it("stays within one site and goes when the site changes", () => {
    expect(iconAt(gh, "https://github.com/a/b?x=1")).toBe(gh);
    expect(iconAt(gh, "https://example.com/")).toBeNull();
    expect(iconAt(gh, "about:blank")).toBeNull();
  });

  it("takes an icon for the current site and ignores a late one for an old site", () => {
    expect(iconFound(null, "https://github.com/x", "https://github.com/", gh.src)).toEqual(gh);
    expect(iconFound(null, "https://example.com/", "https://github.com/", gh.src)).toBeNull();
    const other = { site: "https://github.com", src: "data:image/png;base64,AQ==" };
    expect(iconFound(gh, "https://github.com/y", "https://github.com/y", other.src)).toEqual(other);
  });
});

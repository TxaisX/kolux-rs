import { describe, expect, it } from "vitest";
import { matches, sizeText, viewerUrl } from "./ArtifactsPage";

describe("Artifacts library (SKILL-036)", () => {
  it("matches titles holding every typed word, in any case and order", () => {
    expect(matches("Quarterly Sales Report", "sales quarterly")).toBe(true);
    expect(matches("Quarterly Sales Report", "SALES")).toBe(true);
    expect(matches("Quarterly Sales Report", "sales chart")).toBe(false);
    expect(matches("Anything", "   ")).toBe(true);
  });

  it("writes sizes as B, KB or MB with one decimal", () => {
    expect(sizeText(512)).toBe("512 B");
    expect(sizeText(1536)).toBe("1.5 KB");
    expect(sizeText(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("points the viewer at the entry's stored page on the app's scheme", () => {
    expect(viewerUrl({ id: "ab12", page: "my page.html" }, true)).toBe("http://kolux-artifact.localhost/ab12/my%20page.html");
    expect(viewerUrl({ id: "ab12", page: "sub/index.html" }, false)).toBe("kolux-artifact://localhost/ab12/sub/index.html");
  });
});

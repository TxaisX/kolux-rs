import { beforeEach, describe, expect, it } from "vitest";
import { dropPage, livePage, livePages } from "./pages";
import { forgetPrinted, isLocalWeb, notePrinted, previewHint, previewTitle, printedFor, sameOriginPage, type Candidate } from "./preview";

const DIR = "G:\\Dev\\app";

describe("BROW-067 preview a workspace's running dev server", () => {
  beforeEach(() => {
    forgetPrinted(DIR);
    for (const id of [1, 2, 3]) dropPage(id);
  });

  it("remembers the local web addresses a workspace's terminals print, per folder, newest last", () => {
    notePrinted(DIR, "  VITE v5  ready\n  -> Local:   http://localhost:5173/\n  -> Network: http://192.168.1.4:5173/\n");
    notePrinted(DIR, new TextEncoder().encode("Server listening on http://0.0.0.0:3000 (see https://docs.example.com)"));
    notePrinted("G:/dev/other", "http://localhost:9999/");
    notePrinted(null, "http://localhost:1/");
    notePrinted(DIR, "plain text, no address");
    expect(printedFor("g:/dev/app/")).toEqual(["http://localhost:5173/", "http://0.0.0.0:3000"]);
    // A reprinted address moves to the end instead of repeating.
    notePrinted(DIR, "http://localhost:5173/");
    expect(printedFor(DIR)).toEqual(["http://0.0.0.0:3000", "http://localhost:5173/"]);
    expect(printedFor(null)).toEqual([]);
    expect(isLocalWeb("http://[::1]:4000/")).toBe(true);
    expect(isLocalWeb("http://app.localhost/")).toBe(true);
    expect(isLocalWeb("postgres://localhost:5432")).toBe(false);
    expect(isLocalWeb("http://example.com")).toBe(false);
  });

  it("names the tab Preview host:port and finds a page already showing the same origin in the workspace", () => {
    expect(previewTitle("http://localhost:5173/app?x=1")).toBe("Preview localhost:5173");
    livePage(1, { url: "http://localhost:5173/about", cwd: "g:/dev/app" });
    livePage(2, { url: "http://localhost:5173/", cwd: "G:\\Dev\\other" });
    livePage(3, { url: "http://localhost:3000/", cwd: DIR });
    const live = livePages();
    // Same origin in the same workspace: the page in another workspace does not count.
    expect(sameOriginPage("http://localhost:5173/x", DIR, live)).toBe(1);
    expect(sameOriginPage("http://localhost:5173/x", "G:/elsewhere", live)).toBe(null);
    expect(sameOriginPage("http://localhost:8080/", DIR, live)).toBe(null);
    expect(sameOriginPage("not a url", DIR, live)).toBe(null);
  });

  it("explains the greyed button and names the server it would open", () => {
    const c = (port: number): Candidate => ({ host: "localhost", port, url: `http://localhost:${port}/`, printed: true, web: true });
    expect(previewHint([])).toContain("no dev server found");
    expect(previewHint([c(5173)])).toBe("Preview localhost:5173 in a browser tab");
    expect(previewHint([c(5173), c(3000)])).toContain("2 servers");
  });
});

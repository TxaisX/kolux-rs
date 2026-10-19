import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import PortsItem from "./PortsItem";
import { applyScan, countOf, folderName, openTarget, sections, type PortRow } from "./rows";
import { openUrl, printedUrls, stripAnsi, UrlBook } from "./urls";

const row = (port: number, o: Partial<PortRow> = {}): PortRow => ({ port, address: "127.0.0.1", pid: port, name: "node.exe", worktree: "C:\\work\\app", external: false, ...o });

test("VIEW-078: the address a dev server printed is picked out of coloured terminal output", () => {
  const vite = "\u001b[32m  ➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m\r\n";
  expect(printedUrls(vite)).toEqual([{ port: 5173, url: "http://localhost:5173/" }]);
  expect(stripAnsi("\u001b]8;;http://x.test:1\u0007link\u001b]8;;\u0007")).toBe("link");
  expect(stripAnsi("a\u001b]0;title\u001b\\b")).toBe("ab");
});

test("VIEW-078: a listen-everywhere address is opened on localhost and sentence punctuation is left off", () => {
  expect(printedUrls("Listening on http://0.0.0.0:3000.")).toEqual([{ port: 3000, url: "http://localhost:3000" }]);
  expect(printedUrls("see (https://127.0.0.1:8443/app?x=1).")).toEqual([{ port: 8443, url: "https://127.0.0.1:8443/app?x=1" }]);
  expect(printedUrls("at http://[::1]:4000/ now")).toEqual([{ port: 4000, url: "http://[::1]:4000/" }]);
  expect(printedUrls("docs at https://example.com/guide")).toEqual([{ port: 443, url: "https://example.com/guide" }]);
  expect(printedUrls("port too big http://localhost:99999/")).toEqual([]);
});

test("VIEW-078: Open uses the printed address, and without one plain http on the listening address", () => {
  expect(openUrl(5173, "127.0.0.1", "http://localhost:5173/")).toBe("http://localhost:5173/");
  expect(openUrl(5173, "127.0.0.1")).toBe("http://127.0.0.1:5173");
  expect(openUrl(5173, "0.0.0.0")).toBe("http://localhost:5173");
  expect(openUrl(5173, "::")).toBe("http://localhost:5173");
  expect(openUrl(5173, "::1")).toBe("http://[::1]:5173");
});

test("VIEW-078: an address cut by the edge of an output chunk is joined, and one terminal's tail never leaks into another", () => {
  const book = new UrlBook();
  book.feed(1, "  Local: http://localhost:51");
  book.feed(2, "73/ is somebody else\n");
  book.feed(1, "73/\n");
  expect(book.get(5173)).toBe("http://localhost:5173/");
  expect(book.get(51)).toBe("http://localhost:51");
  // the cut-off guess for port 51 is dropped as soon as the scan shows nothing listens there
  book.keepOnly([5173]);
  expect(book.get(51)).toBeUndefined();
  expect(book.get(5173)).toBe("http://localhost:5173/");
});

test("VIEW-078: when a port stops listening its printed address is forgotten, so a later program on it is not handed a stale one", () => {
  const book = new UrlBook();
  book.feed(1, "http://localhost:5173/\n");
  book.keepOnly([]);
  expect(book.get(5173)).toBeUndefined();
  expect(openUrl(5173, "127.0.0.1", book.get(5173))).toBe("http://127.0.0.1:5173");
});

test("VIEW-078: the workspace's ports come first and an external one is listed apart", () => {
  const rows = [row(3000), row(5173), row(8080, { external: true, worktree: null }), row(4000, { worktree: "C:\\work\\other" })];
  const { mine, external } = sections(rows);
  expect(mine.map((r) => r.port)).toEqual([3000, 5173, 4000]);
  expect(external.map((r) => r.port)).toEqual([8080]);
  expect(sections(rows, "c:/work/app/").mine.map((r) => r.port), "only the named workspace's ports are its own").toEqual([3000, 5173]);
  expect(countOf(rows)).toBe(3);
  expect(folderName("C:\\work\\app\\")).toBe("app");
});

test("VIEW-078: a failed scan names the problem and keeps the last good list; the next good scan clears it", () => {
  const good = applyScan({ rows: [], problem: null }, { rows: [row(5173)] });
  expect(good).toEqual({ rows: [row(5173)], problem: null });
  const failed = applyScan(good, { error: "The system's port table could not be read (error 5)" });
  expect(failed.rows).toEqual([row(5173)]);
  expect(failed.problem).toContain("could not be read");
  expect(applyScan(failed, { rows: [] })).toEqual({ rows: [], problem: null });
});

test("VIEW-078: Open goes to the Kolux browser; Shift with the link modifier goes to the system browser", () => {
  const e = (o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({ ctrlKey: false, metaKey: false, shiftKey: false, ...o });
  expect(openTarget(e({}), false)).toBe("kolux");
  expect(openTarget(e({ ctrlKey: true }), false)).toBe("kolux");
  expect(openTarget(e({ shiftKey: true }), false), "Shift alone is not the chord").toBe("kolux");
  expect(openTarget(e({ ctrlKey: true, shiftKey: true }), false)).toBe("system");
  expect(openTarget(e({ metaKey: true, shiftKey: true }), true)).toBe("system");
  expect(openTarget(e({ ctrlKey: true, shiftKey: true }), true), "on a Mac Ctrl is not the modifier").toBe("kolux");
});

test("VIEW-078: the ports item is drawn in the status bar with a count of zero before any scan", () => {
  const html = renderToString(createElement(PortsItem, { workspaces: ["C:\\work\\app"] }));
  expect(html).toContain("ports-item");
  expect(html).toContain("Ports your workspaces are listening on");
  expect(html).not.toContain("ports-menu");
});

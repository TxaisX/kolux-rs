import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import PortsItem from "./PortsItem";
import { applyScan, countOf, folderName, openTarget, sections, stopRequest, type PortRow } from "./rows";
import { openUrl, printedUrls, stripAnsi, UrlBook } from "./urls";
import { ChunkDecoder } from "./usePorts";

const row = (port: number, o: Partial<PortRow> = {}): PortRow => ({ port, address: "127.0.0.1", pid: port, name: "node.exe", worktree: "C:\\work\\app", external: false, started: "7", terminal: 1, ...o });
/** What a scan reports for one holder: `terminal` is the pane that started it (null: none). */
const live = (port: number, pid: number, terminal: number | null = 1) => ({ port, pid, terminal });

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
  book.sync([live(5173, 10)]);
  expect(book.get(51)).toBeUndefined();
  expect(book.get(5173)).toBe("http://localhost:5173/");
});

test("VIEW-078: when a port stops listening its printed address is forgotten, so a later program on it is not handed a stale one", () => {
  const book = new UrlBook();
  book.feed(1, "http://localhost:5173/\n");
  book.sync([]);
  expect(book.get(5173)).toBeUndefined();
  expect(openUrl(5173, "127.0.0.1", book.get(5173))).toBe("http://127.0.0.1:5173");
});

test("VIEW-078 (FIX-1): a printed address belongs to the program first seen on its port and to the terminal that printed it", () => {
  const book = new UrlBook();
  book.feed(1, "  Local: http://localhost:5173/\n");
  book.sync([live(5173, 10)]);
  book.sync([live(5173, 10)]);
  expect(book.get(5173), "the same program keeps its address across scans").toBe("http://localhost:5173/");
  book.sync([live(5173, 11)]);
  expect(book.get(5173), "another program on the port does not inherit the address").toBeUndefined();
  // a terminal's addresses go with it when it ends
  book.feed(3, "http://localhost:4000/\n");
  book.feed(4, "http://localhost:4100/\n");
  book.forget(3);
  expect(book.get(4000)).toBeUndefined();
  expect(book.get(4100)).toBe("http://localhost:4100/");
});

test("VIEW-078 (FIX-2): a printed address binds only to a program under the terminal that printed it", () => {
  const book = new UrlBook();
  // terminal 1 prints :3000 (a log line, a README, a server that then fails to bind) while terminal 2's
  // server holds 3000: terminal 2's row gets no address from terminal 1
  book.feed(1, "  Local: http://localhost:3000/\n");
  book.sync([live(3000, 20, 2)]);
  expect(book.get(3000), "another terminal's program never inherits the address").toBeUndefined();
  // a holder no pane started (started outside Kolux) does not get it either
  book.feed(1, "  Local: http://localhost:3000/\n");
  book.sync([live(3000, 20, null)]);
  expect(book.get(3000)).toBeUndefined();
  // the printing terminal's own program on the port: bound, and kept across scans
  book.feed(1, "  Local: http://localhost:3000/\n");
  book.sync([live(3000, 21, 1)]);
  book.sync([live(3000, 21, 1)]);
  expect(book.get(3000)).toBe("http://localhost:3000/");
  // two programs on the port (IPv4 and IPv6 sockets of two servers): the one under the terminal is the owner
  book.feed(4, "http://localhost:4000/\n");
  book.sync([live(4000, 30, 2), live(4000, 31, 4)]);
  expect(book.get(4000), "the second holder on the list is still found").toBe("http://localhost:4000/");
  book.sync([live(4000, 30, 2)]);
  expect(book.get(4000), "its program left; the other holder does not inherit the address").toBeUndefined();
});

test("VIEW-078 (FIX-1): terminal output is decoded as a stream per terminal, so a non-ASCII address split across chunks keeps its letters", () => {
  const d = new ChunkDecoder();
  const bytes = new TextEncoder().encode("http://localhost:3000/café");
  const cut = bytes.length - 1; // inside the two-byte é
  const text = d.decode(7, bytes.slice(0, cut)) + d.decode(7, bytes.slice(cut));
  expect(text).toBe("http://localhost:3000/café");
  // another terminal's split does not mix in
  expect(d.decode(8, bytes.slice(0, cut)) + d.decode(7, new TextEncoder().encode("\n"))).toBe("http://localhost:3000/caf\n");
  d.forget(8);
  expect(d.decode(8, bytes.slice(cut)), "a forgotten terminal starts a fresh decoder: a lone continuation byte is the replacement character").toBe("�");
});

test("VIEW-078: the workspace's ports come first and an external one is listed apart", () => {
  const rows = [row(3000), row(5173), row(8080, { external: true, worktree: null }), row(4000, { worktree: "C:\\work\\other" })];
  const { mine, external } = sections(rows);
  expect(mine.map((r) => r.port)).toEqual([3000, 5173, 4000]);
  expect(external.map((r) => r.port)).toEqual([8080]);
  expect(countOf(rows)).toBe(3);
  expect(folderName("C:\\work\\app\\")).toBe("app");
});

test("VIEW-078 (FIX-1): with an active workspace, other workspaces' ports are listed as external, never dropped, and never get a Stop", () => {
  const rows = [row(3000), row(5173), row(8080, { external: true, worktree: null }), row(4000, { worktree: "C:\\work\\other" })];
  const { mine, external } = sections(rows, "c:/work/app/");
  expect(mine.map((r) => r.port), "only the active workspace's ports are its own").toEqual([3000, 5173]);
  expect(external.map((r) => r.port), "the other workspace's port is still shown, as external").toEqual([8080, 4000]);
  expect(countOf(rows, "c:/work/app/")).toBe(2);
  expect(sections(rows, "C:\\nowhere").mine).toEqual([]);
  expect(sections(rows, "C:\\nowhere").external.map((r) => r.port)).toEqual([3000, 5173, 8080, 4000]);
});

test("VIEW-078 (FIX-1, FIX-2): Stop names the program the user saw, with its start time, and is licensed by the active workspace alone", () => {
  expect(stopRequest(row(5173, { pid: 42, started: "133000000000000000" }), "C:\\work\\app")).toEqual({ worktrees: ["C:\\work\\app"], port: 5173, pid: 42, started: "133000000000000000" });
  expect(stopRequest(row(5173, { pid: 42 }), "C:\\work\\app")).not.toHaveProperty("worktrees", expect.arrayContaining(["C:\\work\\other"]));
  // the start time travels as the text the scan gave, never through a JS number (the system's tick count is past 2^53)
  expect(stopRequest(row(5173, { pid: 42, started: "133000000000000001" }), "C:\\work\\app").started).toBe("133000000000000001");
  expect(stopRequest(row(5173, { pid: 42, started: null }), "C:\\work\\app").started, "a row with no start time sends none, and the Rust side refuses").toBeNull();
  // without an active workspace the row's own folder is the licence; an external row licenses nothing
  expect(stopRequest(row(3000, { pid: 7, worktree: "C:\\work\\other" }))).toEqual({ worktrees: ["C:\\work\\other"], port: 3000, pid: 7, started: "7" });
  expect(stopRequest(row(8080, { pid: 9, external: true, worktree: null }))).toEqual({ worktrees: [], port: 8080, pid: 9, started: "7" });
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

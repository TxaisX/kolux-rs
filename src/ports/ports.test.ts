import { expect, test } from "vitest";
import { PrintedUrls, afterScan, decodeOutput, openAddress, openWhere, ownCount, urlsIn, type PortRow } from "./ports";

const row = (port: number, addr = "127.0.0.1", external = false): PortRow => ({ port, addr, pid: 1, external });

test("VIEW-078 an address in coloured dev server output is found without its colour codes", () => {
  const out = "  \u001b[32m\u001b[1mLocal\u001b[22m:\u001b[39m   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m";
  expect(urlsIn(out)).toEqual([[5173, "http://localhost:5173/"]]);
});

test("VIEW-078 a printed address counts only while a process listens on its port", () => {
  const p = new PrintedUrls();
  p.record("ready on http://localhost:3000\n");
  expect(p.forPort(3000, [row(3000)])).toBe("http://localhost:3000");
  expect(p.forPort(3000, [row(4000)])).toBeNull();
  p.record("now http://127.0.0.1:3000/app");
  expect(p.forPort(3000, [row(3000)])).toBe("http://127.0.0.1:3000/app");
});

test("VIEW-078 Open uses the printed address, else plain http on the listening address", () => {
  expect(openAddress(row(5173), "http://localhost:5173/")).toBe("http://localhost:5173/");
  expect(openAddress(row(8080, "0.0.0.0"), null)).toBe("http://localhost:8080");
  expect(openAddress(row(8080, "::"), null)).toBe("http://localhost:8080");
  expect(openAddress(row(8080, "::1"), null)).toBe("http://[::1]:8080");
  expect(openAddress(row(8080, "192.168.1.5"), null)).toBe("http://192.168.1.5:8080");
});

test("VIEW-078 only Shift with Ctrl sends Open to the system browser", () => {
  expect(openWhere({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe("kolux");
  expect(openWhere({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe("kolux");
  expect(openWhere({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe("kolux");
  expect(openWhere({ shiftKey: true, ctrlKey: true, metaKey: false })).toBe("system");
  expect(openWhere({ shiftKey: true, ctrlKey: false, metaKey: true })).toBe("system");
});

test("VIEW-078 a failed scan names the problem and keeps the last good list", () => {
  const good = afterScan({ rows: [], error: null }, { rows: [row(5173)] });
  const bad = afterScan(good, { error: "The port scan failed: netstat did not finish" });
  expect(bad.rows).toEqual(good.rows);
  expect(bad.error).toContain("netstat");
  expect(afterScan(bad, { rows: [] })).toEqual({ rows: [], error: null });
});

test("VIEW-078 the item counts only the workspace's own ports", () => {
  expect(ownCount([row(1), row(2, "0.0.0.0", true), row(3)])).toBe(2);
});

test("VIEW-078 terminal output decodes from base64 and a bad payload is empty text", () => {
  expect(decodeOutput(btoa("http://localhost:1234"))).toBe("http://localhost:1234");
  expect(decodeOutput("%%%")).toBe("");
});

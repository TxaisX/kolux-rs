import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Pick } from "./annotate";
import { detailRows, detailsText, grabMessage } from "./grab";
import { copyDetails, grabElement, leavesGrab, sendGrab } from "./grabFlow";
import { GrabSheet } from "./GrabSheet";

const pick: Pick = { selector: "#buy", path: "main > button#buy", tag: "button", text: "Buy now", box: { x: 100, y: 200, width: 80, height: 30 } };
const shot = { data: "AAAA", cssWidth: 1280, cssHeight: 720 };
const CROPPED = "data:image/png;base64,CROP";

/** A fake back end: records every call, answers the capture, lets a test make one command fail. */
function backend(fail?: string) {
  const calls: [string, unknown][] = [];
  const invoke = (async (cmd: string, args?: unknown) => {
    calls.push([cmd, args]);
    if (cmd === fail) throw new Error(`${cmd} failed`);
    if (cmd === "browser_capture") return shot;
    if (cmd === "browser_save_picture") return "C:/captures/element.png";
    return undefined;
  }) as never;
  return { calls, invoke };
}

describe("T-240 BROW-035 grab mode: pick, picture, sheet", () => {
  it("stops the picker, then takes the page's picture, then cuts the element out of it", async () => {
    const b = backend();
    const cut = vi.fn(async () => CROPPED);
    const g = await grabElement(b.invoke, 7, pick, cut);
    expect(b.calls).toEqual([
      ["browser_annotate", { id: 7, what: "stop" }],
      ["browser_capture", { id: 7 }],
    ]);
    expect(cut).toHaveBeenCalledWith(shot, pick.box);
    expect(g).toEqual({ pick, rows: detailRows(pick), picture: CROPPED, problem: null });
  });

  it("still opens the sheet with the details when the page gives no picture, the element is off screen or has no size", async () => {
    const gone = await grabElement(backend("browser_capture").invoke, 7, pick, async () => CROPPED);
    expect(gone.picture).toBeNull();
    expect(gone.problem).toMatch(/browser_capture failed/);
    expect(gone.rows.length).toBeGreaterThan(0);
    const off = await grabElement(backend().invoke, 7, pick, async () => null);
    expect(off).toMatchObject({ picture: null, problem: expect.stringMatching(/outside the visible page/) });
    const sizeless = await grabElement(backend().invoke, 7, { ...pick, box: undefined }, async () => CROPPED);
    expect(sizeless).toMatchObject({ picture: null, problem: expect.stringMatching(/no size/) });
  });

  it("the sheet shows the rows, Copy details, Send to agent and Close", async () => {
    const g = await grabElement(backend().invoke, 7, pick, async () => CROPPED);
    const html = renderToStaticMarkup(createElement(GrabSheet, { grab: g, title: "Shop", url: "https://shop.test/", onClose: () => {} }));
    for (const r of detailRows(pick)) {
      expect(html).toContain(`<dt>${r.label}</dt>`);
      expect(html).toContain(r.value.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    }
    expect(html).toContain("Copy details");
    expect(html).toContain("Send to agent");
    expect(html).toContain('data-go="close"');
    expect(html).toContain(`src="${CROPPED}"`);
  });

  it("Copy details writes the details text to the clipboard, and says so when the clipboard refuses", async () => {
    const write = vi.fn(async () => {});
    expect(await copyDetails(write, pick)).toBe("Details copied");
    expect(write).toHaveBeenCalledWith(detailsText(pick));
    expect(await copyDetails(async () => Promise.reject(new Error("no")), pick)).toMatch(/refused/);
  });

  it("Send to agent saves the cropped picture and sends the grab message with its path", async () => {
    const b = backend();
    const onSend = vi.fn();
    const g = await grabElement(b.invoke, 7, pick, async () => CROPPED);
    b.calls.length = 0;
    const done = await sendGrab(b.invoke, onSend, 3, g, "Shop", "https://shop.test/");
    expect(b.calls).toEqual([["browser_save_picture", { data: CROPPED, name: "Shop element" }]]);
    expect(onSend).toHaveBeenCalledWith(3, grabMessage(pick, "Shop", "https://shop.test/", "C:/captures/element.png"));
    expect(done).toBe("Element sent (#buy)");
  });

  it("sends the details alone when there is no picture, and sends nothing after a failed save", async () => {
    const onSend = vi.fn();
    const plain = { pick, rows: detailRows(pick), picture: null, problem: "x" };
    await sendGrab(backend().invoke, onSend, 3, plain, "Shop", "https://shop.test/");
    expect(onSend).toHaveBeenCalledWith(3, grabMessage(pick, "Shop", "https://shop.test/", null));
    const sent = vi.fn();
    await expect(sendGrab(backend("browser_save_picture").invoke, sent, 3, { ...plain, picture: CROPPED }, "Shop", "u")).rejects.toThrow(/failed/);
    expect(sent).not.toHaveBeenCalled();
    await expect(sendGrab(backend().invoke, undefined, 3, plain, "Shop", "u")).rejects.toThrow(/No agent sessions/);
  });

  it("Esc leaves grab mode and no other key does", () => {
    expect(leavesGrab("Escape")).toBe(true);
    expect(leavesGrab("Enter")).toBe(false);
    expect(leavesGrab("c")).toBe(false);
  });
});

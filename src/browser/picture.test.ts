import { describe, expect, it } from "vitest";
import { asDataUrl, capturePage, readPicture, sendPicture } from "./picture";

const good = { data: "AAAA", cssWidth: 1280, cssHeight: 720 };

describe("BROW-038 / BROW-035 the page picture", () => {
  it("reads the back end's answer and refuses anything short of a picture with a size", () => {
    expect(readPicture(good)).toEqual(good);
    expect(readPicture({ ...good, data: "" })).toBeNull();
    expect(readPicture({ ...good, cssWidth: 0 })).toBeNull();
    expect(readPicture({ ...good, cssHeight: "720" })).toBeNull();
    expect(readPicture(null)).toBeNull();
    expect(asDataUrl(good)).toBe("data:image/png;base64,AAAA");
  });

  it("captures through browser_capture for the tab, and says so when the page gives nothing", async () => {
    const seen: unknown[] = [];
    const ok = (async (cmd: string, args?: unknown) => (seen.push([cmd, args]), good)) as never;
    expect(await capturePage(ok, 7)).toEqual(good);
    expect(seen).toEqual([["browser_capture", { id: 7 }]]);
    await expect(capturePage((async () => ({})) as never, 7)).rejects.toThrow("The page gave no picture");
  });

  it("send saves the picture first, then hands the agent text naming the saved path", async () => {
    const order: string[] = [];
    const invoke = (async (cmd: string, args: { data: string; name: string }) => (order.push(`${cmd}:${args.name}:${args.data}`), "C:/caps/shop-1.png")) as never;
    const sent: [number, string][] = [];
    const onSend = async (k: number, t: string) => {
      order.push("send");
      sent.push([k, t]);
    };
    const path = await sendPicture(invoke, onSend, 5, { dataUrl: "data:image/png;base64,AAAA", name: "shop", text: (p) => `file ${p}` });
    expect(path).toBe("C:/caps/shop-1.png");
    expect(order).toEqual(["browser_save_picture:shop:data:image/png;base64,AAAA", "send"]);
    expect(sent).toEqual([[5, "file C:/caps/shop-1.png"]]);
  });

  it("a failed save sends nothing, and no agent to send to is said before anything is saved", async () => {
    const sent: string[] = [];
    const onSend = (_k: number, t: string) => void sent.push(t);
    const broken = (async () => {
      throw new Error("disk full");
    }) as never;
    await expect(sendPicture(broken, onSend, 1, { dataUrl: "d", name: "n", text: () => "t" })).rejects.toThrow("disk full");
    expect(sent).toEqual([]);
    let saved = 0;
    const counting = (async () => void saved++) as never;
    await expect(sendPicture(counting, undefined, 1, { dataUrl: "d", name: "n", text: () => "t" })).rejects.toThrow("No agent sessions");
    expect(saved).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import { insertError, insertPasted, insertPastedPicture, insertPicked, pastedPicture, pictureUrl, pictureWhy, readPicture, showLocalPictures, writePicture, type Call, type Imgs } from "./pictureBytes";

// EDIT-009 / EDIT-029 (T-234-b, T-235-b): pictures in files. The Tauri side is a fake that records its calls.
const NOTE = String.raw`C:\w\docs\a.md`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function fake(files: Record<string, Uint8Array> = {}, dir: string[] = []) {
  const calls: { cmd: string; args: unknown; headers?: Record<string, string> }[] = [];
  const call = (async (cmd: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
    calls.push({ cmd, args, headers: options?.headers });
    if (cmd === "file_bytes") {
      const p = (args as { path: string }).path;
      if (!(p in files)) throw new Error(`${p}: The system cannot find the file specified. (os error 2)`);
      return files[p].buffer.slice(files[p].byteOffset, files[p].byteOffset + files[p].byteLength);
    }
    if (cmd === "dir_list") return dir.map((name) => ({ name }));
    if (cmd === "file_write_picture") return undefined;
    throw new Error(`unexpected ${cmd}`);
  }) as Call;
  return { call, calls };
}

describe("reading a picture", () => {
  it("returns the bytes and a blob address of the right type", async () => {
    const { call } = fake({ "C:/w/p.png": PNG });
    expect([...(await readPicture("C:/w/p.png", call))]).toEqual([...PNG]);
    let seen: Blob | null = null;
    const url = await pictureUrl("C:/w/p.png", call, (b) => ((seen = b), "blob:x"));
    expect(url).toBe("blob:x");
    expect((seen as unknown as Blob).type).toBe("image/png");
    expect((seen as unknown as Blob).size).toBe(PNG.length);
  });

  it("rejects an empty file and passes the app's refusal through", async () => {
    await expect(readPicture("C:/w/e.png", fake({ "C:/w/e.png": new Uint8Array() }).call)).rejects.toThrow("empty");
    await expect(readPicture("C:/w/none.png", fake().call)).rejects.toThrow("os error 2");
  });
});

describe("saving a picture", () => {
  it("sends the bytes as the body and the path, escaped, in the header", async () => {
    const { call, calls } = fake();
    await writePicture("C:\\w\\docs\\my pic.png", PNG, call);
    expect(calls[0].cmd).toBe("file_write_picture");
    expect(calls[0].args).toBe(PNG);
    expect(calls[0].headers).toEqual({ "x-file-path": "C%3A%5Cw%5Cdocs%5Cmy%20pic.png" });
  });
});

describe("inserting a picked picture", () => {
  it("links one already in the note's folder without copying it", async () => {
    const { call, calls } = fake();
    expect(await insertPicked(NOTE, String.raw`C:\w\docs\img\a b.png`, call)).toBe("![a b](img/a%20b.png)");
    expect(calls).toEqual([]);
  });

  it("copies one from elsewhere beside the note and links it relatively, names with spaces included", async () => {
    const { call, calls } = fake({ [String.raw`C:\pics\my shot.png`]: PNG }, ["a.md", "my shot.png"]);
    const md = await insertPicked(NOTE, String.raw`C:\pics\my shot.png`, call);
    expect(md).toBe("![my shot-2](my%20shot-2.png)");
    const write = calls.find((c) => c.cmd === "file_write_picture");
    expect(write?.headers?.["x-file-path"]).toBe(encodeURIComponent(String.raw`C:\w\docs\my shot-2.png`));
  });

  it("reports an error when the picture cannot be read or saved", async () => {
    await expect(insertPicked(NOTE, String.raw`C:\pics\gone.png`, fake().call)).rejects.toThrow("os error 2");
    const bad = fake({ [String.raw`C:\pics\a.png`]: PNG });
    const call: Call = (async (cmd: string, ...rest: unknown[]) => (cmd === "file_write_picture" ? Promise.reject(new Error("C:\\w\\docs\\a.png already exists; nothing was overwritten")) : (bad.call as (c: string, ...r: unknown[]) => Promise<unknown>)(cmd, ...rest))) as Call;
    await expect(insertPicked(NOTE, String.raw`C:\pics\a.png`, call)).rejects.toThrow("already exists");
    expect(insertError(new Error("C:\\w\\docs\\a.png already exists; nothing was overwritten"))).toContain("already there");
    expect(insertError("empty")).toBe("Could not insert the picture: the file is empty.");
    expect(insertError(new Error("boom"))).toBe("Could not insert the picture: boom");
  });
});

describe("inserting a pasted picture", () => {
  const file = (type: string, data: Uint8Array) => ({ type, arrayBuffer: async () => data.buffer.slice(0) as ArrayBuffer });

  it("saves it beside the note under a dated name and links it", async () => {
    const { call, calls } = fake({}, ["a.md"]);
    const md = await insertPasted(NOTE, file("image/png", PNG), call, new Date(2026, 9, 20, 7, 5, 9));
    expect(md).toBe("![pasted-20261020-070509](pasted-20261020-070509.png)");
    expect(calls[calls.length - 1]?.args).toEqual(PNG);
  });

  it("takes the next name when two pastes land in one second", async () => {
    const { call } = fake({}, ["pasted-20261020-070509.png"]);
    expect(await insertPasted(NOTE, file("image/png", PNG), call, new Date(2026, 9, 20, 7, 5, 9))).toContain("pasted-20261020-070509-2.png");
  });

  it("refuses a type a note cannot keep and an empty paste, saving nothing", async () => {
    const { call, calls } = fake();
    await expect(insertPasted(NOTE, file("image/svg+xml", PNG), call)).rejects.toThrow("cannot be kept");
    await expect(insertPasted(NOTE, file("image/png", new Uint8Array()), call)).rejects.toThrow("empty");
    expect(calls).toEqual([]);
  });
});

describe("local pictures in a rendered note", () => {
  type Fake = Imgs & { attrs: Record<string, string>; replaced: unknown[] };
  const img = (src: string): Fake => {
    const attrs: Record<string, string> = { src };
    const replaced: unknown[] = [];
    return { attrs, replaced, src, getAttribute: (n) => attrs[n] ?? null, setAttribute: (n, v) => void (attrs[n] = v), replaceWith: (...n) => void replaced.push(...n) };
  };
  const setup = (imgs: Fake[], files: Record<string, Uint8Array>) => {
    const shows: (() => void)[] = [];
    const stops = vi.fn();
    const urls: string[] = [];
    const dropped: string[] = [];
    const stop = showLocalPictures(imgs, NOTE, fake(files).call, (_el, show) => (shows.push(show), stops), (b) => (urls.push(`blob:${b.size}`), `blob:${urls.length}`), (u) => void dropped.push(u), (t) => ({ note: t }));
    return { shows, stops, stop, urls, dropped };
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("fetches nothing until a picture comes near the visible part, then shows it from its bytes", async () => {
    const a = img("pics/a.png");
    const { shows, urls } = setup([a], { "C:/w/docs/pics/a.png": PNG });
    await settle();
    expect(urls).toEqual([]);
    shows[0]();
    await settle();
    expect(a.attrs.src).toBe("blob:1");
    expect(a.attrs["data-local-picture"]).toBe("C:/w/docs/pics/a.png");
  });

  it("leaves web and data pictures alone", () => {
    const { shows } = setup([img("https://x.com/a.png"), img("data:image/png;base64,AAAA")], {});
    expect(shows).toEqual([]);
  });

  it("puts a short line in place of a picture that is missing", async () => {
    const a = img("gone.png");
    const { shows } = setup([a], {});
    shows[0]();
    await settle();
    expect(a.replaced).toEqual([{ note: "Picture not shown: gone.png is not there." }]);
  });

  it("gives the blob addresses back on stop, and drops one that arrives after", async () => {
    const a = img("a.png");
    const b = img("b.png");
    const t = setup([a, b], { "C:/w/docs/a.png": PNG, "C:/w/docs/b.png": PNG });
    t.shows[0]();
    await settle();
    t.shows[1]();
    t.stop();
    await settle();
    expect(t.dropped).toEqual(["blob:1", "blob:2"]);
    expect(t.stops).toHaveBeenCalledTimes(2);
  });

  it("words the reasons", () => {
    expect(pictureWhy("decode", "a.png")).toBe("Picture not shown: a.png could not be read.");
    expect(pictureWhy("x is too large to load", "a.png")).toContain("too large");
    expect(pictureWhy("x is outside them", "a.png")).toContain("outside your projects");
    expect(pictureWhy("empty", "a.png")).toContain("empty");
  });
});

describe('what a paste holds', () => {
  const SHOT = String.raw`C:\shots\a.png`;
  const clip = (files: { type: string; arrayBuffer(): Promise<ArrayBuffer> }[], text = '') => ({ files, getData: (t: string) => (t === 'text/plain' ? text : '') });
  const pic = { type: 'image/png', arrayBuffer: async () => PNG.buffer.slice(0) };
  it('takes a picture file first, then one picture path, and nothing else', () => {
    expect(pastedPicture(clip([pic]))).toEqual({ file: pic });
    expect(pastedPicture(clip([{ type: 'text/plain', arrayBuffer: async () => new ArrayBuffer(0) }, pic], 'words'))).toEqual({ file: pic });
    expect(pastedPicture(clip([], SHOT))).toEqual({ path: SHOT });
    expect(pastedPicture(clip([], 'just words'))).toBeNull();
    expect(pastedPicture(clip([{ type: 'image/svg+xml', arrayBuffer: async () => new ArrayBuffer(1) }]))).toBeNull();
    expect(pastedPicture({ files: null, getData: () => '' })).toBeNull();
  });
  it('saves a pasted file beside the note and links a picked path', async () => {
    const f = fake({ [SHOT]: PNG });
    expect(await insertPastedPicture(NOTE, { file: pic }, f.call, new Date(2026, 9, 20, 7, 5, 9))).toBe('![pasted-20261020-070509](pasted-20261020-070509.png)');
    expect(await insertPastedPicture(NOTE, { path: SHOT }, f.call)).toBe('![a](a.png)');
    expect(f.calls.filter((c) => c.cmd === 'file_write_picture').length).toBe(2);
  });
});

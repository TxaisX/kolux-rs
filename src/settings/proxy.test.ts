// SET-040 (T-323): proxy address and bypass list checks; the address goes to the sealed field.
import { describe, expect, it } from "vitest";
import { applyDraft, BYPASS_FIELD, HTTP1_FIELD, PROXY_FIELD, readProxyRest, tidyBypass, tidyProxy } from "./proxy";

describe("SET-040 network proxy", () => {
  it("addresses are tidied, an empty one means direct", () => {
    expect(tidyProxy("  proxy.corp:8080 ")).toEqual({ value: "http://proxy.corp:8080" });
    expect(tidyProxy("socks5://127.0.0.1:1080/")).toEqual({ value: "socks5://127.0.0.1:1080" });
    expect(tidyProxy("http://me:pw@proxy:3128")).toEqual({ value: "http://me:pw@proxy:3128" });
    expect(tidyProxy("")).toEqual({ value: "" });
  });

  it("bad addresses are refused with a reason", () => {
    expect(tidyProxy("ftp://x:21")).toMatchObject({ error: expect.stringMatching(/not ftp/) });
    expect(tidyProxy("http://proxy:8080/path")).toMatchObject({ error: expect.stringMatching(/no path/) });
    expect(tidyProxy("http://[bad")).toMatchObject({ error: expect.stringMatching(/not a proxy address/) });
  });

  it("the bypass list is split, lower-cased and de-duplicated", () => {
    expect(tidyBypass("localhost, *.Corp.example\n10.0.0.0/8 localhost <local>")).toEqual({ value: ["localhost", "*.corp.example", "10.0.0.0/8", "<local>"] });
    expect(tidyBypass("ok.com, bad host!")).toEqual({ error: "Not a host, address or range: host!." });
  });

  it("a draft applies whole or reports every error at once", () => {
    expect(applyDraft({ address: "proxy:3128", bypass: "localhost" }, true)).toEqual({ address: "http://proxy:3128", patch: { [BYPASS_FIELD]: ["localhost"], [HTTP1_FIELD]: true } });
    expect(applyDraft({ address: "ftp://x", bypass: "a b!" }, false)).toEqual({ errors: [expect.stringMatching(/not ftp/), expect.stringMatching(/b!/)] });
    expect(readProxyRest({})).toEqual({ bypass: [], http1: false });
    expect(PROXY_FIELD).toBe("httpProxy");
  });
});

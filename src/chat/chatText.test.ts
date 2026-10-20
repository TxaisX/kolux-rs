// FIX-1 (stand-in review of f1ad80d5, item 5): a link in a reply is drawn without a real href, so a middle-click or a
// context-menu "open in new window" has no address to open behind the browser choice. Click and keyboard still work.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ChatText, LinkContext, type LinkHost } from "./ChatText";

const host: LinkHost = { cwd: "C:/proj", printed: new Set(["c:/proj/src/a.ts"]), mac: false, inKolux: false, say: () => {}, chooseBrowser: () => {} };
const html = (text: string) => renderToStaticMarkup(createElement(LinkContext.Provider, { value: host }, createElement(ChatText, { text })));

describe("links in a reply", () => {
  it("a web link is drawn with no href, still reachable with the keyboard, and keeps its address in the title", () => {
    const out = html("see https://example.com/docs now");
    expect(out).toContain('class="chat-link"');
    expect(out).not.toContain("href=");
    expect(out).toContain('role="link"');
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('title="https://example.com/docs"');
  });
  it("a mail link and a file link carry no href either", () => {
    const out = html("write me@site.org or open src/a.ts:3");
    expect(out.match(/class="chat-link"/g)).toHaveLength(2);
    expect(out).not.toContain("href=");
  });
  it("a shown mail title is the cleaned address, not a dropped parameter", () => {
    const out = html("[go](mailto:a@b.co?attach=C:/s.txt&subject=Hi)");
    expect(out).toContain('title="mailto:a@b.co?subject=Hi"');
    expect(out).not.toContain("attach");
  });
});

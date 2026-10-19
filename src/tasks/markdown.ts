// GIT-050/GIT-051: a description or comment as blocks and spans the page draws itself. It never
// builds HTML: text stays text, and only http(s) links become links, so nothing in a description
// can run or load anything.
// ponytail: headings, paragraphs, bullet and numbered lists, quotes, code, bold, italic, inline code
// and links; tables, task lists and images stay as plain text until someone needs them.

export type Span = { t: "text" | "code" | "bold" | "italic"; text: string } | { t: "link"; text: string; href: string };
export type Block =
  | { t: "heading"; level: number; spans: Span[] }
  | { t: "para"; spans: Span[] }
  | { t: "quote"; spans: Span[] }
  | { t: "code"; text: string }
  | { t: "list"; ordered: boolean; items: Span[][] };

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>)]+)/g;

export function safeHref(href: string): string | null {
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function parseInline(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", text: text.slice(last, at) });
    const raw = m[0];
    if (m[1]) out.push({ t: "code", text: raw.slice(1, -1) });
    else if (m[2]) out.push({ t: "bold", text: raw.slice(2, -2) });
    else if (m[3]) out.push({ t: "italic", text: raw.slice(1, -1) });
    else if (m[4]) {
      const [, label, target] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw) ?? [];
      const href = target ? safeHref(target) : null;
      out.push(href ? { t: "link", text: label, href } : { t: "text", text: raw });
    } else {
      const href = safeHref(raw);
      out.push(href ? { t: "link", text: raw, href } : { t: "text", text: raw });
    }
    last = at + raw.length;
  }
  if (last < text.length) out.push({ t: "text", text: text.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "para", spans: parseInline(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      blocks.push({ t: "code", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    const q = /^>\s?(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ t: "heading", level: h[1].length, spans: parseInline(h[2]) });
    } else if (li) {
      flush();
      const ordered = !!li[2];
      const last = blocks[blocks.length - 1];
      const item = parseInline(li[3]);
      if (last?.t === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ t: "list", ordered, items: [item] });
    } else if (q) {
      flush();
      blocks.push({ t: "quote", spans: parseInline(q[1]) });
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

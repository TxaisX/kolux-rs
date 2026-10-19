// Native chat, the text of the agent's replies with clickable links (CHAT-025; T-329). The rules
// (what is a link, which files may open, which browser a click picks) are in chatLinks.ts; this
// draws them and does the opening. A file opens only when the agent printed it recently.
import { createContext, useContext, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openablePath, partsOf, webClick, type LinkTarget } from "./chatLinks";

/** What the chat gives its text so a click can open things. `onOpenLink`: Kolux's own viewer for a web page (none: every
 * web link goes to the system browser); `onOpenFile`: the editor at a line (none: the system opens the file). */
export type LinkHost = {
  cwd: string | null;
  printed: ReadonlySet<string>;
  mac: boolean;
  inKolux: boolean;
  onOpenLink?: (url: string) => void;
  onOpenFile?: (path: string, line?: number, column?: number) => void;
  say: (note: string) => void;
  /** A plain click on a web link: the small choice between the two browsers, at the pointer. */
  chooseBrowser: (url: string, at: { x: number; y: number }) => void;
};
export const LinkContext = createContext<LinkHost | null>(null);

export const NOT_PRINTED_NOTE = "Kolux only opens files the agent mentioned recently.";

/** Opens one link; returns nothing, says why in the box when it could not. */
export function openLink(link: LinkTarget, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; clientX: number; clientY: number }, host: LinkHost) {
  const said = (err: unknown) => host.say(String(err));
  if (link.kind === "mail") return void invoke("open_external", { url: link.href }).catch(said);
  if (link.kind === "file") {
    const full = openablePath(link, host.cwd, host.printed);
    if (!full) return host.say(NOT_PRINTED_NOTE);
    if (host.onOpenFile) return host.onOpenFile(full, link.line, link.column);
    return void invoke("open_path", { path: full }).catch(said);
  }
  const choice = webClick(e, host.mac, host.inKolux, !!host.onOpenLink);
  if (choice === "ask") return host.chooseBrowser(link.url, { x: e.clientX, y: e.clientY });
  if (choice === "kolux") return host.onOpenLink?.(link.url);
  void invoke("open_external", { url: link.url }).catch(said);
}

/** A reply's words; a path or address in them is a link when the chat can open it. */
export function ChatText({ text }: { text: string }) {
  const host = useContext(LinkContext);
  if (!host) return <>{text}</>;
  return (
    <>
      {partsOf(text).map((p, i) => {
        const link = p.link;
        if (!link || (link.kind === "file" && !openablePath(link, host.cwd, host.printed))) return <span key={i}>{p.text}</span>;
        const where = link.kind === "file" ? link.path + (link.line !== undefined ? `:${link.line}` : "") : link.kind === "web" ? link.url : link.href;
        return (
          <a
            key={i}
            className="chat-link"
            href={link.kind === "web" ? link.url : link.kind === "mail" ? link.href : "#"}
            title={where}
            onClick={(e: MouseEvent) => {
              e.preventDefault();
              openLink(link, e, host);
            }}
          >
            {p.text}
          </a>
        );
      })}
    </>
  );
}

/** The small choice a plain click on a web link opens: the in-app browser or the system one. */
export function BrowserChoice({ url, at, onPick, onClose }: { url: string; at: { x: number; y: number }; onPick: (where: "kolux" | "system") => void; onClose: () => void }) {
  return (
    <div className="chat-browser-menu" role="menu" aria-label="Open link in" style={{ left: Math.max(8, at.x), top: Math.max(8, at.y) }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="chat-browser-url" title={url}>{url}</div>
      <button type="button" role="menuitem" autoFocus onClick={() => onPick("kolux")}>Open in Kolux</button>
      <button type="button" role="menuitem" onClick={() => onPick("system")}>Open in your browser</button>
      <button type="button" role="menuitem" onClick={onClose}>Cancel</button>
    </div>
  );
}

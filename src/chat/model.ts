// Native chat, the window side (CHAT-002, CHAT-010, CHAT-011; T-325). The Rust side
// (`src-tauri/src/chat.rs`) finds and follows the agent's transcript and hands over plain
// messages; this module decides whether a pane may show chat at all, folds each read into the
// conversation, merges in what the hooks and the terminal said, and decides when the live preview
// of a reply being written is worth showing.
import type { Tool } from "./steps";

/** One message as the transcript reader hands it over. */
export type ChatItem = {
  id: string;
  role: "user" | "assistant" | "status";
  /** `text`, `command` (a slash command or skill the user typed), `interrupted`, `thought`, `tool`,
   * `plan` (Markdown), `compact` or `notice` (T-326). */
  kind: string;
  text: string;
  /** Milliseconds since 1970. */
  at?: number;
  images?: string[];
  tool?: Tool;
  /** A notice's full text, behind Details. */
  details?: string;
};

/** One look at the transcript (Rust `ChatRead`). */
export type ChatRead = {
  state: "loading" | "ready" | "empty" | "error";
  reset: boolean;
  items: ChatItem[];
  open: boolean;
  error?: string;
  retryMs: number;
};

/** CHAT-002: the agents whose sessions can be shown as chat (Grok and omp wait for T-420). */
export const CHAT_AGENTS = ["claude", "openclaude", "codex"] as const;

export type OfferInput = {
  /** The agent Kolux credits with the program running in the pane (Rust `chat_support`). */
  credited: string | null | undefined;
  /** The tab's title and the launch hint are listed only to say they never unlock chat. */
  title?: string;
  hint?: string;
  screen: "agents" | "terminals";
  /** The experimental chat switch (CHAT-001); the Agents screen does not need it. */
  switchOn: boolean;
  /** The tab is showing chat right now. */
  showingChat: boolean;
  /** The pane's program has not come up yet. */
  launching: boolean;
  /** A home folder for the agent's transcripts exists on this computer. */
  readable: boolean;
  /** A structured session: Kolux runs the agent with no terminal behind it. */
  structured?: boolean;
};

/** What a pane offers: chat, a way back to its terminal, or the still-launching chooser. */
export type Offer = { chat: boolean; back: boolean; chooser: boolean };

/** CHAT-002: whether a pane may show chat, by the agent actually running in it. */
export function chatOffer(o: OfferInput): Offer {
  if (o.structured) return { chat: true, back: false, chooser: false };
  if (o.launching && o.screen === "agents") return { chat: false, back: false, chooser: true };
  const supported = (CHAT_AGENTS as readonly string[]).includes(o.credited ?? "") && o.readable;
  const chat = supported && (o.screen === "agents" || o.switchOn);
  // A tab already showing chat can always go back to its terminal, even if support was lost.
  return { chat, back: o.showingChat, chooser: false };
}

/** Folds one read into the conversation: a reset replaces it, otherwise items with a known id
 * replace their old version and new ones join, in transcript order. */
export function applyRead(prev: ChatItem[], read: ChatRead): ChatItem[] {
  if (read.reset) return read.items;
  if (read.items.length === 0) return prev;
  const out = prev.slice();
  for (const item of read.items) {
    const i = out.findIndex((x) => x.id === item.id);
    if (i >= 0) out[i] = item;
    else out.push(item);
  }
  return out;
}

/** A message the hooks reported (the prompt, the last reply) before the transcript had it. */
export type Extra = { id: string; role: "user" | "assistant"; text: string; at: number };
/** Something typed from chat that the transcript has not confirmed yet. */
export type Pending = { id: string; text: string; at: number };
/** A row of the conversation as drawn. */
export type Row = (ChatItem & { row: "message" }) | { row: "preview"; id: string; text: string } | { row: "pending"; id: string; text: string; at: number };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
/** How far back a confirmed send may be timestamped from when it was typed. */
const SEND_SLACK_MS = 5_000;

/** CHAT-010: the transcript's messages, plus hook messages it does not have yet, each once, in
 * time order (then by identity); the streaming preview after real content; sends not yet
 * confirmed last. */
export function combine(transcript: ChatItem[], extras: Extra[], preview: string | null, pending: Pending[]): Row[] {
  const has = (role: string, text: string) => transcript.some((t) => t.role === role && norm(t.text) === norm(text));
  const real: ChatItem[] = [...transcript, ...extras.filter((e) => !has(e.role, e.text)).map((e) => ({ ...e, kind: "text" }))];
  const order = real.map((item, i) => ({ item, i }));
  order.sort((a, b) => (a.item.at ?? 0) - (b.item.at ?? 0) || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : a.i - b.i));
  const rows: Row[] = order.map(({ item }) => ({ ...item, row: "message" as const }));
  if (preview) rows.push({ row: "preview", id: "preview", text: preview });
  for (const p of pending) {
    const confirmed = transcript.some((t) => t.role === "user" && norm(t.text) === norm(p.text) && (t.at ?? Infinity) >= p.at - SEND_SLACK_MS);
    if (!confirmed) rows.push({ row: "pending", id: p.id, text: p.text, at: p.at });
  }
  return rows;
}

/** A live preview of the reply being written, scraped while the turn runs (T-421 feeds it). */
export type Preview = { text: string; tool?: boolean };

/** CHAT-011: the preview is shown only during an active turn, only when it runs ahead of the
 * transcript's last reply, and never when it is tool output or blank. */
export function previewToShow(preview: Preview | null, turnOpen: boolean, lastReply: string | undefined): string | null {
  if (!preview || !turnOpen || preview.tool) return null;
  const text = preview.text.trim();
  if (!text) return null;
  if (lastReply !== undefined && text.length <= norm(lastReply).length) return null;
  return text;
}

/** The last thing the agent said, for the preview comparison. */
export function lastReply(items: ChatItem[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].role === "user") return undefined;
    if (items[i].role === "assistant" && items[i].kind === "text") return items[i].text;
  }
  return undefined;
}

/** CHAT-010: a message's time, in the app's language (short on the row, full on hover). */
export function stamp(at: number, locale: string): { short: string; full: string } {
  const d = new Date(at);
  return {
    short: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(d),
    full: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(d),
  };
}

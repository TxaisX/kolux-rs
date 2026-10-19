// VIEW-078: the status bar's source of ports. Scans through the Rust side while the item is on screen
// (faster while its popover is open), and listens to the terminal output event to learn the address a
// dev server printed. A failed scan keeps the last good list and names the problem.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { decodeOutput, type ExitEvent, type OutputEvent } from "../terminal/codec";
import { applyScan, type PortRow, type Scan } from "./rows";
import { UrlBook } from "./urls";

export const SCAN_MS = 3000;
export const SCAN_OPEN_MS = 1500;

export function usePorts(workspaces: string[], on: boolean, open: boolean) {
  const [scan, setScan] = useState<Scan>({ rows: [], problem: null });
  const book = useRef(new UrlBook());
  const trees = useRef(workspaces);
  trees.current = workspaces;
  const key = workspaces.join("\n");

  const refresh = () =>
    invoke<PortRow[]>("ports_scan", { worktrees: trees.current })
      .then((rows) => {
        book.current.keepOnly(rows.map((r) => r.port));
        setScan((p) => applyScan(p, { rows }));
      })
      .catch((e) => setScan((p) => applyScan(p, { error: String(e) })));

  useEffect(() => {
    if (!on) return;
    let live = true;
    const unlisten: Array<() => void> = [];
    const decoder = new TextDecoder();
    void listen<OutputEvent>("terminal-output", (e) => book.current.feed(e.payload.id, decoder.decode(decodeOutput(e.payload.data), { stream: false }))).then((u) => (live ? unlisten.push(u) : u()));
    void listen<ExitEvent>("terminal-exit", (e) => book.current.forget(e.payload.id)).then((u) => (live ? unlisten.push(u) : u()));
    return () => {
      live = false;
      unlisten.forEach((u) => u());
    };
  }, [on]);

  useEffect(() => {
    if (!on) return;
    void refresh();
    const t = setInterval(() => void refresh(), open ? SCAN_OPEN_MS : SCAN_MS);
    return () => clearInterval(t);
  }, [on, open, key]);

  return { ...scan, book: book.current, refresh };
}

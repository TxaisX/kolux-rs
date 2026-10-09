// One terminal pane: a shell on the Rust side, drawn by xterm.js here. Typing goes to the PTY,
// output comes back as events, the pane follows the window size, and Close ends the program.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { attachRenderer, type RendererMode } from "./renderer";
import { decodeOutput, endedLabel, type ExitEvent, type OutputEvent } from "./codec";

type Status = { kind: "starting" } | { kind: "running"; id: number } | { kind: "ended"; code: number | null } | { kind: "failed"; error: string };

export default function TerminalPane() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [renderer, setRenderer] = useState<RendererMode | null>(null);
  const idRef = useRef<number | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 14,
      theme: { background: "#141a2a", foreground: "#e6e6e6", cursor: "#e6e6e6" },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const choice = attachRenderer<WebglAddon>(term, () => new WebglAddon());
    setRenderer(choice.mode);
    choice.onFallback(() => setRenderer("dom"));
    fit.fit();

    let alive = true;
    let ended = false;
    const unlisteners: UnlistenFn[] = [];
    const write = (data: string) => {
      const id = idRef.current;
      if (id !== null && !ended) invoke("terminal_write", { id, data }).catch(() => {});
    };
    term.onData(write);

    (async () => {
      unlisteners.push(
        await listen<OutputEvent>("terminal-output", (e) => {
          if (e.payload.id === idRef.current) term.write(decodeOutput(e.payload.data));
        }),
        await listen<ExitEvent>("terminal-exit", (e) => {
          if (e.payload.id !== idRef.current) return;
          ended = true;
          term.write(`\r\n\x1b[90m[process ${endedLabel(e.payload.code)}]\x1b[0m\r\n`);
          setStatus({ kind: "ended", code: e.payload.code });
        }),
      );
      if (!alive) return;
      try {
        const id = await invoke<number>("terminal_spawn", { cols: term.cols, rows: term.rows });
        if (!alive) {
          invoke("terminal_kill", { id }).catch(() => {});
          return;
        }
        idRef.current = id;
        setStatus({ kind: "running", id });
        term.focus();
      } catch (err) {
        setStatus({ kind: "failed", error: String(err) });
      }
    })();

    const resize = () => {
      fit.fit();
      const id = idRef.current;
      if (id !== null && !ended) invoke("terminal_resize", { id, cols: term.cols, rows: term.rows }).catch(() => {});
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    return () => {
      alive = false;
      observer.disconnect();
      unlisteners.forEach((u) => u());
      const id = idRef.current;
      if (id !== null) invoke("terminal_kill", { id }).catch(() => {});
      choice.dispose();
      term.dispose();
    };
  }, []);

  const close = () => {
    const id = idRef.current;
    if (id !== null) invoke("terminal_kill", { id }).catch(() => {});
  };

  const label =
    status.kind === "starting" ? "starting PowerShell…" : status.kind === "running" ? "PowerShell" : status.kind === "ended" ? `PowerShell · ${endedLabel(status.code)}` : `could not start: ${status.error}`;

  return (
    <section style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 10px", background: "#1f2a44", fontSize: 13 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ opacity: 0.6 }}>{renderer === "webgl" ? "GPU" : renderer === "dom" ? "plain" : ""}</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={close}
          disabled={status.kind !== "running"}
          style={{ background: "transparent", color: "#e6e6e6", border: "1px solid #556", borderRadius: 4, padding: "2px 10px", cursor: "pointer" }}
          title="Close pane: ends the program"
        >
          Close
        </button>
      </header>
      <div ref={host} style={{ flex: 1, minHeight: 0, padding: 4, background: "#141a2a" }} />
    </section>
  );
}

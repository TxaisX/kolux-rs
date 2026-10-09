// One terminal pane: a shell on the Rust side, drawn by xterm.js here. Typing goes to the PTY,
// output comes back as events, the pane follows the window size, and Close ends the program.
// The card and its header follow design/DESIGN.md section 7: status icon, agent mark, title,
// branch chip, program, status word; then gauge, more, expand, split, close on the right.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { attachRenderer, type RendererMode } from "./renderer";
import { decodeOutput, endedLabel, type ExitEvent, type OutputEvent } from "./codec";
import { monoFont, terminalTheme } from "../theme";
import { folderName } from "../projects/model";
import { CheckCircle, Close, Dots, Expand, Plus, Spinner } from "../chrome/icons";
import VendorMark, { type Agent } from "../chrome/VendorMark";

type Status = { kind: "starting" } | { kind: "running"; id: number } | { kind: "ended"; code: number | null } | { kind: "failed"; error: string };

type Props = { cwd?: string | null; branch?: string | null; focused?: boolean; agent?: Agent; onRunning?: (running: boolean) => void };

export default function TerminalPane({ cwd = null, branch = null, focused = false, agent = "shell", onRunning }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "starting" });
  const [renderer, setRenderer] = useState<RendererMode | null>(null);
  const idRef = useRef<number | null>(null);
  const report = useRef(onRunning);
  report.current = onRunning;

  useEffect(() => {
    report.current?.(status.kind === "running");
  }, [status.kind]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: monoFont,
      fontSize: 13,
      theme: terminalTheme(),
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
        const id = await invoke<number>("terminal_spawn", { cols: term.cols, rows: term.rows, cwd });
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

  // TERM-020/021: a plain shell reads as a terminal with a neutral status; only a failure is tinted.
  const word = status.kind === "starting" ? "Starting" : status.kind === "running" ? "Ready" : status.kind === "ended" ? `Ended${status.code ? ` (${status.code})` : ""}` : "Failed";
  const tone = status.kind === "failed" ? "attention" : "";
  const icon = status.kind === "starting" ? "working" : status.kind === "running" ? "done" : "idle";
  const drawing = renderer === "webgl" ? "GPU renderer" : renderer === "dom" ? "plain renderer" : "";
  const title = cwd ? folderName(cwd) : "Terminal";

  return (
    <section className={`pane${focused ? " focused" : ""}`} aria-label={`${title} pane`}>
      <header className="pane-head">
        <span className={`st ${icon}`} role="img" aria-label={`status: ${word}`} title={[word, drawing].filter(Boolean).join(" · ")}>
          {icon === "working" ? <Spinner size={11} /> : <CheckCircle size={12} />}
        </span>
        <span className="agent-mark" title={agent === "shell" ? "Plain shell" : agent}>
          <VendorMark agent={agent} size={13} />
        </span>
        <span className="title" title={cwd ?? undefined}>
          {title}
        </span>
        {branch && (
          <span className="chip" title={branch}>
            {branch}
          </span>
        )}
        <span className="word">PowerShell</span>
        <span className={`status ${tone}`}>{word}</span>
        <span className="right">
          <span className="gauge" title="Context used (agents only)">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--gauge-track)" strokeWidth="2" />
            </svg>
            0%
          </span>
          <button className="ib" title="Pane menu (not built yet)">
            <Dots size={12} />
          </button>
          <button className="ib" title="Expand (not built yet)">
            <Expand size={12} />
          </button>
          <button className="ib" title="Split (not built yet)">
            <Plus size={12} />
          </button>
          <button className="ib" onClick={close} disabled={status.kind !== "running"} title="Close pane: ends the program">
            <Close size={12} />
          </button>
        </span>
      </header>
      <div ref={host} className="pane-body" />
    </section>
  );
}

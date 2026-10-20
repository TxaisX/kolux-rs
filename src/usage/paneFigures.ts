// T-548-b (OD-11): plan figures for the Codex accounts that panes run on but that are not the active
// one. The active account's figures come from the Codex pill (codex_usage); every other account a
// Codex pane is on is read here with codex_usage_of, one slow reader per account (a read starts a
// helper process, so the same pace as the pill: every five minutes, a focus at most every two).
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CodexUsage } from "./codex";
import { accountKey } from "./meter";
import { publishCodexActive, publishCodexFor } from "./plan";
import { codexFetched, runner } from "./refresh";

const FOCUS_MS = 2 * 60_000;

/** The accounts to read: the distinct accounts of the Codex panes that are not the active one, in the
 *  order the panes appear. A pane with no recorded account (undefined) is unknown and asks for nothing. */
export function accountsToRead(panes: Array<{ agent: string; account?: string | null }>, active: string | null): Array<string | null> {
  const out: Array<string | null> = [];
  for (const p of panes) {
    if (p.agent !== "codex" || p.account === undefined || p.account === active) continue;
    if (!out.includes(p.account)) out.push(p.account);
  }
  return out;
}

/** Keeps one reader per wanted account running and drops the figures of an account no pane needs any more. */
export function useCodexPaneFigures(panes: Array<{ agent: string; account?: string | null }>, active: string | null): void {
  const wanted = accountsToRead(panes, active);
  const key = wanted.map((a) => (a === null ? "\u0000" : a)).join("\u0001");
  useEffect(() => void publishCodexActive(active), [active]);
  const held = useRef<Array<string | null>>([]);
  useEffect(() => {
    const ids = key === "" ? [] : key.split("\u0001").map((a) => (a === "\u0000" ? null : a));
    // an account no pane runs on any more loses its figures; the others keep theirs while they are read again
    held.current.filter((h) => !ids.includes(h)).forEach((h) => publishCodexFor(h, null));
    held.current = ids;
    const runners = ids.map((id) =>
      runner<CodexUsage>({
        name: `codex-of:${accountKey(id)}`,
        fetch: () => invoke<CodexUsage>("codex_usage_of", { account: id }).then(codexFetched),
        focusDebounceMs: FOCUS_MS,
        onOk: (u) => publishCodexFor(id, u),
        // The figures already shown stay through a failure (USAGE-023).
      }),
    );
    runners.forEach((r) => r.start());
    return () => runners.forEach((r) => r.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

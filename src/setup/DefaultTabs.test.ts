import { describe, expect, it } from "vitest";
import { defaultTabs, tabTitle, type SharedTab } from "./DefaultTabs";
import type { TrustAnswer, TrustAsk } from "./TrustPrompt";

const tab = (title: string | null, command: string | null, color: string | null = null): SharedTab => ({ title, color, command });

/** A fake Rust: `need` is what script_trust_needed says; a grant makes the next read carry commands. */
function fakeRust(tabs: SharedTab[], need: TrustAsk | null, refused: string | null = null) {
  const calls: [string, Record<string, unknown>][] = [];
  let granted = need === null;
  const invoke = async <T,>(cmd: string, args: Record<string, unknown>): Promise<T> => {
    calls.push([cmd, args]);
    if (cmd === "script_trust_needed") return (granted ? null : need) as T;
    if (cmd === "script_trust_grant") {
      granted = true;
      return null as T;
    }
    return { tabs: granted ? tabs : tabs.map((t) => ({ ...t, command: null })), ask: granted ? null : need, refused } as T;
  };
  return { calls, invoke };
}

const ask: TrustAsk = { kind: "tabs", script: "pnpm dev", changed: false, project: "app" };

describe("PROJ-034 the default tabs of a new workspace", () => {
  it("asks once for the commands, then opens the tabs with them", async () => {
    const r = fakeRust([tab("Dev", "pnpm dev", "#0af"), tab("Notes", null)], ask);
    const asked: TrustAsk[] = [];
    const out = await defaultTabs("C:/r", "C:/w", r.invoke, async (a) => (asked.push(a), "once" as TrustAnswer));
    expect(asked).toEqual([ask]);
    expect(out.tabs).toEqual([tab("Dev", "pnpm dev", "#0af"), tab("Notes", null)]);
    expect(r.calls.map((c) => c[0])).toEqual(["script_trust_needed", "script_trust_grant", "workspace_default_tabs"]);
    expect(r.calls[1][1]).toEqual({ path: "C:/w", kind: "tabs", script: "pnpm dev", always: false, root: "C:/r" });
  });

  it("opens the tabs without their commands when the user says Don't run", async () => {
    const r = fakeRust([tab("Dev", "pnpm dev")], ask);
    const out = await defaultTabs("C:/r", "C:/w", r.invoke, async () => "skip");
    expect(out.tabs).toEqual([tab("Dev", null)]);
    expect(r.calls.map((c) => c[0])).toEqual(["script_trust_needed", "workspace_default_tabs"]);
  });

  it("never asks when the file has no commands or the repository is trusted", async () => {
    const r = fakeRust([tab("Notes", null)], null);
    const out = await defaultTabs("C:/r", "C:/w", r.invoke, async () => {
      throw new Error("no question expected");
    });
    expect(out).toEqual({ tabs: [tab("Notes", null)], refused: null });
  });

  it("reports a refused file and opens nothing", async () => {
    const r = fakeRust([], null, "kolux.yaml is larger than 64 KB, so its shared settings are ignored");
    expect(await defaultTabs("C:/r", "C:/w", r.invoke)).toEqual({ tabs: [], refused: "kolux.yaml is larger than 64 KB, so its shared settings are ignored" });
  });

  it("titles a tab by its title, else its command's first word, else Terminal", () => {
    expect(tabTitle(tab("Dev", "pnpm dev"))).toBe("Dev");
    expect(tabTitle(tab(null, "  pnpm dev"))).toBe("pnpm");
    expect(tabTitle(tab(null, null, "#fff"))).toBe("Terminal");
  });
});

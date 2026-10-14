import { describe, expect, it } from "vitest";
import { hideRule, INDEX, MAX_SEARCH, searchRepos, searchSettings } from "./search";

// Where each page draws its sections (SettingsPage wraps the pages that have no sections of their own).
const SOURCES: Record<string, string[]> = {
  general: ["GeneralPage.tsx"],
  appearance: ["AppearancePage.tsx"],
  accounts: ["SettingsPage.tsx"],
  agents: ["AgentsPage.tsx"],
  terminal: ["TerminalPage.tsx"],
  git: ["GitPage.tsx"],
  notifications: ["NotificationsPage.tsx", "SettingsPage.tsx"],
  shortcuts: ["ShortcutsPage.tsx"],
  usage: ["SettingsPage.tsx"],
};
const FILES = import.meta.glob("./*Page.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const read = (f: string) => FILES[`./${f}`] ?? "";

describe("search all settings (SET-007)", () => {
  it("indexes only sections that are still drawn on their page", () => {
    for (const e of INDEX) expect(SOURCES[e.page].map(read).join("\n"), `${e.page}/${e.section}`).toContain(`data-section="${e.section}"`);
  });
  it("finds font in Appearance, inside the fold that holds it, and the terminal font (SET 022)", () => {
    const h = searchSettings("font")!;
    expect(h.pages).toEqual([
      { page: "appearance", sections: ["fonts"] },
      { page: "terminal", sections: ["text"] },
    ]);
    expect([...h.folds]).toEqual(["interface"]);
  });
  it("finds Ask Before Closing Running Terminals by confirm, close or agent (SET 043)", () => {
    for (const q of ["confirm", "close", "agent"]) expect(searchSettings(q)!.pages.find((p) => p.page === "terminal")?.sections, q).toContain("closing");
  });
  it("ranks the page whose title matches first, then the rest in page order", () => {
    const h = searchSettings("shortcuts")!;
    expect(h.pages[0]).toEqual({ page: "shortcuts", sections: "all" });
    expect(searchSettings("terminal")!.pages.map((p) => p.page)).toEqual(["terminal", "appearance", "shortcuts"]);
  });
  it("finds agents by name or id, and languages by their own names", () => {
    expect(searchSettings("devin")!.pages).toEqual([{ page: "agents", sections: ["agents"] }]);
    expect(searchSettings("日本語")!.pages).toEqual([{ page: "appearance", sections: ["language"] }]);
  });
  it("refuses an over-long search before trimming, even a run of spaces", () => {
    expect(searchSettings(" ".repeat(MAX_SEARCH + 1))!.refused).toBe(true);
    expect(searchSettings("   ")).toBeNull();
    expect(searchSettings("zzzz")!.pages).toEqual([]);
  });
  it("finds repositories by name or folder and hides the sections without a match", () => {
    const ps = [{ name: "kolux", path: "G:/Dev/kolux" }, { name: "site", path: "G:/Web/site" }];
    expect(searchRepos("web", ps).map((p) => p.name)).toEqual(["site"]);
    expect(hideRule(searchSettings("sound")!)).toBe('.settings-found[data-page="notifications"] [data-section]:not([data-section="sound"]) { display: none !important; }');
  });
});

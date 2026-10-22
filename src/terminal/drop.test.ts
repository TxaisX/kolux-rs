import { describe, expect, it } from "vitest";
import { dropSummary, dropText, isImage, overRect, quotePath, shellKind } from "./drop";

describe("TERM-074 drop files onto a terminal", () => {
  it("quotes a path with spaces for each shell and types no Enter", () => {
    const p = "C:\\Users\\someone\\My Files\\report (final).txt";
    expect(quotePath(p, "powershell")).toBe("'C:\\Users\\someone\\My Files\\report (final).txt'");
    expect(quotePath(p, "cmd")).toBe('"C:\\Users\\someone\\My Files\\report (final).txt"');
    expect(quotePath(p, "posix")).toBe("'C:/Users/someone/My Files/report (final).txt'");
    expect(quotePath(p, "other")).toBe('"C:\\Users\\someone\\My Files\\report (final).txt"');
    const { text } = dropText([p, "D:\\b.png"], "powershell");
    expect(text).toBe("'C:\\Users\\someone\\My Files\\report (final).txt' 'D:\\b.png'");
    expect(text).not.toMatch(/[\r\n]/);
  });

  it("escapes a quote inside the path the way the shell reads it", () => {
    expect(quotePath("C:\\it's\\a.txt", "powershell")).toBe("'C:\\it''s\\a.txt'");
    expect(quotePath("C:\\it's\\a.txt", "posix")).toBe("'C:/it'\\''s/a.txt'");
    expect(quotePath('C:\\say "hi".txt', "other")).toBe('"C:\\say \\"hi\\".txt"');
  });

  it("council D2 MERGE 47 B1: PowerShell's curly single quotes are doubled, so a name cannot close the quoting", () => {
    // PowerShell reads U+2018-U+201B as single quotes: undoubled, a’;calc;’ would end the string and run calc.
    expect(quotePath("C:\\dl\\a\u2019;calc;\u2019.txt", "powershell")).toBe("'C:\\dl\\a\u2019\u2019;calc;\u2019\u2019.txt'");
    expect(quotePath("C:\\\u2018\u201A\u201B.txt", "powershell")).toBe("'C:\\\u2018\u2018\u201A\u201A\u201B\u201B.txt'");
  });

  it("council D2 MERGE 47 B2: the kind comes from the program that started, whatever the agent; wsl is POSIX", () => {
    expect(shellKind("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe("powershell");
    expect(shellKind("pwsh.exe")).toBe("powershell");
    expect(shellKind("cmd.exe")).toBe("cmd");
    expect(shellKind("C:/Program Files/Git/bin/bash.exe")).toBe("posix");
    expect(shellKind("C:\\Windows\\System32\\wsl.exe")).toBe("posix");
    expect(shellKind("C:\\Users\\x\\.local\\bin\\claude.exe")).toBe("other");
    expect(shellKind(null)).toBe("other");
    // an agent pane whose agent exited and fell back to PowerShell: started program is powershell, single quotes
    expect(dropText(["C:\\x$(calc).txt"], shellKind("powershell.exe")).text).toBe("'C:\\x$(calc).txt'");
  });

  it("council D2 MERGE 47 B2/S1: with only double quotes (cmd, an agent's prompt) a path that could expand is not typed", () => {
    for (const kind of ["cmd", "other"] as const) {
      for (const bad of ["C:\\x$(calc).txt", "C:\\x`calc`.txt", "C:\\%PATH%.txt", "C:\\a!b!.txt", "C:\\a\u2019b.txt"]) {
        expect(dropText([bad, "C:\\ok.txt"], kind)).toEqual({ text: '"C:\\ok.txt"', typed: ["C:\\ok.txt"], refused: 1 });
      }
    }
    // the shells that single-quote type them as they are
    expect(dropText(["C:\\a!b%c$d`e.txt"], "posix").text).toBe("'C:/a!b%c$d`e.txt'");
    expect(dropText(["C:\\a!b%c$d`e.txt"], "powershell").refused).toBe(0);
  });

  it("drops a path holding a control character and types nothing for an empty drop", () => {
    expect(dropText(["C:\\a\x1b[200~b.txt", "C:\\ok.txt"], "cmd")).toEqual({ text: '"C:\\ok.txt"', typed: ["C:\\ok.txt"], refused: 1 });
    expect(dropText([], "cmd")).toEqual({ text: "", typed: [], refused: 0 });
  });

  it("recognises images by extension and summarises without the paths", () => {
    expect(isImage("C:\\shots\\one.PNG")).toBe(true);
    expect(isImage("C:\\shots\\one.txt")).toBe(false);
    expect(isImage("C:\\noext")).toBe(false);
    expect(dropSummary(["C:\\a.png"])).toBe("1 path dropped (an image)");
    expect(dropSummary(["C:\\a.png", "C:\\b.txt", "C:\\c.jpg"])).toBe("3 paths dropped (2 images)");
    expect(dropSummary(["C:\\a.txt"])).toBe("1 path dropped");
    expect(dropSummary(["C:\\secret\\a.txt"])).not.toContain("secret");
  });

  it("hit-tests the drop against the pane's box", () => {
    const r = { left: 100, top: 50, right: 300, bottom: 250 };
    expect(overRect(150, 60, r)).toBe(true);
    expect(overRect(99, 60, r)).toBe(false);
    expect(overRect(150, 251, r)).toBe(false);
  });
});

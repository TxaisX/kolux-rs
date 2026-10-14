import { describe, expect, it } from "vitest";
import { dropSummary, dropText, isImage, overRect, quotePath, shellKind } from "./drop";

describe("TERM-074 drop files onto a terminal", () => {
  it("quotes a path with spaces for each shell and types no Enter", () => {
    const p = "C:\\Users\\Txais\\My Files\\report (final).txt";
    expect(quotePath(p, "powershell")).toBe("'C:\\Users\\Txais\\My Files\\report (final).txt'");
    expect(quotePath(p, "cmd")).toBe('"C:\\Users\\Txais\\My Files\\report (final).txt"');
    expect(quotePath(p, "posix")).toBe("'C:/Users/Txais/My Files/report (final).txt'");
    expect(quotePath(p, "other")).toBe('"C:\\Users\\Txais\\My Files\\report (final).txt"');
    const text = dropText([p, "D:\\b.png"], "powershell");
    expect(text).toBe("'C:\\Users\\Txais\\My Files\\report (final).txt' 'D:\\b.png'");
    expect(text).not.toMatch(/[\r\n]/);
  });

  it("escapes a quote inside the path the way the shell reads it", () => {
    expect(quotePath("C:\\it's\\a.txt", "powershell")).toBe("'C:\\it''s\\a.txt'");
    expect(quotePath("C:\\it's\\a.txt", "posix")).toBe("'C:/it'\\''s/a.txt'");
    expect(quotePath('C:\\say "hi".txt', "other")).toBe('"C:\\say \\"hi\\".txt"');
  });

  it("reads the shell kind from the program that started, and an agent pane as other", () => {
    expect(shellKind("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe("powershell");
    expect(shellKind("pwsh.exe")).toBe("powershell");
    expect(shellKind("cmd.exe")).toBe("cmd");
    expect(shellKind("C:/Program Files/Git/bin/bash.exe")).toBe("posix");
    expect(shellKind(null)).toBe("other");
    expect(shellKind("powershell.exe", "claude")).toBe("other");
  });

  it("drops a path holding a control character and types nothing for an empty drop", () => {
    expect(dropText(["C:\\a\x1b[200~b.txt", "C:\\ok.txt"], "cmd")).toBe('"C:\\ok.txt"');
    expect(dropText([], "cmd")).toBe("");
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

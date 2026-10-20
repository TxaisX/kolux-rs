import { describe, expect, it } from "vitest";
import { failureText, osOf, viewOf, whereText, type Registration } from "./cliRegister";

const reg = (state: Registration["state"], canChange = true): Registration => ({ state, command: "kolux", place: "C:/Kolux", note: null, canChange });

describe("CLI-008 Settings > CLI", () => {
  it("offers register when not registered, remove when registered, and neither on a conflict or an unreadable PATH", () => {
    expect(viewOf(reg("not-registered"))).toMatchObject({ canRegister: true, canRemove: false, warn: false });
    expect(viewOf(reg("registered"))).toMatchObject({ canRegister: false, canRemove: true });
    expect(viewOf(reg("conflict"))).toMatchObject({ canRegister: false, canRemove: false, warn: true });
    expect(viewOf(reg("unknown", false))).toMatchObject({ canRegister: false, canRemove: false, warn: true });
    expect(viewOf(reg("conflict")).headline).toContain("C:/Kolux");
  });
  it("explains the place for each operating system", () => {
    expect(osOf("Mozilla/5.0 (Windows NT 10.0)")).toBe("windows");
    expect(osOf("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe("mac");
    expect(osOf("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(whereText("windows", "kolux")).toContain("PATH");
    expect(whereText("mac", "kolux")).toContain("/usr/local/bin");
    expect(whereText("linux", "kolux-dev")).toContain("~/.local/bin");
  });
  it("a failure names what went wrong", () => {
    expect(failureText("register", "X is in the way")).toBe("Could not register the command: X is in the way");
  });
});

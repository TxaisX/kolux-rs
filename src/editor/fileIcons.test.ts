import { describe, expect, it } from "vitest";
import { fileKind } from "./fileIcons";

describe("file-type icons (EDIT-011)", () => {
  it("a package-manager lock file gets the lock icon, not the one for its extension (acceptance 2)", () => {
    expect(fileKind("package-lock.json")).toBe("lock");
    expect(fileKind("pnpm-lock.yaml")).toBe("lock");
    expect(fileKind("Cargo.lock")).toBe("lock");
    expect(fileKind("other.json")).toBe("data");
    expect(fileKind("package.json")).toBe("package");
  });

  it("whole names beat extensions, and multi-part endings are recognised", () => {
    expect(fileKind("Dockerfile")).toBe("config");
    expect(fileKind(".gitignore")).toBe("config");
    expect(fileKind("tsconfig.build.json")).toBe("config");
    expect(fileKind("vite.config.ts")).toBe("config");
    expect(fileKind("App.test.tsx")).toBe("test");
    expect(fileKind("types.d.ts")).toBe("code");
    expect(fileKind("backup.tar.gz")).toBe("archive");
    expect(fileKind("README.md")).toBe("doc");
    expect(fileKind("LICENSE")).toBe("doc");
    expect(fileKind(".env.local")).toBe("config");
  });

  it("ordinary extensions, any case, and the plain-file fallback", () => {
    expect(fileKind("main.RS")).toBe("code");
    expect(fileKind("events.jsonl")).toBe("data");
    expect(fileKind("sales.csv")).toBe("table");
    expect(fileKind("photo.JPG")).toBe("image");
    expect(fileKind("analysis.ipynb")).toBe("notebook");
    expect(fileKind("run.sh")).toBe("shell");
    expect(fileKind("mystery.zzz")).toBe("file");
    expect(fileKind("noextension")).toBe("file");
    expect(fileKind("constructor")).toBe("file");
    expect(fileKind("__proto__")).toBe("file");
  });
});

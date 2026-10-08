import { expect, test } from "vitest";
import { windowTitle } from "./app-info";

test("window title carries the version once the Rust side has answered", () => {
  expect(windowTitle(null)).toBe("Kolux RS");
  expect(windowTitle({ version: "0.1.0", profileDir: "x", startCount: 1 })).toBe("Kolux RS 0.1.0");
});

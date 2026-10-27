import { expect, test } from "vitest";
import { findMissing } from "./missingFolders";

test("PROJ-086: a workspace whose folder is gone is flagged; a lookup that fails flags nothing", async () => {
  const kinds: Record<string, string> = { "C:/a": "dir", "C:/b": "missing", "C:/c": "dir" };
  const got = await findMissing(["C:/a", "C:/b", "C:/c", "C:/d"], async (p) => {
    if (p === "C:/d") throw new Error("denied");
    return kinds[p];
  });
  expect([...got]).toEqual(["C:/b"]);
  expect((await findMissing([], async () => "missing")).size).toBe(0);
});

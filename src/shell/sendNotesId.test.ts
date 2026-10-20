// VIEW-072 compat: the send-notes command keeps its exact id and ships with no key; the editor conflict group is the one COMPAT 4.1 names for it.
import { describe, expect, it } from "vitest";
import { SEND_NOTES } from "../editor/noteCommands";
import { actions, defaultsFor } from "../keys/actions";

describe("VIEW-072 send review notes command", () => {
  const send = actions.filter((a) => a.id === "sourceControl.sendReviewNotes");
  it("is registered once under the carried id, the one the editor's note commands use", () => {
    expect(SEND_NOTES).toBe("sourceControl.sendReviewNotes");
    expect(send).toHaveLength(1);
    expect(send[0].title).toBe("Send Review Notes to Agent");
  });
  it("ships unbound on every platform and sits in the editor conflict group", () => {
    for (const p of ["win32", "linux", "darwin"] as const) expect(defaultsFor(send[0], p)).toEqual([]);
    expect(send[0].group).toBe("editor");
  });
});

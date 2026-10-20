import { describe, expect, it } from "vitest";
import { takeSuggestion } from "./suggest";

describe("PROJ-023 takeSuggestion", () => {
  it("fills an empty field the first time", () => {
    expect(takeSuggestion("", null, "amber-otter")).toBe("amber-otter");
  });

  it("replaces a suggestion nobody touched with a newer one", () => {
    expect(takeSuggestion("amber-otter", "amber-otter", "brisk-seal")).toBe("brisk-seal");
  });

  it("keeps a name the user edited when another suggestion comes in", () => {
    expect(takeSuggestion("amber-otter-fix", "amber-otter", "brisk-seal")).toBe("amber-otter-fix");
    expect(takeSuggestion("my login fix", null, "brisk-seal")).toBe("my login fix");
  });

  it("keeps a field the user cleared on purpose", () => {
    expect(takeSuggestion("", "amber-otter", "brisk-seal")).toBe("");
  });

  it("ignores an empty suggestion", () => {
    expect(takeSuggestion("", null, "")).toBe("");
    expect(takeSuggestion("amber-otter", "amber-otter", "")).toBe("amber-otter");
  });
});

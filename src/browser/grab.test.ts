import { describe, expect, it } from "vitest";
import type { Pick } from "./annotate";
import { CROP_MAX, CROP_PAD, cropRect, detailRows, detailsText, grabMessage } from "./grab";

const pick: Pick = {
  selector: "#buy",
  path: "main > button#buy.cta",
  tag: "button",
  text: "  Buy\n  now ",
  component: "BuyButton",
  source: "src/Buy.tsx:12",
  hints: { "data-id": "9", class: "cta big", role: "button" },
  styles: { color: "red", display: "flex" },
  box: { x: 100, y: 200, width: 80, height: 30 },
};

describe("BROW-035 the element's picture is cropped from the page capture", () => {
  it("scales the box to the picture's pixels and keeps a margin around it", () => {
    // a 2x display: 2560x1440 pixels show 1280x720 CSS pixels
    expect(cropRect({ x: 100, y: 200, width: 80, height: 30 }, 2560, 1440, 1280, 720)).toEqual({ sx: 188, sy: 388, sw: 184, sh: 84, dw: 184, dh: 84 });
    expect(CROP_PAD).toBe(6);
  });

  it("cuts an element that hangs over the page's edge to the picture, and refuses one wholly outside", () => {
    expect(cropRect({ x: -50, y: -50, width: 100, height: 100 }, 1000, 500, 1000, 500)).toEqual({ sx: 0, sy: 0, sw: 56, sh: 56, dw: 56, dh: 56 });
    expect(cropRect({ x: 980, y: 480, width: 100, height: 100 }, 1000, 500, 1000, 500)).toEqual({ sx: 974, sy: 474, sw: 26, sh: 26, dw: 26, dh: 26 });
    expect(cropRect({ x: 1200, y: 10, width: 50, height: 50 }, 1000, 500, 1000, 500)).toBeNull();
    expect(cropRect({ x: 10, y: -300, width: 50, height: 50 }, 1000, 500, 1000, 500)).toBeNull();
  });

  it("refuses an element with no size or a picture with no size, and shrinks a huge crop to the cap", () => {
    expect(cropRect({ x: 1, y: 1, width: 0, height: 10 }, 100, 100, 100, 100)).toBeNull();
    expect(cropRect({ x: 1, y: 1, width: 10, height: 10 }, 0, 100, 100, 100)).toBeNull();
    expect(cropRect({ x: 1, y: 1, width: Number.NaN, height: 10 }, 100, 100, 100, 100)).toBeNull();
    const big = cropRect({ x: 0, y: 0, width: 3000, height: 1500 }, 3000, 1500, 3000, 1500)!;
    expect(big.sw).toBe(3000);
    expect(big.dw).toBe(CROP_MAX);
    expect(big.dh).toBe(CROP_MAX / 2);
  });
});

describe("BROW-035 the details sheet", () => {
  it("lists the tag, selector, text on one line and the box; the attributes leave out class, which has its own row", () => {
    const rows = detailRows(pick);
    expect(rows.slice(0, 4)).toEqual([
      { label: "Tag", value: "<button>" },
      { label: "Selector", value: "#buy" },
      { label: "Text", value: "Buy now" },
      { label: "Box", value: "80×30 at 100,200" },
    ]);
    expect(rows.find((r) => r.label === "Attributes")?.value).toBe('data-id="9" role="button"');
    expect(rows.find((r) => r.label === "Class")?.value).toBe("cta big");
    expect(rows.find((r) => r.label === "Styles")?.value).toBe("color: red; display: flex");
  });

  it("leaves no row for an empty field", () => {
    expect(detailRows({ selector: "div" }).map((r) => r.label)).toEqual(["Selector"]);
    expect(detailRows({ selector: "div", text: "   ", hints: {} }).map((r) => r.label)).toEqual(["Selector"]);
  });

  it("the message to the agent names the page, the details and the picture's file", () => {
    const m = grabMessage(pick, "Shop", "https://shop.test/cart?token=abc", "C:/caps/element-1.png");
    expect(m.split("\n")[0]).toBe("Element grabbed from Shop (https://shop.test/cart):");
    expect(m).toContain("selector: `#buy`");
    expect(m).toContain("box: 80×30 at 100,200");
    expect(m).toContain("picture: C:/caps/element-1.png");
    expect(m).not.toContain("token");
    expect(grabMessage(pick, "Shop", "https://shop.test/", null)).not.toContain("picture:");
  });

  it("copy text is one 'Label: value' line per row", () => {
    expect(detailsText({ selector: "#a", tag: "p" }).split("\n")).toEqual(["Tag: <p>", "Selector: #a"]);
  });
});

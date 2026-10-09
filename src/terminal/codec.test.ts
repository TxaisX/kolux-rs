import { expect, test } from "vitest";
import { decodeOutput, endedLabel } from "./codec";

test("base64 output chunks decode to the exact PTY bytes, including a split multi-byte character", () => {
  // "é" is C3 A9 in UTF-8; the Rust side may cut a chunk between the two bytes.
  const first = btoa(String.fromCharCode(0x6b, 0x6f, 0xc3)); // "ko" + first byte of é
  const second = btoa(String.fromCharCode(0xa9, 0x0d, 0x0a)); // second byte + CRLF
  const joined = new Uint8Array([...decodeOutput(first), ...decodeOutput(second)]);
  expect(Array.from(joined)).toEqual([0x6b, 0x6f, 0xc3, 0xa9, 0x0d, 0x0a]);
  expect(new TextDecoder().decode(joined)).toBe("koé\r\n");
});

test("empty chunk decodes to no bytes", () => {
  expect(decodeOutput("").length).toBe(0);
});

test("the ended label names a non-zero exit code only", () => {
  expect(endedLabel(0)).toBe("ended");
  expect(endedLabel(null)).toBe("ended");
  expect(endedLabel(1)).toBe("ended (exit 1)");
});

import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

describe("sha256Hex", () => {
  it("matches the FIPS 180-2 test vectors, lowercase hex like the engine's stamps", async () => {
    const abc = new TextEncoder().encode("abc");
    expect(await sha256Hex(abc)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex(new ArrayBuffer(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

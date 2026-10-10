import { describe, expect, it } from "vitest";
import { IDENTIFY_PROMPT } from "./systemPrompts";

describe("identify prompt truthfulness", () => {
  it("does not present model confidence as empirical calibration", () => {
    expect(IDENTIFY_PROMPT).toMatch(/model estimate/i);
    expect(IDENTIFY_PROMPT).not.toMatch(/calibrated probability-like/i);
    expect(IDENTIFY_PROMPT).toContain("not an empirical probability");
  });

  it("requires real scale evidence before suggesting a fastener size", () => {
    expect(IDENTIFY_PROMPT).toContain("Do not estimate a wrench or thread size from appearance alone");
    expect(IDENTIFY_PROMPT).not.toContain("likely 13 mm wrench size");
  });
});

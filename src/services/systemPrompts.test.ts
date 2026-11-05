import { describe, expect, it } from "vitest";
import { FOLLOWUP_PROMPT, IDENTIFY_PROMPT } from "./systemPrompts";

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

  it("never asserts a shared part merely because photos were supplied", () => {
    expect(IDENTIFY_PROMPT).toContain("when absent it is unknown");
    expect(IDENTIFY_PROMPT).toContain("Only an explicit same_part_or_area choice is a user report");
    expect(IDENTIFY_PROMPT).toContain("use the first photo for the main identity and geometry");
    expect(IDENTIFY_PROMPT).toContain("Supplied vehicle context applies only to the first photo");
    expect(IDENTIFY_PROMPT).not.toContain("Labeled photos are user-reported views of one part");
    expect(IDENTIFY_PROMPT).not.toContain("Use the focused image to identify the intended part");
    expect(FOLLOWUP_PROMPT).toContain("absent means unknown");
    expect(FOLLOWUP_PROMPT).toContain("supplied vehicle facts apply to the first photo only");
    expect(FOLLOWUP_PROMPT).toContain("Respect the separately supplied saved identification scope");
    expect(FOLLOWUP_PROMPT).toContain("An unrecorded scope must not be retrospectively attributed to a particular photo");
    expect(FOLLOWUP_PROMPT).not.toContain("saved identity and vehicle facts apply to the first photo only");
  });
});

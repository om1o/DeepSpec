import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasLocalAuthBypass, markLocalAuthBypass } from "./auth";

describe("auth local bypass", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("fails closed when localStorage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(hasLocalAuthBypass()).toBe(false);
  });

  it("reports when the local bypass marker cannot be saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(markLocalAuthBypass()).toBe(false);
  });
});

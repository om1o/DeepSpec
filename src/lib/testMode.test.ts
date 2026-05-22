import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTestMode, isTestMode, isTestSaveMode } from "./testMode";

describe("test mode storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("falls back to false when sessionStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(isTestMode()).toBe(false);
  });

  it("does not throw when clearing test mode fails", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(() => clearTestMode()).not.toThrow();
  });

  it("only enables local QA seeding from the explicit save flag", () => {
    expect(isTestSaveMode("?test=1")).toBe(false);
    expect(isTestSaveMode("?test=1&save=1")).toBe(true);
    expect(isTestSaveMode("?save=1")).toBe(false);
  });
});

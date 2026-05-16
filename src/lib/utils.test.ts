import { cx, getScaledDimensions } from "./utils";

describe("cx", () => {
  it("keeps truthy class names and removes empty values", () => {
    expect(cx("base", false, null, undefined, "active")).toBe("base active");
  });
});

describe("getScaledDimensions", () => {
  it("scales a landscape image down to the max longest edge", () => {
    expect(getScaledDimensions(4000, 2000, 1024)).toEqual({ width: 1024, height: 512 });
  });

  it("scales a portrait image down to the max longest edge", () => {
    expect(getScaledDimensions(2000, 4000, 1024)).toEqual({ width: 512, height: 1024 });
  });

  it("does not upscale small images", () => {
    expect(getScaledDimensions(800, 600, 1024)).toEqual({ width: 800, height: 600 });
  });
});

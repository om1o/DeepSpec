import { render, screen } from "@testing-library/react";
import { BrandLockup } from "./BrandLockup";

describe("BrandLockup", () => {
  it("pairs the DeepSpec name with the standalone symbol", () => {
    const { container } = render(<BrandLockup size="lg" />);

    expect(screen.getByRole("img", { name: "DeepSpec" })).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", "/brand/deepspec-symbol.webp");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });
});

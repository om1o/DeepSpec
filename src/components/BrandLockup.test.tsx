import { render, screen } from "@testing-library/react";
import { BrandLockup } from "./BrandLockup";

describe("BrandLockup", () => {
  it("renders the static primary white lockup", () => {
    const { container } = render(<BrandLockup size="lg" />);

    expect(screen.getByRole("img", { name: "DeepSpec" })).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("src", "/brand/deepspec-logo-horizontal.svg");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });
});

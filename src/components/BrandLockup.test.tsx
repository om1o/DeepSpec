import { render, screen } from "@testing-library/react";
import { BrandLockup } from "./BrandLockup";

describe("BrandLockup", () => {
  it("renders the static electric D lockup", () => {
    const { container } = render(<BrandLockup size="lg" />);

    const lockup = screen.getByRole("img", { name: "DeepSpec" });
    expect(lockup).toBeInTheDocument();
    expect(lockup.querySelector("img")).toHaveAttribute("src", "/brand/deepspec-symbol.webp");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container).toHaveTextContent("DeepSpec");
  });

  it("keeps the compact mark decorative inside one accessible brand name", () => {
    const { container } = render(<BrandLockup variant="mark" />);

    const lockup = screen.getByRole("img", { name: "DeepSpec" });
    expect(lockup).toBeInTheDocument();
    expect(lockup.querySelector("img")).toHaveAttribute("src", "/brand/deepspec-symbol.webp");
    expect(container).not.toHaveTextContent("DeepSpec");
  });
});

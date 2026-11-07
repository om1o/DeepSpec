import { render, screen } from "@testing-library/react";
import { BrandLockup } from "./BrandLockup";

describe("BrandLockup", () => {
  it("renders the static primary white lockup", () => {
    const { container } = render(<BrandLockup size="lg" />);

    const lockup = screen.getByRole("img", { name: "DeepSpec" });
    expect(lockup).toBeInTheDocument();
    expect(lockup.querySelector("img")).toHaveAttribute("src", "/brand/deepspec-logo-horizontal.svg");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(container.querySelector("img")).toHaveAttribute("draggable", "false");
  });

  it("keeps the compact mark decorative inside one accessible brand name", () => {
    const { container } = render(<BrandLockup variant="mark" />);

    const lockup = screen.getByRole("img", { name: "DeepSpec" });
    expect(lockup).toBeInTheDocument();
    expect(lockup.querySelector("img")).toHaveAttribute("src", "/brand/deepspec-mark.svg");
    expect(container).not.toHaveTextContent("DeepSpec");
  });
});

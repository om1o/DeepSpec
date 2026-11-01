import { render, screen } from "@testing-library/react";
import { ChatMessageContent } from "./ChatMessageContent";

describe("ChatMessageContent", () => {
  it("renders assistant emphasis and lists without exposing Markdown markers", () => {
    render(<ChatMessageContent markdown content={"**Visible evidence:**\n\n- Vented housing\n- Belt pulley"} />);

    expect(screen.getByText("Visible evidence:").tagName).toBe("STRONG");
    expect(screen.getByRole("list")).toHaveTextContent("Vented housing");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("keeps raw HTML inert and refuses non-HTTPS links", () => {
    const { container } = render(
      <ChatMessageContent markdown content={'<script>window.bad = true</script>\n\n[safe](https://example.com/path) [unsafe](javascript:alert(1))'} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute("href", "https://example.com/path");
    expect(screen.queryByRole("link", { name: "unsafe" })).toBeNull();
  });

  it("does not fetch provider-supplied Markdown images", () => {
    render(<ChatMessageContent markdown content="![tracking pixel](https://example.com/pixel.png)" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("[Image: tracking pixel]")).toBeInTheDocument();
  });

  it("keeps customer messages as literal text", () => {
    render(<ChatMessageContent content="**do not format me**" />);
    expect(screen.getByText("**do not format me**")).toBeInTheDocument();
    expect(screen.queryByText("do not format me")).not.toBeInTheDocument();
  });
});

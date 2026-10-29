import { render, screen } from "@testing-library/react";
import { ScanSources } from "./ScanSources";

it("shows actual returned video and research references while rejecting unsafe URLs", () => {
  render(<ScanSources sources={[
    { label: "Alternator inspection", url: "https://www.youtube.com/watch?v=real-reference", sourceType: "reference" },
    { label: "Repair information", url: "https://example.com/alternator", sourceType: "reference" },
    { label: "Unsafe source", url: "javascript:alert(1)", sourceType: "reference" },
    { label: "Embedded credentials", url: "https://user:secret@example.com/", sourceType: "reference" },
  ]} />);
  expect(screen.getByText("Video reference · youtube.com")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Alternator inspection/ })).toHaveAttribute("href", "https://www.youtube.com/watch?v=real-reference");
  expect(screen.getByRole("link", { name: /Repair information/ })).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.queryByText("Unsafe source")).not.toBeInTheDocument();
  expect(screen.queryByText("Embedded credentials")).not.toBeInTheDocument();
});

it("labels generated web and video searches separately from returned references", () => {
  render(<ScanSources sources={[]} researchTerm="DENSO 104210-1230 alternator" />);
  expect(screen.getByRole("link", { name: /Search YouTube/ })).toHaveAttribute("href", "https://www.youtube.com/results?search_query=DENSO%20104210-1230%20alternator");
  expect(screen.getByRole("link", { name: /Search the web/ })).toHaveAttribute("href", "https://www.google.com/search?q=DENSO%20104210-1230%20alternator");
  expect(screen.queryByText(/Video reference/)).not.toBeInTheDocument();
});

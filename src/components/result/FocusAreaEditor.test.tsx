import { fireEvent, render, screen } from "@testing-library/react";
import { FocusAreaEditor } from "./FocusAreaEditor";

it("reports bounded draft geometry during edits without treating it as an applied area", () => {
  const change = vi.fn(), apply = vi.fn(), cancel = vi.fn();
  render(<div><FocusAreaEditor box={{ x: .2, y: .2, width: .3, height: .4, confidence: .8 }} onChange={change} onApply={apply} onCancel={cancel} /></div>);
  fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "60" } });
  expect(change).toHaveBeenLastCalledWith({ x: .6, y: .2, width: .3, height: .4, confidence: 0 });
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply area" }));
  expect(apply).toHaveBeenCalledExactlyOnceWith({ x: .6, y: .2, width: .3, height: .4, confidence: 0 });
  fireEvent.keyDown(screen.getByLabelText("Selected area controls"), { key: "Escape" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("retains the existing editor contract when no draft observer is supplied", () => {
  const apply = vi.fn();
  render(<FocusAreaEditor box={{ x: .1, y: .1, width: .3, height: .3, confidence: .9 }} onApply={apply} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByRole("slider", { name: "Selection width" }), { target: { value: "70" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply area" }));
  expect(apply).toHaveBeenCalledExactlyOnceWith({ x: .1, y: .1, width: .7, height: .3, confidence: 0 });
});

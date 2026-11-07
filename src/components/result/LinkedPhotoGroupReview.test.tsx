import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../../lib/accountScope";
import type { ComponentMapScanGroup } from "../../types/componentMap";
import type { LinkedPhotoGroupVerification } from "../../services/linkedPhotoEvidence";
import { LinkedPhotoGroupReview } from "./LinkedPhotoGroupReview";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), local: vi.fn(), subscribe: vi.fn() }));
vi.mock("../../services/linkedPhotoEvidence", () => ({ resolveLinkedPhotoGroup: mocks.resolve }));
vi.mock("../../services/storage", () => ({ getLookup: mocks.local, subscribeToLookupChanges: mocks.subscribe }));
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCuoAAAAASUVORK5CYII=";
const source = { sha256: "a".repeat(64), width: 1, height: 1, photoAddedAt: "2026-11-05T12:00:00.000Z", scanSavedAt: "2026-11-05T12:01:00.000Z" };
function group(): ComponentMapScanGroup {
  return { linkId: "00000000-0000-4000-8000-000000000001", lookupId: "linked-scan", photoIds: ["angle-a", "angle-b"],
    binding: { version: 1, photoRelationship: "independent", photos: [
      { photoId: "angle-a", label: "overview", source }, { photoId: "angle-b", label: "close_up", source },
    ] } };
}
function evidence(): LinkedPhotoGroupVerification {
  return { legacy: false, photoRelationship: "independent", photos: [
    { photoId: "angle-a", label: "overview", source, status: "unchanged", message: "Original A matches.", image },
    { photoId: "angle-b", label: "close_up", source, status: "source_changed", message: "Original B was replaced.", image: "data:image/png;base64,replacement" },
  ] };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
let changed: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks(); setActiveAccount("linked-photo-view-owner"); changed = undefined;
  mocks.subscribe.mockImplementation((callback) => { changed = callback; return vi.fn(); });
  mocks.local.mockReturnValue({ id: "linked-scan" });
  mocks.resolve.mockResolvedValue(evidence());
});

describe("LinkedPhotoGroupReview", () => {
  it("keeps changed slots and historical metadata while showing only verified original pixels", async () => {
    const value = evidence(); value.photos[0].currentMetadataChanged = true; mocks.resolve.mockResolvedValue(value);
    render(<LinkedPhotoGroupReview group={group()} scope={getAccountScope()} onClose={vi.fn()} />);
    expect(await screen.findByText("Original B was replaced.")).toBeInTheDocument();
    expect(screen.getByText("Photo 1 — overview")).toBeInTheDocument();
    expect(screen.getByText("Photo 2 — close up")).toBeInTheDocument();
    expect(screen.getByText(/Relationship at linking: Independent examples/)).toBeInTheDocument();
    expect(screen.getByText(/current scan's labels or relationship changed/)).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img")).toHaveAttribute("src", image);
    expect(mocks.resolve.mock.calls[0][3]).toBe(true);
  });

  it("invalidates displayed evidence on storage changes and retains the device requirement after deletion", async () => {
    render(<LinkedPhotoGroupReview group={group()} scope={getAccountScope()} onClose={vi.fn()} />);
    await screen.findByRole("img");
    const pending = deferred<LinkedPhotoGroupVerification>(); mocks.resolve.mockReturnValue(pending.promise); mocks.local.mockReturnValue(null);
    await act(async () => { changed?.(); });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(mocks.resolve.mock.calls.at(-1)?.[3]).toBe(true);
    const missing = evidence(); missing.photos = missing.photos.map((photo) => ({ ...photo, image: undefined, status: "missing_photo", message: "Saved original is missing." }));
    await act(async () => { pending.resolve(missing); });
    expect(screen.getAllByText("Original file missing")).toHaveLength(2);
    expect(screen.getByText("Photo 2 — close up")).toBeInTheDocument();
  });

  it("cannot apply a delayed result to another group's photos", async () => {
    const old = deferred<LinkedPhotoGroupVerification>(); mocks.resolve.mockReturnValueOnce(old.promise);
    const original = group(), scope = getAccountScope();
    const view = render(<LinkedPhotoGroupReview group={original} scope={scope} onClose={vi.fn()} />);
    const next = group(); next.lookupId = "other-scan"; next.linkId = "00000000-0000-4000-8000-000000000002";
    const latest = evidence(); latest.photos[0].message = "Other group's original verified."; mocks.resolve.mockResolvedValue(latest);
    view.rerender(<LinkedPhotoGroupReview group={next} scope={scope} onClose={vi.fn()} />);
    await screen.findByText("Other group's original verified.");
    await act(async () => { old.resolve(evidence()); });
    expect(screen.queryByText("Original A matches.")).not.toBeInTheDocument();
    expect(screen.getByText("Other group's original verified.")).toBeInTheDocument();
    expect((mocks.resolve.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  });

  it("hides prior pixels immediately when a changed binding is awaiting verification", async () => {
    const original = group(), scope = getAccountScope();
    const view = render(<LinkedPhotoGroupReview group={original} scope={scope} onClose={vi.fn()} />); await screen.findByRole("img");
    mocks.resolve.mockReturnValue(new Promise(() => {})); const next = group(); next.binding!.photos[0].source = { ...source, sha256: "b".repeat(64) };
    view.rerender(<LinkedPhotoGroupReview group={next} scope={scope} onClose={vi.fn()} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not render a remote URL even if a malformed resolver result calls it unchanged", async () => {
    const value = evidence(); value.photos[0].image = "https://example.com/replacement.png"; mocks.resolve.mockResolvedValue(value);
    render(<LinkedPhotoGroupReview group={group()} scope={getAccountScope()} onClose={vi.fn()} />);
    await screen.findByText("Original A matches."); expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("discards pending verification after account generation changes", async () => {
    const pending = deferred<LinkedPhotoGroupVerification>(); mocks.resolve.mockReturnValue(pending.promise);
    const original = group(), scope = getAccountScope(); const view = render(<LinkedPhotoGroupReview group={original} scope={scope} onClose={vi.fn()} />);
    setActiveAccount("another-owner"); await act(async () => { pending.resolve(evidence()); });
    view.rerender(<LinkedPhotoGroupReview group={original} scope={scope} onClose={vi.fn()} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(screen.getByRole("status")).toHaveTextContent("account changed");
  });

  it("retains every slot after a failed check and permits an explicit retry", async () => {
    mocks.resolve.mockRejectedValueOnce(new Error("read failed"));
    render(<LinkedPhotoGroupReview group={group()} scope={getAccountScope()} onClose={vi.fn()} />);
    await screen.findByText(/These originals could not be checked/); expect(screen.getByText("Photo 2 — close up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recheck linked originals" })); await screen.findByRole("img");
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  });

  it("reports an image display failure without showing replacement pixels", async () => {
    render(<LinkedPhotoGroupReview group={group()} scope={getAccountScope()} onClose={vi.fn()} />);
    fireEvent.error(await screen.findByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(screen.getByText(/Original image could not be displayed/)).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lookup } from "../../types";
import type { ComponentMap, ComponentMapRecord } from "../../types/componentMap";
import { ComponentMapError } from "../../lib/componentMap";
import { setActiveAccount } from "../../lib/accountScope";
import { ComponentMapReview } from "./ComponentMapReview";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), create: vi.fn(), update: vi.fn(), subscribe: vi.fn(),
  loadCloud: vi.fn(), syncCloud: vi.fn(), resolveCloud: vi.fn(), readLookup: vi.fn(), navigate: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../../services/componentMapStore", () => ({
  readComponentMap: mocks.read, createComponentMap: mocks.create, updateComponentMap: mocks.update, subscribeComponentMaps: mocks.subscribe,
}));
vi.mock("../../services/componentMapCloud", () => ({
  loadComponentMapFromCloud: mocks.loadCloud, syncComponentMapToCloud: mocks.syncCloud,
  resolveComponentMapCloudConflict: mocks.resolveCloud, readComponentMapLookup: mocks.readLookup,
}));

const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const box = { x: 0.1, y: 0.2, width: 0.2, height: 0.3, confidence: 0.8 };
const lookup: Lookup = {
  id: "overview-scan", createdAt: "2026-11-05T12:00:00.000Z",
  frame: { imageBase64: "data:image/jpeg;base64,original", capturedAt: "2026-11-05T12:00:00.000Z" },
  photos: [{ id: "bay", label: "overview", imageBase64: "data:image/jpeg;base64,original", capturedAt: "2026-11-05T12:00:00.000Z" }],
  isolatedObjects: [{ name: "Alternator", primary: true, category: "electrical", focusBox: box, isolatedImageBase64: "data:image/png;base64,cutout" }],
  scanCategory: "engine", rating: null, correction: null, notes: "", trainingLabel: "Engine bay", trainingStatus: "raw_unreviewed", chatHistory: [],
  vehicleContext: { make: "Subaru", model: "Outback", year: "2023" },
  provenance: { analysisSource: "ai_detection", captureMode: "upload", savedAt: "2026-11-05T12:00:00.000Z" },
};
function record(count = 2): ComponentMapRecord {
  return {
    document: { version: 1, id: lookup.id, overview: { lookupId: lookup.id, photoId: "bay" },
      components: Array.from({ length: count }, (_, index) => ({ id: uuid(index + 1), label: `Component ${index + 1}`, status: "needs_view", notes: "", scanGroups: [], region: { sourcePhotoId: "bay", box } })),
    },
    localRevision: 1, cloudRevision: null, syncedLocalRevision: 0,
  };
}
let listener: ((mapId: string) => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  setActiveAccount("map-owner");
  listener = undefined;
  mocks.subscribe.mockImplementation((callback) => { listener = callback; return vi.fn(); });
  mocks.read.mockResolvedValue(record());
  mocks.loadCloud.mockResolvedValue({ ok: true, value: null, message: "No cloud map." });
  mocks.create.mockImplementation(async (document: ComponentMap) => ({ document, localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 }));
  mocks.update.mockImplementation(async (_id: string, revision: number, document: ComponentMap) => ({ document, localRevision: revision + 1, cloudRevision: null, syncedLocalRevision: 0 }));
  mocks.readLookup.mockResolvedValue({ ok: true, value: null });
});
async function ready(saved = record()) {
  mocks.read.mockResolvedValue(saved);
  const rendered = render(<ComponentMapReview lookup={lookup} />);
  await screen.findByLabelText("Component label");
  return rendered;
}

describe("ComponentMapReview", () => {
  it("shows the original and all existing numbered areas without the four-mask cap or automatic review", async () => {
    const saved = record(6);
    await ready(saved);
    expect(screen.getByRole("img", { name: "Original component overview" })).toHaveAttribute("src", lookup.frame.imageBase64);
    expect(within(screen.getByRole("list", { name: "Mapped components" })).getAllByRole("button")).toHaveLength(6);
    await userEvent.click(screen.getByRole("button", { name: "Select component 6: Component 6" }));
    expect(screen.getByLabelText("Component label")).toHaveValue("Component 6");
    expect(screen.getByLabelText("Your review status")).toHaveValue("needs_view");
    expect(screen.getByText(/Inspected is your recorded status, not a statement/)).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.loadCloud).not.toHaveBeenCalled();
  });

  it("creates suggestions only after an explicit action and keeps every initial status unreviewed", async () => {
    mocks.read.mockResolvedValue(null);
    render(<ComponentMapReview lookup={lookup} />);
    await screen.findByRole("button", { name: "Create component map" });
    expect(mocks.create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Create component map" }));
    await screen.findByLabelText("Component label");
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ overview: { lookupId: lookup.id, photoId: "bay" }, components: [{ label: "Alternator", status: "needs_view", region: { sourcePhotoId: "bay", box } }] });
    expect(mocks.create.mock.calls[0][0].components[0]).not.toHaveProperty("reviewedAt");
    expect(mocks.syncCloud).not.toHaveBeenCalled();
  });

  it("loads a cloud map only when no device map exists", async () => {
    mocks.read.mockResolvedValue(null);
    const remote = record();
    remote.document.components[0].label = "Cloud alternator";
    mocks.loadCloud.mockResolvedValue({ ok: true, value: remote, message: "Loaded." });
    render(<ComponentMapReview lookup={lookup} />);
    expect(await screen.findByLabelText("Component label")).toHaveValue("Cloud alternator");
    expect(mocks.loadCloud).toHaveBeenCalledWith(lookup.id, expect.objectContaining({ userId: "map-owner" }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("adds an unboxed component, saves explicit not-visible review and notes, and reopens that record", async () => {
    const view = await ready(record(6));
    await userEvent.click(screen.getByRole("button", { name: "Add component" }));
    const label = screen.getByLabelText("Component label");
    await userEvent.clear(label);
    await userEvent.type(label, "Rear connector");
    await userEvent.selectOptions(screen.getByLabelText("Your review status"), "not_visible");
    await userEvent.type(screen.getByLabelText("Component notes"), "Blocked by the intake; no check performed.");
    expect(screen.getByRole("button", { name: "Take component photos" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Map saved on this device.");
    const saved = (await mocks.update.mock.results[0].value) as ComponentMapRecord;
    expect(saved.document.components).toHaveLength(7);
    expect(saved.document.components[6]).toMatchObject({ label: "Rear connector", status: "not_visible", notes: "Blocked by the intake; no check performed.", reviewedAt: expect.any(String), scanGroups: [] });
    expect(saved.document.components[6]).not.toHaveProperty("region");
    expect(saved.document.components.slice(0, 6)).toEqual(record(6).document.components);
    view.unmount();
    await ready(saved);
    await userEvent.click(within(screen.getByRole("list", { name: "Mapped components" })).getByRole("button", { name: /Rear connector/ }));
    expect(screen.getByLabelText("Your review status")).toHaveValue("not_visible");
    expect(screen.getByLabelText("Component notes")).toHaveValue("Blocked by the intake; no check performed.");
  });

  it("shows all 100 entries and disables only additional manual entries at the bound", async () => {
    await ready(record(100));
    expect(within(screen.getByRole("list", { name: "Mapped components" })).getAllByRole("button")).toHaveLength(100);
    expect(screen.getByRole("button", { name: "Add component" })).toBeDisabled();
  });

  it("hides a not-visible component's marker without deleting its previous area", async () => {
    await ready();
    await userEvent.selectOptions(screen.getByLabelText("Your review status"), "not_visible");
    expect(screen.queryByRole("button", { name: "Select component 1: Component 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adjust map area" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Map saved on this device.");
    expect(mocks.update.mock.calls[0][2].components[0]).toMatchObject({ status: "not_visible", region: { sourcePhotoId: "bay", box } });
  });

  it("corrects map geometry without altering original pixels, existing isolation or review status", async () => {
    const original = structuredClone(lookup);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Adjust map area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "30" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Map saved on this device.");
    expect(mocks.update.mock.calls[0][2].components[0]).toMatchObject({ region: { sourcePhotoId: "bay", box: { ...box, x: 0.3, confidence: 0 } }, status: "needs_view" });
    expect(mocks.update.mock.calls[0][2].components[0]).not.toHaveProperty("reviewedAt");
    expect(lookup).toEqual(original);
  });

  it("starts capture with stable parent/component identity and distinct fresh attempt and scan IDs", async () => {
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Take component photos" }));
    const [path, options] = mocks.navigate.mock.calls[0];
    expect(path).toBe("/scan");
    expect(options.state).toMatchObject({ accountId: "map-owner", componentLabel: "Component 1", vehicleContext: lookup.vehicleContext,
      componentCaptureTarget: { mapId: lookup.id, componentId: uuid(1), linkAttemptId: expect.any(String), lookupId: expect.any(String) } });
    expect(options.state.componentCaptureTarget.lookupId).not.toBe(options.state.componentCaptureTarget.linkAttemptId);
    expect(options.state.componentCaptureTarget.lookupId).not.toBe(lookup.id);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps a missing linked scan visible and never navigates or fabricates its photo", async () => {
    const saved = record();
    saved.document.components[0].scanGroups = [{ linkId: uuid(500), lookupId: "missing-scan", photoIds: ["detail"] }];
    await ready(saved);
    await userEvent.click(screen.getByRole("button", { name: "Open photo group 1 (1 photos)" }));
    expect(await screen.findByText("Linked scan or photos unavailable. The map link has been kept.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open photo group 1 (1 photos)" })).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("opens only the linked scan with its actual referenced photos and account-scoped route state", async () => {
    const saved = record();
    saved.document.components[0].scanGroups = [{ linkId: uuid(500), lookupId: "component-scan", photoIds: ["detail"] }];
    const child = { ...lookup, id: "component-scan", photos: [{ ...lookup.photos![0], id: "detail" }] };
    mocks.readLookup.mockResolvedValue({ ok: true, value: child });
    await ready(saved);
    await userEvent.click(screen.getByRole("button", { name: "Open photo group 1 (1 photos)" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/result/component-scan", { state: expect.objectContaining({ savedLookup: child, accountId: "map-owner" }) }));
  });

  it("preserves an edited draft on a changed-map event, then lets the user reload and explicitly restore it", async () => {
    await ready();
    await userEvent.type(screen.getByLabelText("Component notes"), "Keep my draft");
    const newer = record();
    newer.localRevision = 2;
    newer.document.components[0].label = "Newer saved label";
    mocks.read.mockResolvedValue(newer);
    await act(async () => { listener?.(lookup.id); });
    expect(await screen.findByText(/This map changed elsewhere/)).toBeInTheDocument();
    expect(screen.getByLabelText("Component notes")).toHaveValue("Keep my draft");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Load saved map and keep draft" }));
    await waitFor(() => expect(screen.getByLabelText("Component label")).toHaveValue("Newer saved label"));
    await userEvent.click(screen.getByText("Preserved draft", { selector: "summary" }));
    expect(screen.getByText("Keep my draft")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore preserved draft for editing" }));
    expect(screen.getByLabelText("Component notes")).toHaveValue("Keep my draft");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(lookup.id, 2, expect.any(Object), expect.objectContaining({ userId: "map-owner" })));
  });

  it("retains a draft when a save loses its revision race", async () => {
    await ready();
    await userEvent.type(screen.getByLabelText("Component notes"), "Unsaved human note");
    mocks.update.mockRejectedValue(new ComponentMapError("stale_revision", "This map changed. Your edits were not applied."));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("This map changed. Your edits were not applied.");
    expect(screen.getByLabelText("Component notes")).toHaveValue("Unsaved human note");
    expect(screen.getByRole("button", { name: "Load saved map and keep draft" })).toBeInTheDocument();
  });

  it("requires explicit cloud saving and conflict resolution, preserving the device draft after choosing cloud", async () => {
    const saved = record();
    await ready(saved);
    expect(mocks.syncCloud).not.toHaveBeenCalled();
    const cloudDocument = structuredClone(saved.document);
    cloudDocument.components[0].label = "Cloud reviewed label";
    const conflicted = { ...saved, localRevision: 2, conflict: { document: cloudDocument, revision: 5 } };
    mocks.syncCloud.mockResolvedValue({ ok: false, message: "Both versions are preserved." });
    mocks.read.mockResolvedValue(conflicted);
    await userEvent.click(screen.getByRole("button", { name: "Save map to cloud" }));
    await screen.findByText("Cloud map differs");
    expect(screen.getByLabelText("Component label")).toHaveValue("Component 1");
    const adopted = { document: cloudDocument, localRevision: 3, cloudRevision: 5, syncedLocalRevision: 3 };
    mocks.resolveCloud.mockResolvedValue({ ok: true, value: adopted, message: "Cloud version chosen." });
    await userEvent.click(screen.getByRole("button", { name: "Use cloud version" }));
    await waitFor(() => expect(screen.getByLabelText("Component label")).toHaveValue("Cloud reviewed label"));
    expect(mocks.resolveCloud).toHaveBeenCalledWith(lookup.id, 2, "cloud", expect.objectContaining({ userId: "map-owner" }));
    expect(mocks.syncCloud).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByText("Preserved draft", { selector: "summary" }));
    await userEvent.click(screen.getByRole("button", { name: "Restore preserved draft for editing" }));
    expect(screen.getByLabelText("Component label")).toHaveValue("Component 1");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("does not paint boxes over a failed original image", async () => {
    await ready();
    fireEvent.error(screen.getByRole("img", { name: "Original component overview" }));
    expect(screen.getByText(/Original overview unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select component 1:/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Component label")).toHaveValue("Component 1");
  });

  it("does not create a map from a placeholder original", async () => {
    mocks.read.mockResolvedValue(null);
    render(<ComponentMapReview lookup={{ ...lookup, photos: undefined, frame: { ...lookup.frame, imageBase64: "/brand/deepspec-logo.webp" } }} />);
    expect(await screen.findByRole("button", { name: "Create component map" })).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not navigate to component capture after the account changes", async () => {
    await ready();
    setActiveAccount("another-owner");
    await userEvent.click(screen.getByRole("button", { name: "Take component photos" }));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

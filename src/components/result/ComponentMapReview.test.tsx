import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lookup, VisualFocusBox } from "../../types";
import type { ComponentMap, ComponentMapRecord } from "../../types/componentMap";
import type { MapOverviewSaveGuard, MapOverviewVerification } from "../../services/mapOverviewEvidence";
import { ComponentMapError } from "../../lib/componentMap";
import { setActiveAccount } from "../../lib/accountScope";
import { ComponentMapReview } from "./ComponentMapReview";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), create: vi.fn(), update: vi.fn(), subscribe: vi.fn(),
  loadCloud: vi.fn(), syncCloud: vi.fn(), resolveCloud: vi.fn(), readLookup: vi.fn(), readLocalLookup: vi.fn(), navigate: vi.fn(),
  subscribeLookups: vi.fn(), resolveOverview: vi.fn(), assertOverview: vi.fn(), resolveLinked: vi.fn(),
  areaApply: undefined as ((box: VisualFocusBox) => void) | undefined,
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../../services/storage", () => ({ getLookup: mocks.readLocalLookup, subscribeToLookupChanges: mocks.subscribeLookups }));
vi.mock("../../services/mapOverviewEvidence", () => ({
  resolveMapOverview: mocks.resolveOverview, assertMapOverviewGuardCurrent: mocks.assertOverview,
}));
vi.mock("../../services/linkedPhotoEvidence", () => ({ resolveLinkedPhotoGroup: mocks.resolveLinked }));
vi.mock("../../services/componentMapStore", () => ({
  readComponentMap: mocks.read, createComponentMap: mocks.create, updateComponentMap: mocks.update, subscribeComponentMaps: mocks.subscribe,
}));
vi.mock("../../services/componentMapCloud", () => ({
  loadComponentMapFromCloud: mocks.loadCloud, syncComponentMapToCloud: mocks.syncCloud,
  resolveComponentMapCloudConflict: mocks.resolveCloud, readComponentMapLookup: mocks.readLookup,
}));
vi.mock("./FocusAreaEditor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./FocusAreaEditor")>();
  return { ...actual, FocusAreaEditor: (props: Parameters<typeof actual.FocusAreaEditor>[0]) => {
    mocks.areaApply = props.onApply;
    return <actual.FocusAreaEditor {...props} />;
  } };
});

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
const source = { sha256: "a".repeat(64), width: 1, height: 1, photoAddedAt: lookup.createdAt, scanSavedAt: lookup.createdAt };
const guard: MapOverviewSaveGuard = { lookupId: lookup.id, photoId: "bay", source, deviceSignature: "synthetic-source-signature" };
function verified(sourceLookup = lookup): MapOverviewVerification {
  return { status: "unchanged", message: "Saved overview source verified.", image: sourceLookup.photos?.[0]?.imageBase64 ?? sourceLookup.frame.imageBase64,
    source, guard: { ...guard, lookupId: sourceLookup.id } };
}
function record(count = 2): ComponentMapRecord {
  return {
    document: { version: 3, id: lookup.id, overview: { lookupId: lookup.id, photoId: "bay", source: { ...source } },
      components: Array.from({ length: count }, (_, index) => ({ id: uuid(index + 1), label: `Component ${index + 1}`, status: "needs_view", notes: "", scanGroups: [], region: { sourcePhotoId: "bay", box } })),
    },
    localRevision: 1, cloudRevision: null, syncedLocalRevision: 0,
  };
}
let listener: ((mapId: string) => void) | undefined;
let sourceListener: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  setActiveAccount("map-owner");
  listener = undefined;
  sourceListener = undefined;
  mocks.areaApply = undefined;
  mocks.subscribe.mockImplementation((callback) => { listener = callback; return vi.fn(); });
  mocks.subscribeLookups.mockImplementation((callback) => { sourceListener = callback; return vi.fn(); });
  mocks.resolveOverview.mockImplementation(async (sourceLookup: Lookup, document?: ComponentMap): Promise<MapOverviewVerification> => {
    const image = sourceLookup.photos?.[0]?.imageBase64 ?? sourceLookup.frame.imageBase64;
    if (!image.startsWith("data:image/")) return { status: "verification_unavailable", message: "Saved overview image unavailable." };
    if (document && document.version !== 3 && document.version !== 4) return { status: "legacy_unverified", message: "Legacy overview source is unverified.", image };
    return verified(sourceLookup);
  });
  mocks.read.mockResolvedValue(record());
  mocks.loadCloud.mockResolvedValue({ ok: true, value: null, message: "No cloud map." });
  mocks.create.mockImplementation(async (document: ComponentMap) => ({ document, localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 }));
  mocks.update.mockImplementation(async (_id: string, revision: number, document: ComponentMap) => ({ document, localRevision: revision + 1, cloudRevision: null, syncedLocalRevision: 0 }));
  mocks.readLookup.mockResolvedValue({ ok: true, value: null });
  mocks.readLocalLookup.mockReturnValue(null);
});
afterEach(() => vi.unstubAllEnvs());
async function ready(saved = record()) {
  mocks.read.mockResolvedValue(saved);
  const rendered = render(<ComponentMapReview lookup={lookup} />);
  await screen.findByLabelText("Component label");
  await sourceReady();
  return rendered;
}
async function sourceReady() {
  await waitFor(() => expect(screen.getByLabelText("Overview source verification")).not.toHaveTextContent("Checking the saved original overview"));
}
async function createReady() {
  const button = await screen.findByRole("button", { name: "Create component map" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("ComponentMapReview", () => {
  it("opens bound v4 originals in the map and preserves their binding through a guarded note save", async () => {
    const saved = record(); saved.document.version = 4;
    const binding = { version: 1 as const, photoRelationship: "independent" as const, photos: [{ photoId: "detail", label: "close_up" as const, source }] };
    saved.document.components[0].scanGroups = [{ linkId: uuid(500), lookupId: "component-scan", photoIds: ["detail"], binding }];
    mocks.resolveLinked.mockResolvedValue({ legacy: false, photoRelationship: "independent", photos: [{ photoId: "detail", status: "missing_photo", message: "Original linked photo is missing." }] });
    await ready(saved);
    expect(screen.getByRole("button", { name: "Adjust map area" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Open photo group 1 (1 photos)" }));
    expect(await screen.findByText("Original linked photo is missing.")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.readLookup).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Component notes"), { target: { value: "Retain the original linkage." } });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Map saved on this device.");
    expect(mocks.update.mock.calls[0][2].components[0].scanGroups[0].binding).toEqual(binding);
    expect(mocks.update.mock.calls[0][4]).toEqual(expect.objectContaining(guard));
  });

  it.each([1, 2] as const)("keeps version %s notes editable without displaying or adjusting unverified legacy areas", async (version) => {
    const saved = record(); saved.document.version = version;
    delete saved.document.overview.source;
    await ready(saved);
    expect(screen.getByLabelText("Unannotated original overview")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select component 1:/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adjust map area" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Component notes"), { target: { value: "Historical note retained." } });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Map saved on this device.");
    const stored = mocks.update.mock.calls[0][2] as ComponentMap;
    expect(stored.version).toBe(version);
    expect(stored.overview).not.toHaveProperty("source");
    expect(stored.components[0]).toMatchObject({ notes: "Historical note retained.", region: saved.document.components[0].region });
    expect(mocks.update.mock.calls[0][4]).toBeUndefined();
  });

  it.each(["source_changed", "missing_photo"] as const)("cancels an open area editor on a %s source event while retaining human notes", async (status) => {
    await ready();
    fireEvent.change(screen.getByLabelText("Component notes"), { target: { value: "Do not lose my note." } });
    await userEvent.click(screen.getByRole("button", { name: "Adjust map area" }));
    expect(screen.getByRole("slider", { name: "Selection x" })).toBeInTheDocument();
    mocks.assertOverview.mockImplementation(() => { throw new Error("Saved overview changed."); });
    mocks.resolveOverview.mockResolvedValue({ status, message: "Saved overview no longer matches this map." });
    await act(async () => { sourceListener?.(); });
    await sourceReady();
    expect(screen.queryByRole("slider", { name: "Selection x" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select component 1:/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adjust map area" })).toBeDisabled();
    expect(screen.getByLabelText("Component notes")).toHaveValue("Do not lose my note.");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("hides the old image and overlays immediately when a same-ID lookup supplies changed pixels", async () => {
    const view = await ready();
    const pending = deferred<MapOverviewVerification>();
    mocks.resolveOverview.mockReturnValue(pending.promise);
    const changed = { ...lookup, photos: lookup.photos!.map((photo) => ({ ...photo, imageBase64: "data:image/png;base64,changed" })) };
    view.rerender(<ComponentMapReview lookup={changed} />);
    expect(screen.queryByRole("img", { name: "Original component overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select component 1:/ })).not.toBeInTheDocument();
    await act(async () => { pending.resolve({ status: "source_changed", message: "Saved pixels changed." }); });
    expect(screen.getByLabelText("Overview source verification")).toHaveTextContent("Saved pixels changed.");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("keeps the edited draft and blocks the write when save-time source verification fails", async () => {
    await ready();
    fireEvent.change(screen.getByLabelText("Component notes"), { target: { value: "Unsaved inspection note." } });
    mocks.resolveOverview.mockResolvedValue({ status: "source_changed", message: "The saved overview was replaced." });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("status")).toHaveTextContent("The saved overview was replaced.");
    expect(screen.getByLabelText("Component notes")).toHaveValue("Unsaved inspection note.");
    expect(screen.queryByRole("button", { name: /Select component 1:/ })).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("applies an area using its retained source guard and component UUID, ignoring an obsolete editor callback", async () => {
    const checked = verified(); mocks.resolveOverview.mockResolvedValue(checked);
    await ready();
    await userEvent.click(screen.getByRole("button", { name: "Adjust map area" }));
    const obsoleteApply = mocks.areaApply!;
    await userEvent.click(within(screen.getByRole("list", { name: "Mapped components" })).getByRole("button", { name: /Component 2/ }));
    await userEvent.click(screen.getByRole("button", { name: "Adjust map area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "40" } });
    const callsBeforeObsolete = mocks.assertOverview.mock.calls.length;
    act(() => { obsoleteApply({ ...box, x: 0.7 }); });
    expect(mocks.assertOverview).toHaveBeenCalledTimes(callsBeforeObsolete);
    expect(screen.getByRole("slider", { name: "Selection x" })).toHaveValue("40");
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    expect(mocks.assertOverview.mock.lastCall?.[0]).toBe(checked.guard);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Map saved on this device.");
    const stored = mocks.update.mock.calls[0][2] as ComponentMap;
    expect(stored.components[0]).toEqual(record().document.components[0]);
    expect(stored.components[1]).toMatchObject({ id: uuid(2), region: { box: { ...box, x: 0.4, confidence: 0 } } });
    expect(mocks.update.mock.calls[0][4]).toBe(checked.guard);
  });

  it("rejects Apply when the source changes without a notification", async () => {
    await ready();
    fireEvent.change(screen.getByLabelText("Component notes"), { target: { value: "Keep human observations." } });
    await userEvent.click(screen.getByRole("button", { name: "Adjust map area" }));
    fireEvent.change(screen.getByRole("slider", { name: "Selection x" }), { target: { value: "40" } });
    mocks.assertOverview.mockImplementation(() => { throw new Error("Source changed before area application."); });
    mocks.resolveOverview.mockResolvedValue({ status: "source_changed", message: "Source no longer matches." });
    await userEvent.click(screen.getByRole("button", { name: "Apply area" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Source changed before area application.");
    expect(screen.getByLabelText("Component notes")).toHaveValue("Keep human observations.");
    expect(screen.queryByRole("button", { name: /Select component 1:/ })).not.toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(["account change", "unmount"])("ignores delayed verification after %s", async (event) => {
    const pending = deferred<MapOverviewVerification>();
    mocks.resolveOverview.mockReturnValue(pending.promise);
    const view = render(<ComponentMapReview lookup={lookup} />);
    await waitFor(() => expect(mocks.resolveOverview).toHaveBeenCalled());
    const signal = mocks.resolveOverview.mock.lastCall![3] as AbortSignal;
    if (event === "account change") setActiveAccount("different-owner"); else view.unmount();
    await act(async () => { pending.resolve(verified()); });
    expect(screen.queryByRole("img", { name: "Original component overview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Select component 1:/ })).not.toBeInTheDocument();
    if (event === "unmount") expect(signal.aborted).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });

  it("retains committed notes and the original binding when the source changes during commit", async () => {
    await ready();
    const pending = deferred<ComponentMapRecord>(); mocks.update.mockReturnValue(pending.promise);
    fireEvent.change(screen.getByLabelText("Component notes"), { target: { value: "Already committed human note." } });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    const document = mocks.update.mock.calls[0][2] as ComponentMap;
    mocks.assertOverview.mockImplementation(() => { throw new Error("Changed after commit."); });
    mocks.resolveOverview.mockResolvedValue({ status: "source_changed", message: "Saved source is now different." });
    await act(async () => { pending.resolve({ ...record(), document, localRevision: 2 }); });
    expect(await screen.findByRole("status")).toHaveTextContent("Map saved with its original source binding, but the overview changed during completion.");
    await sourceReady();
    expect(document.overview.source).toEqual(source);
    expect(screen.getByLabelText("Component notes")).toHaveValue("Already committed human note.");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Select component 1:/ })).not.toBeInTheDocument();
  });

  it.each(["success", "revision rejection"])("does not alter a newly opened map after a delayed save %s from the previous lookup", async (outcome) => {
    const view = await ready();
    const pending = deferred<ComponentMapRecord>(); mocks.update.mockReturnValue(pending.promise);
    fireEvent.change(screen.getByLabelText("Component notes"), { target: { value: "Saved for scan A." } });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    const firstDocument = mocks.update.mock.calls[0][2] as ComponentMap;
    const otherLookup = { ...lookup, id: "other-overview" };
    const other = record(); other.document.id = otherLookup.id; other.document.overview.lookupId = otherLookup.id;
    other.document.components[0].label = "Other scan component";
    mocks.read.mockResolvedValue(other);
    view.rerender(<ComponentMapReview lookup={otherLookup} />);
    await waitFor(() => expect(screen.getByLabelText("Component label")).toHaveValue("Other scan component"));
    await act(async () => {
      if (outcome === "success") pending.resolve({ ...record(), document: firstDocument, localRevision: 2 });
      else pending.reject(new ComponentMapError("stale_revision", "Previous map save was rejected."));
    });
    expect(screen.getByLabelText("Component label")).toHaveValue("Other scan component");
    expect(screen.getByLabelText("Component notes")).toHaveValue("");
    expect(screen.queryByText("Map saved on this device.")).not.toBeInTheDocument();
    expect(screen.queryByText("Previous map save was rejected.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load saved map and keep draft" })).not.toBeInTheDocument();
  });

  it.each([
    ["sync", "success"], ["sync", "failure"],
    ["conflict", "success"], ["conflict", "failure"],
  ] as const)("ignores delayed cloud %s %s after opening another scan", async (action, outcome) => {
    const saved = record();
    if (action === "conflict") saved.conflict = { document: structuredClone(saved.document), revision: 2 };
    const view = await ready(saved);
    const pending = deferred<{ ok: true; value: ComponentMapRecord; message: string }>();
    if (action === "sync") mocks.syncCloud.mockReturnValue(pending.promise);
    else mocks.resolveCloud.mockReturnValue(pending.promise);
    await userEvent.click(screen.getByRole("button", { name: action === "sync" ? "Save map to cloud" : "Use cloud version" }));
    await waitFor(() => expect(action === "sync" ? mocks.syncCloud : mocks.resolveCloud).toHaveBeenCalledOnce());
    const otherLookup = { ...lookup, id: "other-cloud-overview" };
    const other = record(); other.document.id = otherLookup.id; other.document.overview.lookupId = otherLookup.id;
    other.document.components[0].label = "Current scan cloud component";
    mocks.read.mockResolvedValue(other);
    view.rerender(<ComponentMapReview lookup={otherLookup} />);
    await waitFor(() => expect(screen.getByLabelText("Component label")).toHaveValue("Current scan cloud component"));
    const previousCloud = record(); previousCloud.document.components[0].label = "Previous scan cloud component";
    await act(async () => {
      if (outcome === "success") pending.resolve({ ok: true, value: previousCloud, message: "Previous scan cloud result." });
      else pending.reject(new Error("Previous scan cloud failure."));
    });
    expect(screen.getByLabelText("Component label")).toHaveValue("Current scan cloud component");
    expect(screen.queryByText("Previous scan cloud result.")).not.toBeInTheDocument();
    expect(screen.queryByText("Previous scan cloud failure.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load saved map and keep draft" })).not.toBeInTheDocument();
  });

  it.each(["success", "failure"])("ignores a linked-photo read %s from the previously opened scan", async (outcome) => {
    const saved = record();
    saved.document.components[0].scanGroups = [{ linkId: uuid(500), lookupId: "previous-detail", photoIds: ["detail"] }];
    const pending = deferred<{ ok: true; value: Lookup }>();
    mocks.readLookup.mockReturnValue(pending.promise);
    const view = await ready(saved);
    await userEvent.click(screen.getByRole("button", { name: "Open photo group 1 (1 photos)" }));
    await waitFor(() => expect(mocks.readLookup).toHaveBeenCalledOnce());
    const otherLookup = { ...lookup, id: "other-linked-overview" };
    const other = record(); other.document.id = otherLookup.id; other.document.overview.lookupId = otherLookup.id;
    other.document.components[0].label = "Current scan linked component";
    mocks.read.mockResolvedValue(other);
    view.rerender(<ComponentMapReview lookup={otherLookup} />);
    await waitFor(() => expect(screen.getByLabelText("Component label")).toHaveValue("Current scan linked component"));
    await act(async () => {
      if (outcome === "success") pending.resolve({ ok: true, value: { ...lookup, id: "previous-detail", photos: [{ ...lookup.photos![0], id: "detail" }] } });
      else pending.reject(new Error("Previous scan linked-photo failure."));
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Component label")).toHaveValue("Current scan linked component");
    expect(screen.queryByText("Previous scan linked-photo failure.")).not.toBeInTheDocument();
  });

  it("creates separate same-name scene suggestions and retains their identity and provenance through editing and reopening", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    mocks.read.mockResolvedValue(null);
    const source: Lookup = { ...lookup, focusBox: box, result: {
      partName: "Alternator", sceneObjects: [
        { name: "Alternator", category: "electrical", primary: true, regionLabel: "front center" },
        { name: "Hose", category: "engine", primary: false, regionLabel: "upper left" },
        { name: "Hose", category: "engine", primary: false, regionLabel: "lower right" },
      ],
    } as NonNullable<Lookup["result"]> };
    const view = render(<ComponentMapReview lookup={source} />);
    await createReady();
    await screen.findByLabelText("Component label");
    const created = (await mocks.create.mock.results[0].value) as ComponentMapRecord;
    expect(created.document.version).toBe(3);
    const hoses = created.document.components.filter((component) => component.label === "Hose");
    expect(hoses).toHaveLength(2);
    expect(new Set(hoses.map((component) => component.id)).size).toBe(2);
    expect(hoses.every((component) => !component.region && component.status === "needs_view" && !component.notes)).toBe(true);
    await userEvent.click(within(screen.getByRole("list", { name: "Mapped components" })).getByRole("button", { name: /Hose.*upper left/ }));
    expect(screen.getByLabelText("AI-suggested location")).toHaveTextContent("upper left");
    expect(screen.getByLabelText("Component notes")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("Component notes"), "Owner note: need a closer view.");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Map saved on this device.");
    const saved = (await mocks.update.mock.results[0].value) as ComponentMapRecord;
    expect(saved.document.components.find((component) => component.id === hoses[0].id)).toEqual({ ...hoses[0], notes: "Owner note: need a closer view." });
    expect(saved.document.components.find((component) => component.id === hoses[1].id)).toEqual(hoses[1]);
    view.unmount();
    mocks.read.mockResolvedValue(saved);
    render(<ComponentMapReview lookup={source} />);
    await screen.findByLabelText("Component label");
    const list = within(screen.getByRole("list", { name: "Mapped components" }));
    await userEvent.click(list.getByRole("button", { name: /Hose.*lower right/ }));
    expect(screen.getByLabelText("AI-suggested location")).toHaveTextContent("lower right");
    expect(screen.getByLabelText("Component notes")).toHaveValue("");
    await userEvent.click(list.getByRole("button", { name: /Hose.*upper left/ }));
    expect(screen.getByLabelText("Component notes")).toHaveValue("Owner note: need a closer view.");
    expect(screen.getByLabelText("Your review status")).toHaveValue("needs_view");
  });

  it("shows unverified AI locations in conflict previews separately from notes", async () => {
    const saved = record();
    saved.document.components[0].suggestedLocation = { source: "ai_scene", text: "near the intake" };
    saved.conflict = { document: structuredClone(saved.document), revision: 2 };
    saved.conflict.document.components[0].suggestedLocation!.text = "behind the intake";
    saved.conflict.document.components[0].notes = "Human note in the cloud version";
    await ready(saved);
    expect(screen.getByLabelText("AI-suggested location")).toHaveTextContent("near the intake");
    await userEvent.click(screen.getByText("Review cloud version"));
    expect(screen.getByText("AI-suggested location — unverified: behind the intake")).toBeVisible();
    expect(screen.getByText("Human note in the cloud version")).toBeVisible();
    expect(screen.getByLabelText("Component notes")).toHaveValue("");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("skips cloud fallback and creates and edits a local map when cloud sync is off", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    mocks.read.mockResolvedValue(null);
    render(<ComponentMapReview lookup={lookup} />);
    await createReady();
    await screen.findByLabelText("Component label");
    expect(screen.getByText(/Cloud sync is off/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save map to cloud" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Component notes"), { target: { value: "Device-only review note" } });
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][2].components[0].notes).toBe("Device-only review note");
    expect(mocks.loadCloud).not.toHaveBeenCalled();
    expect(mocks.syncCloud).not.toHaveBeenCalled();
    expect(mocks.resolveCloud).not.toHaveBeenCalled();
  });

  it("opens device photo groups and preserves earlier cloud acknowledgement while sync is off", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    const saved = record();
    saved.cloudRevision = 4; saved.syncedLocalRevision = saved.localRevision;
    saved.document.components[0].scanGroups = [{ linkId: uuid(90), lookupId: "detail-scan", photoIds: ["bay"] }];
    mocks.readLocalLookup.mockReturnValue({ ...lookup, id: "detail-scan" });
    await ready(saved);
    expect(screen.getByText(/This map version was previously saved to cloud/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open photo group 1 (1 photos)" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/result/detail-scan", expect.anything()));
    expect(mocks.readLocalLookup).toHaveBeenCalledWith("detail-scan");
    expect(mocks.readLookup).not.toHaveBeenCalled();
    expect(mocks.loadCloud).not.toHaveBeenCalled();
    expect(mocks.syncCloud).not.toHaveBeenCalled();
  });

  it("retains cloud conflict evidence without resolving it while sync is off", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    const saved = record(); saved.conflict = { document: record(3).document, revision: 2 };
    await ready(saved);
    expect(screen.getByText("Cloud map differs")).toBeInTheDocument();
    for (const name of ["Save map to cloud", "Keep device version", "Use cloud version"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled(); await userEvent.click(button);
    }
    expect(screen.getByLabelText("Component notes")).toBeEnabled();
    expect(mocks.resolveCloud).not.toHaveBeenCalled(); expect(mocks.syncCloud).not.toHaveBeenCalled();
  });

  it("does not render signed overview URLs or open remote-only photo groups while sync is off", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    const saved = record();
    saved.document.components[0].scanGroups = [{ linkId: uuid(90), lookupId: "detail-scan", photoIds: ["bay"] }];
    mocks.read.mockResolvedValue(saved);
    const remote = { ...lookup, photos: lookup.photos!.map((photo) => ({ ...photo, imageBase64: "https://example.com/signed-photo" })) };
    mocks.readLocalLookup.mockReturnValue({ ...remote, id: "detail-scan" });
    render(<ComponentMapReview lookup={remote} />);
    await screen.findByLabelText("Component label");
    expect(screen.queryByRole("img", { name: "Original component overview" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Component notes")).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Open photo group 1 (1 photos)" }));
    expect(await screen.findByText("Linked scan or photos unavailable. The map link has been kept.")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.readLookup).not.toHaveBeenCalled();
  });

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
    await createReady();
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
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(lookup.id, 2, expect.any(Object), expect.objectContaining({ userId: "map-owner" }), expect.objectContaining(guard)));
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
    await sourceReady();
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

import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeComponentMapRecord } from "../lib/componentMap";
import type { Lookup, IsolatedObject } from "../types";
import type { ComponentMapRecord } from "../types/componentMap";
import type { InspectionReportIssue, InspectionReportSnapshot } from "../types/inspectionReport";
import { getAuthClient } from "./auth";
import { isCloudSyncEnabled } from "./cloudSyncPolicy";
import { readCloudLookupForReport, type ReportUnavailableImage } from "./cloudHistory";
import { readComponentMap } from "./componentMapStore";
import { getLookup, readLookups } from "./storage";
import { mergeServiceRecords, normalizeServiceRecords } from "../lib/serviceRecord";
import { readServiceRecords } from "./serviceRecordStore";
import { readCloudServiceRecords } from "./serviceRecordCloud";
import { readFinalInspectionSnapshot, type FinalInspectionSnapshot } from "./inspectionReportSnapshot";
import { mergeInspectionComparisons, normalizeInspectionComparisons, comparisonSideMatches, normalizeComparisonTimestamp } from "../lib/inspectionComparison";
import { readInspectionComparisons } from "./inspectionComparisonStore";
import { readCloudInspectionComparisons } from "./inspectionComparisonCloud";
import { comparisonSideForLookup, comparisonPhotos } from "./comparisonEvidence";
import { mergeDiagnosticBundles, normalizeDiagnosticBundle } from "../lib/diagnosticAssociation";
import { verifyDiagnosticDocument } from "../lib/diagnosticReport";
import { readDiagnosticBundle } from "./diagnosticReportStore";
import { readCloudDiagnosticBundle } from "./diagnosticReportCloud";
import { verifyMapOverviewImage } from "./mapOverviewEvidence";

export const INSPECTION_REPORT_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const INSPECTION_REPORT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const INSPECTION_REPORT_MAX_SCANS = 250;
const MAX_IMAGE_SLOTS = 2000;
const REQUEST_TIMEOUT_MS = 20_000;
const ID = /^[A-Za-z0-9._:-]{1,160}$/;
const PHOTO_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const RASTER = /^image\/(jpeg|png|webp)$/;
type CollectOptions = { signal?: AbortSignal; onProgress?: (message: string) => void };
type ImageSlot = { source: string; issue: Omit<InspectionReportIssue, "message">; replace: (value: string) => void; refreshed: (remote: Lookup) => string | undefined };
class ReportError extends Error {
  constructor(public fatal: boolean, message: string) { super(message); this.name = "InspectionReportError"; }
}
const limitError = () => new ReportError(true, "This report exceeds its evidence limit (12 MiB per image, 32 MiB total, 250 scans, or 2,000 image fields). Export a smaller inspection; no partial report was prepared.");
const staleError = () => new ReportError(true, "Saved inspection records changed while preparing this report. Save your changes, then prepare it again.");

/** Collect saved evidence only. This function never saves, uploads or resolves records. */
export async function collectInspectionReport(rootLookupId: string, options: CollectOptions = {}, scope: AccountScope = getAccountScope()): Promise<InspectionReportSnapshot> {
  const check = () => {
    if (options.signal?.aborted) throw new ReportError(true, "Report preparation was canceled.");
    if (!isAccountScopeCurrent(scope)) throw new ReportError(true, "Account changed. Reopen the saved inspection in its original account before exporting.");
  };
  const wait = async <T>(operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> => {
    check();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        cancel = () => { controller.abort(); reject(new ReportError(true, "Report preparation was canceled.")); };
        options.signal?.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(() => { controller.abort(); reject(new ReportError(false, "An evidence request timed out.")); }, REQUEST_TIMEOUT_MS);
      });
      const value = await Promise.race([Promise.resolve(operation(controller.signal)), deadline]);
      check();
      return value;
    } finally { clearTimeout(timer); if (cancel) options.signal?.removeEventListener("abort", cancel); }
  };
  const progress = (message: string) => { check(); options.onProgress?.(message); check(); };
  const rethrowFatal = (error: unknown) => { check(); if (error instanceof ReportError && error.fatal) throw error; };
  check();
  if (!ID.test(rootLookupId)) throw new ReportError(true, "Reopen a valid saved scan before preparing its report.");
  const initialRead = readLookups();
  if (!initialRead.ok) throw new ReportError(true, "Saved scans could not be read safely. Reopen DeepSpec and retry without clearing its browser data.");
  const initialLookups = structuredClone(initialRead.value);
  const localSignatures = new Map<string, string>();
  const localLookup = (id: string) => {
    const value = getLookup(id, initialLookups);
    localSignatures.set(id, JSON.stringify(value));
    return value ? structuredClone(value) : null;
  };
  const rootLocal = localLookup(rootLookupId);
  progress("Reading the saved inspection and component map…");
  let initialMap: ComponentMapRecord | null;
  try { initialMap = structuredClone(await wait(() => readComponentMap(rootLookupId, scope))); }
  catch (error) { rethrowFatal(error); throw new ReportError(true, "The saved component map could not be read safely. Reopen the inspection and retry."); }
  const mapSignature = JSON.stringify(initialMap);
  const missing: InspectionReportIssue[] = [];
  let map = initialMap;
  const configuredOrigin = storageOrigin();
  if (!map && !isCloudSyncEnabled()) missing.push({ kind: "map", lookupId: rootLookupId, message: "Cloud history is off for this build. Any cloud-only component map and links are not included." });
  if (!map && configuredOrigin) {
    try {
      const client = await wait(() => getAuthClient());
      if (!client) throw new Error();
      const user = await wait(() => client.auth.getUser());
      if (user.error || user.data.user?.id !== scope.userId) throw new Error();
      const response = await wait((signal) => client.from("component_maps").select("map_id,document_json,revision")
        .eq("user_id", scope.userId).eq("map_id", rootLookupId).abortSignal(signal).maybeSingle());
      if (response.error) throw new Error();
      if (response.data) {
        map = normalizeComponentMapRecord({ document: response.data.document_json, localRevision: 1,
          cloudRevision: response.data.revision, syncedLocalRevision: 1 }) ?? null;
        if (!map || map.document.id !== rootLookupId || response.data.map_id !== rootLookupId) throw new Error();
      }
    } catch (error) {
      rethrowFatal(error); map = null;
      missing.push({ kind: "map", lookupId: rootLookupId, message: "The cloud component map could not be checked. Any cloud-only component links are not included." });
    }
  }
  if (map?.conflict) missing.push({ kind: "map", lookupId: rootLookupId, message: "This component map has an unresolved cloud conflict. The report uses the saved device version; the alternative version was not combined with it." });
  const references = new Map<string, Set<string>>([[rootLookupId, new Set()]]);
  if (map) {
    const add = (id: string, photos: string[]) => {
      if (!ID.test(id) || photos.some((photo) => !PHOTO_ID.test(photo))) throw new ReportError(true, "A saved component link is invalid. Review the map before exporting.");
      const ids = references.get(id) ?? new Set<string>();
      photos.forEach((photo) => ids.add(photo)); references.set(id, ids);
      if (references.size > INSPECTION_REPORT_MAX_SCANS) throw limitError();
    };
    add(map.document.overview.lookupId, [map.document.overview.photoId]);
    for (const component of map.document.components) for (const group of component.scanGroups) add(group.lookupId, group.photoIds);
  }
  const remoteCache = new Map<string, Lookup | null>();
  const unavailableRemoteImages = new Map<string, ReportUnavailableImage[]>();
  const remoteLookup = async (id: string) => {
    if (!isCloudSyncEnabled()) return null;
    if (remoteCache.has(id)) return remoteCache.get(id)!;
    try {
      const result = await wait(() => readCloudLookupForReport(id));
      const value = result.ok && result.value?.id === id ? structuredClone(result.value) : null;
      if (result.ok && value) unavailableRemoteImages.set(id, result.unavailableImages);
      remoteCache.set(id, value); return value;
    } catch (error) { rethrowFatal(error); remoteCache.set(id, null); return null; }
  };
  let embeddedBytes = 0, imageSlots = 0, diagnosticBytes = 0;
  const scans: Lookup[] = [];
  const serviceLogs: NonNullable<InspectionReportSnapshot["serviceLogs"]> = [];
  const serviceSignatures = new Map<string, string | null>();
  const comparisonLogs: NonNullable<InspectionReportSnapshot["comparisonLogs"]> = [];
  const comparisonEvidence: NonNullable<InspectionReportSnapshot["comparisonEvidence"]> = [];
  const comparisonSignatures = new Map<string, string | null>();
  const diagnosticLogs: NonNullable<InspectionReportSnapshot["diagnosticLogs"]> = [];
  const diagnosticEvidence: NonNullable<InspectionReportSnapshot["diagnosticEvidence"]> = [];
  const diagnosticSignatures = new Map<string, string | null>();
  const embedded = new Map<string, { data: string; size: number }>();
  const embed = async (source: string, lookupId: string) => {
    let image = embedded.get(source);
    if (!image) {
      if (source.startsWith("data:")) image = decodeRaster(source);
      else {
        if (!ownedSignedUrl(source, lookupId, scope.userId!, configuredOrigin)) throw new Error();
        image = await wait(async (signal) => {
          const response = await fetch(source, { signal, credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store" });
          check();
          if (!response.ok || response.redirected) throw new Error();
          const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
          if (!RASTER.test(mime)) throw new Error();
          const length = Number(response.headers.get("content-length"));
          if (Number.isFinite(length) && length > INSPECTION_REPORT_MAX_IMAGE_BYTES) throw limitError();
          if (!response.body) throw new Error();
          const reader = response.body.getReader();
          const cancelRead = () => { void reader.cancel().catch(() => undefined); };
          signal.addEventListener("abort", cancelRead, { once: true });
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            while (true) {
              const chunk = await reader.read(); check();
              if (signal.aborted) throw new Error();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > INSPECTION_REPORT_MAX_IMAGE_BYTES || embeddedBytes + diagnosticBytes + size > INSPECTION_REPORT_MAX_TOTAL_BYTES) throw limitError();
              chunks.push(chunk.value);
            }
          } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
          finally { signal.removeEventListener("abort", cancelRead); reader.releaseLock(); }
          const bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          if (!validRaster(bytes, mime)) throw new Error();
          return { data: `data:${mime};base64,${toBase64(bytes)}`, size };
        });
      }
      // MIME/signature checks prevent other content types; the browser decoder also
      // rejects damaged raster payloads before the report can claim they are embedded.
      await wait((signal) => verifyDecodedRaster(image!.data, signal));
      embedded.set(source, image);
    }
    if (embeddedBytes + diagnosticBytes + image.size > INSPECTION_REPORT_MAX_TOTAL_BYTES) throw limitError();
    // Count every embedded field, including a repeated cover, to bound the snapshot.
    embeddedBytes += image.size;
    return image.data;
  };

  for (const [id, expectedPhotos] of references) {
    check(); progress(`Preparing saved scan ${scans.length + 1} of ${references.size}…`);
    let diagnostics = { documents: [], associations: [] } as NonNullable<InspectionReportSnapshot["diagnosticLogs"]>[number]["bundle"];
    let diagnosticCloudChecked = false;
    try {
      diagnostics = await wait(() => readDiagnosticBundle(id, scope));
      diagnosticSignatures.set(id, JSON.stringify(diagnostics));
    } catch (error) {
      rethrowFatal(error); diagnosticSignatures.set(id, null);
      missing.push({ kind: "diagnostics", lookupId: id, message: "Device diagnostic reports could not be read or verified. Their absence does not mean this vehicle has no codes." });
    }
    if (configuredOrigin) {
      try {
        diagnostics = mergeDiagnosticBundles(diagnostics, await wait((signal) => readCloudDiagnosticBundle(id, scope, signal)), id);
        diagnosticCloudChecked = true;
      } catch (error) {
        rethrowFatal(error);
        missing.push({ kind: "diagnostics", lookupId: id, message: "Cloud diagnostic evidence could not be verified or combined. Available device originals and associations remain included." });
      }
    }
    const diagnosticLog: NonNullable<InspectionReportSnapshot["diagnosticLogs"]>[number] = { lookupId: id, bundle: structuredClone(diagnostics), parsed: [], cloudChecked: diagnosticCloudChecked };
    for (const document of diagnostics.documents) diagnosticLog.parsed.push({ id: document.id, report: await wait(() => verifyDiagnosticDocument(document)) });
    diagnosticBytes += new TextEncoder().encode(JSON.stringify(diagnosticLog)).byteLength;
    if (embeddedBytes + diagnosticBytes > INSPECTION_REPORT_MAX_TOTAL_BYTES) throw limitError();
    diagnosticLogs.push(diagnosticLog);
    let comparisons: NonNullable<InspectionReportSnapshot["comparisonLogs"]>[number]["records"] = [];
    let comparisonsCloudChecked = false;
    try {
      const records = normalizeInspectionComparisons(await wait(() => readInspectionComparisons(id, scope)), id);
      if (!records) throw new Error();
      comparisons = structuredClone(records);
      comparisonSignatures.set(id, JSON.stringify(records));
    } catch (error) {
      rethrowFatal(error); comparisonSignatures.set(id, null);
      missing.push({ kind: "comparisons", lookupId: id, message: "Dated comparisons on this device could not be read. Their absence from this report does not mean none exist." });
    }
    if (configuredOrigin) {
      try {
        comparisons = mergeInspectionComparisons(comparisons, await wait((signal) => readCloudInspectionComparisons(id, scope, signal)), id);
        comparisonsCloudChecked = true;
      } catch (error) {
        rethrowFatal(error);
        missing.push({ kind: "comparisons", lookupId: id, message: "Cloud comparison history could not be checked or combined safely. Available device records are included; additional entries or conflicting copies may be missing." });
      }
    }
    comparisonLogs.push({ lookupId: id, records: structuredClone(comparisons), cloudChecked: comparisonsCloudChecked });
    // Map iteration visits newly discovered reference scans once, including a
    // comparison's older history. A cycle cannot loop and the same report limits apply.
    for (const record of comparisons) for (const side of [record.earlier, record.current]) {
      const ids = references.get(side.lookupId) ?? new Set<string>();
      ids.add(side.photoId); references.set(side.lookupId, ids);
      if (references.size > INSPECTION_REPORT_MAX_SCANS) throw limitError();
    }
    const local = id === rootLookupId ? rootLocal : localLookup(id);
    const source = local ?? await remoteLookup(id); check();
    let serviceRecords: NonNullable<InspectionReportSnapshot["serviceLogs"]>[number]["records"] = [];
    let cloudChecked = false;
    try {
      const records = await wait(() => readServiceRecords(id, scope));
      const checked = normalizeServiceRecords(records, id);
      if (!checked) throw new Error();
      serviceRecords = structuredClone(checked);
      serviceSignatures.set(id, JSON.stringify(checked));
    } catch (error) {
      rethrowFatal(error);
      serviceSignatures.set(id, null);
      missing.push({ kind: "service_records", lookupId: id, message: "Human measurement, repair and follow-up records on this device could not be read. Their absence from this report does not mean none exist." });
    }
    if (configuredOrigin) {
      try {
        const cloud = await wait((signal) => readCloudServiceRecords(id, scope, signal));
        serviceRecords = mergeServiceRecords(serviceRecords, cloud, id);
        cloudChecked = true;
      } catch (error) {
        rethrowFatal(error);
        missing.push({ kind: "service_records", lookupId: id, message: "Cloud human-service history could not be checked or combined safely. Available device records are included; cloud-only entries and conflicting copies may be missing." });
      }
    }
    serviceLogs.push({ lookupId: id, records: structuredClone(serviceRecords), cloudChecked });
    if (!source) {
      if (id === rootLookupId) throw new ReportError(true, "This saved scan is unavailable. Reopen it from Saved scans before exporting.");
      missing.push({ kind: "lookup", lookupId: id, message: "This linked saved scan is unavailable. Its component association and any available human-service history remain listed." });
      for (const photoId of new Set([...expectedPhotos, ...serviceRecords.flatMap((record) => record.photoIds)])) missing.push({ kind: "photo", lookupId: id, photoId, message: "The linked original photo is unavailable because its saved scan could not be loaded. Any human record keeps its original reference." });
      continue;
    }
    const scan = structuredClone(source);
    // A cloud-null cutout path means an intentional cleared selection. A non-null
    // path that could not be signed is separately reported, even though both use
    // an empty image field in the export-only projection.
    if (!local) for (const unavailable of unavailableRemoteImages.get(id) ?? []) if (unavailable.kind === "cutout") {
      missing.push({ ...unavailable, lookupId: id, message: "This saved selection image is unavailable in cloud storage. Its geometry and notes are preserved." });
    }
    const slots = imageReferences(scan);
    imageSlots += slots.length;
    if (imageSlots > MAX_IMAGE_SLOTS) throw limitError();
    const actualPhotos = new Set(scan.photos?.length ? scan.photos.map((photo) => photo.id) : ["photo-1"]);
    for (const photoId of new Set(serviceRecords.flatMap((record) => record.photoIds))) if (!actualPhotos.has(photoId)) missing.push({ kind: "photo", lookupId: id, photoId, message: "A human-service entry references this original photo, which is no longer present in the saved scan. The entry and its original reference are retained." });
    for (const photoId of expectedPhotos) if (!actualPhotos.has(photoId)) missing.push({ kind: "photo", lookupId: id, photoId, message: "This original photo ID is missing from the linked saved scan. A different photo was not substituted." });
    const needsRefresh = local && slots.some((slot) => ownedSignedUrl(slot.source, id, scope.userId!, configuredOrigin));
    const remote = needsRefresh ? await remoteLookup(id) : null; check();
    for (const slot of slots) {
      check();
      // Clear first, so failures can never leave a URL in the export snapshot.
      slot.replace("");
      if (!slot.source && slot.issue.kind === "cutout") continue;
      try {
        let image = slot.source;
        if (!image.startsWith("data:")) {
          const previous = ownedSignedUrl(image, id, scope.userId!, configuredOrigin);
          if (!previous) throw new Error();
          if (local) {
            const replacement = remote ? slot.refreshed(remote) : undefined;
            const fresh = replacement ? ownedSignedUrl(replacement, id, scope.userId!, configuredOrigin) : null;
            if (!fresh || fresh.origin !== previous.origin || fresh.pathname !== previous.pathname) throw new Error();
            image = replacement!;
          }
        }
        slot.replace(await embed(image, id)); check();
      } catch (error) {
        rethrowFatal(error);
        missing.push({ ...slot.issue, message: slot.issue.kind === "cutout"
          ? "This saved selection image could not be embedded or no longer matches its saved correction. Its geometry and notes are preserved."
          : "This original photo could not be safely embedded or its saved reference changed. A different image was not substituted." });
      }
    }
    scans.push(scan);
  }
  let mapOverviewEvidence: InspectionReportSnapshot["mapOverviewEvidence"];
  if (map) {
    progress("Checking the embedded component-map overview…");
    const overview = scans.find((entry) => entry.id === map!.document.overview.lookupId);
    if (map.document.version !== 3) {
      mapOverviewEvidence = { status: "legacy_unverified", message: "This legacy map has no recorded overview fingerprint. Its component records are retained, but historical map outlines cannot be verified and are hidden." };
    } else if (!overview) {
      mapOverviewEvidence = { status: "missing_photo", message: "The bound component-map overview is unavailable. Component records are retained and map outlines are hidden." };
    } else {
      try {
        // All image slots are already materialized. Verify the exact embedded
        // raster, never a fresh lookup or an alternate image with the same ID.
        const verified = await wait((signal) => verifyMapOverviewImage(overview, map!.document, scope, signal));
        mapOverviewEvidence = { status: verified.status, message: verified.message };
      } catch (error) {
        rethrowFatal(error);
        mapOverviewEvidence = { status: "verification_unavailable", message: "The embedded component-map overview could not be verified. Component records are retained and map outlines are hidden." };
      }
    }
    if (mapOverviewEvidence.status !== "unchanged") missing.push({ kind: "map", lookupId: map.document.overview.lookupId,
      photoId: map.document.overview.photoId, message: mapOverviewEvidence.message });
  }
  progress("Checking originals used by dated comparisons…");
  for (const log of comparisonLogs) for (const record of log.records) for (const sideName of ["earlier", "current"] as const) {
    const side = record[sideName];
    const scan = scans.find((entry) => entry.id === side.lookupId);
    const photo = scan && comparisonPhotos(scan).find((entry) => entry.id === side.photoId);
    let status: NonNullable<InspectionReportSnapshot["comparisonEvidence"]>[number]["status"] = "missing_photo";
    if (scan && photo?.imageBase64) {
      try {
        // Verify the frozen embedded source, not a fresh asynchronous lookup.
        const actual = await wait(() => comparisonSideForLookup(scan, side.photoId, scope));
        status = comparisonSideMatches(side, actual) ? "unchanged" : "source_changed";
      } catch (error) { rethrowFatal(error); status = "verification_unavailable"; }
    }
    comparisonEvidence.push({ lookupId: record.lookupId, recordId: record.id, side: sideName, status });
    if (status !== "unchanged") missing.push({ kind: "comparisons", lookupId: side.lookupId, photoId: side.photoId,
      message: status === "source_changed" ? "This photo or its saved context differs from the dated comparison. The historical record remains, but the current photo is not presented as its original evidence."
        : "The original referenced by a dated comparison could not be verified. Its recorded observation is retained without substituting another photo." });
  }
  for (const log of diagnosticLogs) for (const record of log.bundle.associations) for (const side of record.photos) {
    const scan = scans.find((entry) => entry.id === side.lookupId);
    const photo = scan && comparisonPhotos(scan).find((entry) => entry.id === side.photoId);
    let status: NonNullable<InspectionReportSnapshot["diagnosticEvidence"]>[number]["status"] = "missing_photo";
    if (scan && photo?.imageBase64) {
      try { status = comparisonSideMatches(side, await wait(() => comparisonSideForLookup(scan, side.photoId, scope))) ? "unchanged" : "source_changed"; }
      catch (error) { rethrowFatal(error); status = "verification_unavailable"; }
    }
    diagnosticEvidence.push({ lookupId: record.lookupId, recordId: record.id, photoId: side.photoId, status });
    if (status !== "unchanged") missing.push({ kind: "diagnostics", lookupId: side.lookupId, photoId: side.photoId,
      message: "A diagnostic association's original photo or saved context could not be verified. Its human notes are retained; the current photo is not substituted as original evidence." });
  }
  progress("Checking that saved records have not changed…");
  let finalSnapshot: FinalInspectionSnapshot;
  try { finalSnapshot = await wait(() => readFinalInspectionSnapshot(rootLookupId, [...references.keys()], scope)); }
  catch (error) { rethrowFatal(error); throw staleError(); }
  if (JSON.stringify(finalSnapshot.map) !== mapSignature) throw staleError();
  for (const [id, before] of serviceSignatures) {
    if (!finalSnapshot.serviceRecords.has(id)) throw staleError();
    const current = finalSnapshot.serviceRecords.get(id);
    if ((current === null ? null : JSON.stringify(current)) !== before) throw staleError();
  }
  for (const [id, before] of comparisonSignatures) {
    if (!finalSnapshot.comparisons.has(id)) throw staleError();
    const current = finalSnapshot.comparisons.get(id);
    if ((current === null ? null : JSON.stringify(current)) !== before) throw staleError();
  }
  for (const [id, before] of diagnosticSignatures) {
    if (!finalSnapshot.diagnostics.has(id)) throw staleError();
    const current = finalSnapshot.diagnostics.get(id);
    const normalized = current === null ? null : normalizeDiagnosticBundle(current, id);
    if ((normalized === null ? null : JSON.stringify(normalized)) !== before) throw staleError();
  }
  // No more asynchronous reads after the joint IDB snapshot. Read localStorage
  // synchronously so it cannot change while awaiting another history/map check.
  const finalRead = readLookups(); check();
  if (!finalRead.ok) throw staleError();
  for (const [id, before] of localSignatures) if (JSON.stringify(getLookup(id, finalRead.value)) !== before) throw staleError();
  check();
  return { version: 1, createdAt: new Date().toISOString(), rootLookupId, map: map ? structuredClone(map) : null,
    ...(mapOverviewEvidence ? { mapOverviewEvidence } : {}), scans, missing, embeddedBytes, serviceLogs, comparisonLogs, comparisonEvidence, diagnosticLogs, diagnosticEvidence };
}

function storageOrigin(): string | null {
  if (!isCloudSyncEnabled()) return null;
  try {
    const url = new URL(import.meta.env.VITE_SUPABASE_URL ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

function ownedSignedUrl(value: string, lookupId: string, owner: string, origin: string | null): URL | null {
  try {
    const url = new URL(value);
    const prefix = "/storage/v1/object/sign/scan-images/";
    if (!origin || url.protocol !== "https:" || url.origin !== origin || url.username || url.password || url.hash
      || !url.pathname.startsWith(prefix) || !url.searchParams.get("token")) return null;
    const segments = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent);
    if (segments.length < 3 || segments[0] !== owner || segments[1] !== lookupId
      || segments.some((part) => !part || part === "." || part === ".." || /[\\/%]/.test(part))) return null;
    return url;
  } catch { return null; }
}

function sameSelection(a: Pick<Lookup, "focusBox" | "focusMode">, b: Pick<Lookup, "focusBox" | "focusMode">) {
  return JSON.stringify(a.focusBox) === JSON.stringify(b.focusBox) && a.focusMode === b.focusMode;
}

function samePhotoTime(a: string, b: string) {
  const normalized = normalizeComparisonTimestamp(a);
  return normalized !== undefined && normalized === normalizeComparisonTimestamp(b);
}

function imageReferences(scan: Lookup): ImageSlot[] {
  const id = scan.id;
  const slots: ImageSlot[] = [{ source: scan.frame.imageBase64, issue: { kind: "photo", lookupId: id, photoId: scan.photos?.[0]?.id ?? "photo-1" },
    replace: (imageBase64) => { scan.frame.imageBase64 = imageBase64; },
    refreshed: (remote) => samePhotoTime(remote.frame.capturedAt, scan.frame.capturedAt) ? remote.frame.imageBase64 : undefined }];
  for (const photo of scan.photos ?? []) slots.push({ source: photo.imageBase64, issue: { kind: "photo", lookupId: id, photoId: photo.id },
    replace: (imageBase64) => { photo.imageBase64 = imageBase64; },
    refreshed: (remote) => remote.photos?.find((candidate) => candidate.id === photo.id && samePhotoTime(candidate.capturedAt, photo.capturedAt))?.imageBase64 });
  if (scan.isolatedImageBase64 !== undefined) slots.push({ source: scan.isolatedImageBase64, issue: { kind: "cutout", lookupId: id },
    replace: (image) => { scan.isolatedImageBase64 = image; },
    refreshed: (remote) => sameSelection(scan, remote) ? remote.isolatedImageBase64 : undefined });
  for (const object of scan.isolatedObjects ?? []) slots.push({ source: object.isolatedImageBase64,
    issue: { kind: "cutout", lookupId: id, selectionName: object.name }, replace: (image) => { object.isolatedImageBase64 = image; },
    refreshed: (remote) => {
      const matches = remote.isolatedObjects?.filter((candidate: IsolatedObject) => candidate.name === object.name && candidate.category === object.category
        && candidate.primary === object.primary && candidate.correctedAt === object.correctedAt && sameSelection(candidate, object));
      return matches?.length === 1 ? matches[0].isolatedImageBase64 : undefined;
    } });
  return slots;
}

function decodeRaster(value: string): { data: string; size: number } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !match[2] || match[2].length % 4 !== 0) throw new Error();
  const size = match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (size > INSPECTION_REPORT_MAX_IMAGE_BYTES) throw limitError();
  const raw = atob(match[2]);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  const mime = match[1].toLowerCase();
  if (!validRaster(bytes, mime)) throw new Error();
  return { data: `data:${mime};base64,${match[2]}`, size: bytes.byteLength };
}

function validRaster(bytes: Uint8Array, mime: string) {
  if (mime === "image/jpeg") return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  if (mime === "image/png") return bytes.length >= 45 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR" && String.fromCharCode(...bytes.slice(-8, -4)) === "IEND";
  return mime === "image/webp" && bytes.length >= 20 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(String.fromCharCode(...bytes.slice(12, 16)))
    && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length;
}

function verifyDecodedRaster(source: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      image.onload = null; image.onerror = null;
      signal.removeEventListener("abort", abort);
      image.src = "";
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new Error());
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? undefined : new Error());
    image.onerror = () => finish(new Error());
    image.decoding = "async";
    image.src = source;
  });
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

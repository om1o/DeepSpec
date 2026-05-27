const SCAN_CARD_PREFERENCES_KEY = "deep-spec:scan-card-preferences";

export type ScanPrecisionMode = "fast" | "accurate";

export type ScanCardPreferences = {
  compactCardsByDefault: boolean;
  hideConfidence: boolean;
  precisionMode: ScanPrecisionMode;
};

const DEFAULT_PREFERENCES: ScanCardPreferences = {
  compactCardsByDefault: true,
  hideConfidence: false,
  precisionMode: "fast",
};

type StoredPreferences = {
  [scene: string]: ScanCardPreferences;
};

type PreferenceEnvelope = {
  scenes: StoredPreferences;
};

export function getScanCardPreferences(sceneId: string): ScanCardPreferences {
  const data = readPreferenceEnvelope();
  const normalized = normalizeScenePreferences(sceneId, data.scenes[sceneId]);
  return normalized ?? DEFAULT_PREFERENCES;
}

export function updateScanCardPreferences(
  sceneId: string,
  updates: Partial<ScanCardPreferences>,
): ScanCardPreferences {
  const current = getScanCardPreferences(sceneId);
  const next = {
    precisionMode: updates.precisionMode ?? current.precisionMode,
    compactCardsByDefault: updates.compactCardsByDefault ?? current.compactCardsByDefault,
    hideConfidence: updates.hideConfidence ?? current.hideConfidence,
  };

  if (!hasLocalStorage()) {
    return next;
  }

  const data = readPreferenceEnvelope();
  try {
    const nextEnvelope = {
      ...data,
      scenes: {
        ...data.scenes,
        [sceneId]: next,
      },
    };
    localStorage.setItem(SCAN_CARD_PREFERENCES_KEY, JSON.stringify(nextEnvelope));
  } catch {
    // Intentionally ignore storage failures so a safe fallback preference is still returned.
  }

  return next;
}

function readPreferenceEnvelope(): PreferenceEnvelope {
  if (!hasLocalStorage()) {
    return { scenes: {} };
  }

  try {
    const raw = localStorage.getItem(SCAN_CARD_PREFERENCES_KEY);
    if (!raw) {
      return { scenes: {} };
    }

    const parsed = JSON.parse(raw) as Partial<PreferenceEnvelope>;
    const scenes = Array.isArray(parsed.scenes) || typeof parsed.scenes !== "object" ? {} : parsed.scenes;

    return {
      scenes: normalizeSceneMap(scenes),
    };
  } catch {
    return { scenes: {} };
  }
}

function normalizeSceneMap(scenes: Partial<Record<string, unknown>>) {
  const output: StoredPreferences = {};

  for (const [sceneId, rawValue] of Object.entries(scenes)) {
    const value = normalizeScenePreferences(sceneId, rawValue);
    if (value) {
      output[sceneId] = value;
    }
  }

  return output;
}

function normalizeScenePreferences(_sceneId: string, value: unknown): ScanCardPreferences | null {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_PREFERENCES;
  }

  const raw = value as Partial<ScanCardPreferences>;
  const precisionMode = raw.precisionMode === "accurate" || raw.precisionMode === "fast"
    ? raw.precisionMode
    : DEFAULT_PREFERENCES.precisionMode;
  const compactCardsByDefault = typeof raw.compactCardsByDefault === "boolean"
    ? raw.compactCardsByDefault
    : DEFAULT_PREFERENCES.compactCardsByDefault;

  const hideConfidence = typeof raw.hideConfidence === "boolean"
    ? raw.hideConfidence
    : DEFAULT_PREFERENCES.hideConfidence;

  return {
    precisionMode,
    compactCardsByDefault,
    hideConfidence,
  };
}

function hasLocalStorage() {
  return typeof localStorage !== "undefined";
}

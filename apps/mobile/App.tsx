import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type Confidence = "high" | "medium" | "low";
type Triage = "can_help" | "needs_better_photo" | "needs_professional";
type Screen = "scan" | "history" | "settings" | "result" | "chat";
type CameraFacing = "back" | "front";

type LookupResult = {
  partName: string;
  confidence: Confidence;
  whatItDoes: string;
  conditionObservations: string[];
  concerns: string[];
  isSafetyCritical: boolean;
  nextSteps: string;
  needsBetterPhoto: boolean;
  followUpQuestions: string[];
  triage: Triage;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type Lookup = {
  id: string;
  createdAt: string;
  imageBase64: string;
  userCarContext: string;
  userProblemContext: string;
  result: LookupResult;
  rating: "up" | "down" | null;
  correction: string | null;
  chatHistory: ChatMessage[];
};

type AIInput = {
  type: "vision" | "text";
  imageBase64?: string;
  userMessage: string;
  systemPrompt: string;
  responseAsJson?: boolean;
};

const STORAGE_KEY = "deep-spec:mobile-lookups";
const SETTINGS_KEY = "deep-spec:mobile-settings";

const IDENTIFY_PROMPT = `You are DeepSpec, an app that helps regular people understand visible car parts from photos.

Return only valid JSON. Do not use markdown.

Rules:
- Identify the visible part in plain language. Never invent exact OEM part numbers, prices, fitment, wiring pinouts, or shop recommendations.
- Explain what the part does in one or two short sentences.
- Assess visible condition: rust, leaks, cracks, missing bolts, frayed wires, oil residue, melted plastic, or unclear photo quality.
- Set is_safety_critical true for brakes, steering, suspension, fuel, airbags, severe electrical burning, or anything that could make driving unsafe.
- Set triage_status:
  - "can_help" for safe explanation/simple inspection advice.
  - "needs_better_photo" when the photo is too blurry, dark, close, far, or unclear.
  - "needs_professional" for safety-critical parts, severe leaks, burning, structural damage, or unclear high-risk cases.
- If triage_status is "needs_professional", tell the user to get professional help and do not give risky repair steps.

JSON shape:
{
  "part_name": "max 60 chars",
  "confidence": "high" | "medium" | "low",
  "what_it_does": "plain language",
  "condition_observations": ["specific visible observations"],
  "concerns": ["visible concerns, empty if none"],
  "is_safety_critical": false,
  "next_steps": "one or two sentences",
  "needs_better_photo": false,
  "follow_up_questions": ["optional questions"],
  "triage_status": "can_help" | "needs_better_photo" | "needs_professional"
}`;

const FOLLOWUP_PROMPT = `You are DeepSpec's follow-up assistant.

Answer in 2-4 short sentences. Use plain language.
If the part is safety-critical or the user asks for risky repair steps, tell them to verify with a mechanic.
Do not give exact OEM part numbers, live prices, wiring pinouts, or repair certification advice.`;

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asConfidence(value: unknown): Confidence {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function deriveTriage(raw: Record<string, unknown>, result: Omit<LookupResult, "triage">): Triage {
  const explicit = raw.triage_status;
  if (explicit === "can_help" || explicit === "needs_better_photo" || explicit === "needs_professional") {
    return explicit;
  }
  if (result.needsBetterPhoto || result.confidence === "low") return "needs_better_photo";
  if (result.isSafetyCritical) return "needs_professional";
  const joined = [...result.concerns, result.nextSteps].join(" ").toLowerCase();
  if (/brake|steering|suspension|fuel|airbag|fire|burn|severe leak|do not drive|don't drive/.test(joined)) {
    return "needs_professional";
  }
  return "can_help";
}

function mapIdentify(raw: unknown): LookupResult {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const base = {
    partName: asString(obj.part_name, "Unknown part").slice(0, 80),
    confidence: asConfidence(obj.confidence),
    whatItDoes: asString(obj.what_it_does, "DeepSpec could not explain this from the current photo."),
    conditionObservations: asArray(obj.condition_observations),
    concerns: asArray(obj.concerns),
    isSafetyCritical: obj.is_safety_critical === true,
    nextSteps: asString(obj.next_steps, "Try another photo with better light and a clearer angle."),
    needsBetterPhoto: obj.needs_better_photo === true,
    followUpQuestions: asArray(obj.follow_up_questions),
  };
  return { ...base, triage: deriveTriage(obj, base) };
}

function triageCopy(triage: Triage) {
  if (triage === "needs_professional") {
    return {
      title: "Get professional help",
      body: "This scan touches a safety-critical or high-risk area. DeepSpec can explain what it sees, but it should not guide this repair.",
    };
  }
  if (triage === "needs_better_photo") {
    return {
      title: "Needs a better photo",
      body: "Move closer, add light, and point at labels, connectors, leaks, or damaged areas.",
    };
  }
  return {
    title: "DeepSpec can help",
    body: "This looks safe enough for plain-language explanation and simple inspection guidance.",
  };
}

function confidenceStyle(confidence: Confidence) {
  if (confidence === "high") return [styles.badge, styles.badgeGood];
  if (confidence === "medium") return [styles.badge, styles.badgeWarn];
  return [styles.badge, styles.badgeRisk];
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function compressForVision(uri: string): Promise<string> {
  const output = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1024 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!output.base64) throw new Error("Could not prepare that photo for scanning.");
  return `data:image/jpeg;base64,${output.base64}`;
}

async function runAI(apiBase: string, input: AIInput): Promise<string | object> {
  const endpoint = `${apiBase.replace(/\/$/, "")}/api/ai`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("DeepSpec AI is not reachable. Start the DeepSpec API or use your computer LAN address on a phone.");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error?: { message?: string } }).error?.message ?? response.statusText)
        : response.statusText;
    throw new Error(msg || "DeepSpec AI request failed.");
  }
  if (!body || typeof body !== "object" || !("kind" in body)) throw new Error("DeepSpec AI returned an unreadable response.");
  const envelope = body as { kind?: unknown; value?: unknown };
  if (envelope.kind === "json" && envelope.value && typeof envelope.value === "object") return envelope.value as object;
  if (envelope.kind === "text" && typeof envelope.value === "string") return envelope.value;
  throw new Error("DeepSpec AI returned an unexpected response.");
}

function buildScanMessage(car: string, problem: string) {
  return [
    car.trim() ? `Vehicle context: ${car.trim()}` : "",
    problem.trim() ? `User concern: ${problem.trim()}` : "",
    "Identify the visible car part and triage whether DeepSpec can help safely.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildFollowupMessage(lookup: Lookup, question: string) {
  return [
    `Part: ${lookup.result.partName}`,
    `Triage: ${lookup.result.triage}`,
    `Safety-critical: ${lookup.result.isSafetyCritical}`,
    `What it does: ${lookup.result.whatItDoes}`,
    `Visible concerns: ${lookup.result.concerns.join("; ") || "none listed"}`,
    `User question: ${question}`,
  ].join("\n");
}

export default function App() {
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [screen, setScreen] = useState<Screen>("scan");
  const [lookups, setLookups] = useState<Lookup[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("back");
  const [cameraReady, setCameraReady] = useState(false);
  const [carContext, setCarContext] = useState("");
  const [problemContext, setProblemContext] = useState("");
  const [apiBase, setApiBase] = useState("http://127.0.0.1:8788");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const [chatDraft, setChatDraft] = useState("");

  useEffect(() => {
    void (async () => {
      setLookups(await readJson<Lookup[]>(STORAGE_KEY, []));
      const settings = await readJson<{ apiBase?: string }>(SETTINGS_KEY, {});
      if (settings.apiBase) setApiBase(settings.apiBase);
    })();
  }, []);

  const activeLookup = useMemo(() => lookups.find((lookup) => lookup.id === activeId) ?? null, [activeId, lookups]);
  const canSubmit = email.trim().includes("@") && passcode.trim().length >= 4;

  const saveLookups = useCallback(async (next: Lookup[]) => {
    const sorted = [...next].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    setLookups(sorted);
    await writeJson(STORAGE_KEY, sorted);
  }, []);

  const updateLookup = useCallback(
    async (id: string, patch: Partial<Lookup>) => {
      await saveLookups(lookups.map((lookup) => (lookup.id === id ? { ...lookup, ...patch, id } : lookup)));
    },
    [lookups, saveLookups],
  );

  const selectLookup = (id: string, nextScreen: Screen = "result") => {
    setActiveId(id);
    setScreen(nextScreen);
    setCorrection(lookups.find((lookup) => lookup.id === id)?.correction ?? "");
  };

  const capturePhoto = async () => {
    setError(null);
    try {
      if (!cameraRef.current || !cameraReady) {
        setError("Camera is still getting ready.");
        return;
      }
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, base64: true, skipProcessing: false });
      if (!photo?.uri && !photo?.base64) {
        throw new Error("Camera did not return a photo.");
      }
      if (photo.base64) {
        setImageBase64(`data:image/jpeg;base64,${photo.base64}`);
        return;
      }
      setImageBase64(await compressForVision(photo.uri));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not capture a photo.");
    }
  };

  const saveCameraCapture = async () => {
    if (!imageBase64) return;
    const lookup: Lookup = {
      id: newId(),
      createdAt: new Date().toISOString(),
      imageBase64,
      userCarContext: carContext,
      userProblemContext: problemContext,
      result: {
        partName: "Camera capture",
        confidence: "low",
        whatItDoes: "AI identification is turned off for this camera-first build. This saved photo is ready for the AI layer later.",
        conditionObservations: ["Photo captured from the live DeepSpec camera."],
        concerns: [],
        isSafetyCritical: false,
        nextSteps: "Retake if the part label, connector, leak, or damage is not clearly visible.",
        needsBetterPhoto: false,
        followUpQuestions: [],
        triage: "can_help",
      },
      rating: null,
      correction: null,
      chatHistory: [],
    };
    await saveLookups([lookup, ...lookups]);
    setImageBase64(null);
    setActiveId(lookup.id);
    setCorrection("");
    setScreen("result");
  };

  const identify = async () => {
    if (!imageBase64 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await runAI(apiBase, {
        type: "vision",
        imageBase64,
        userMessage: buildScanMessage(carContext, problemContext),
        systemPrompt: IDENTIFY_PROMPT,
        responseAsJson: true,
      });
      const result = mapIdentify(raw);
      const lookup: Lookup = {
        id: newId(),
        createdAt: new Date().toISOString(),
        imageBase64,
        userCarContext: carContext,
        userProblemContext: problemContext,
        result,
        rating: null,
        correction: null,
        chatHistory: [],
      };
      await saveLookups([lookup, ...lookups]);
      setImageBase64(null);
      setProblemContext("");
      setActiveId(lookup.id);
      setCorrection("");
      setScreen("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setBusy(false);
    }
  };

  const rate = async (rating: "up" | "down") => {
    if (!activeLookup) return;
    await updateLookup(activeLookup.id, { rating });
  };

  const saveCorrection = async () => {
    if (!activeLookup) return;
    await updateLookup(activeLookup.id, { correction: correction.trim() || null, rating: "down" });
  };

  const deleteActive = async () => {
    if (!activeLookup) return;
    const next = lookups.filter((lookup) => lookup.id !== activeLookup.id);
    await saveLookups(next);
    setActiveId(null);
    setScreen("history");
  };

  const findHelpNearby = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      const query = encodeURIComponent("auto repair");
      if (!permission.granted) {
        await Linking.openURL(`https://maps.apple.com/?q=${query}`);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;
      if (Platform.OS === "ios") {
        await Linking.openURL(`maps://?q=${query}&ll=${latitude},${longitude}`);
      } else if (Platform.OS === "android") {
        await Linking.openURL(`geo:${latitude},${longitude}?q=${query}`);
      } else {
        await Linking.openURL(`https://maps.apple.com/?q=${query}&ll=${latitude},${longitude}`);
      }
    } catch {
      await Linking.openURL("https://maps.apple.com/?q=auto%20repair");
    }
  };

  const sendChat = async () => {
    if (!activeLookup) return;
    const text = chatDraft.trim().slice(0, 500);
    if (!text || busy) return;
    const userMsg: ChatMessage = { id: newId(), role: "user", content: text, timestamp: new Date().toISOString() };
    const optimistic = { ...activeLookup, chatHistory: [...activeLookup.chatHistory, userMsg] };
    await updateLookup(activeLookup.id, { chatHistory: optimistic.chatHistory });
    setChatDraft("");
    setBusy(true);
    setError(null);
    try {
      const response = await runAI(apiBase, {
        type: "text",
        userMessage: buildFollowupMessage(optimistic, text),
        systemPrompt: FOLLOWUP_PROMPT,
      });
      const assistantMsg: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: typeof response === "string" ? response : "I could not read the response.",
        timestamp: new Date().toISOString(),
      };
      const fresh = lookups.find((lookup) => lookup.id === activeLookup.id) ?? optimistic;
      await updateLookup(activeLookup.id, { chatHistory: [...fresh.chatHistory, assistantMsg] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not answer that.");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    await writeJson(SETTINGS_KEY, { apiBase });
    Alert.alert("Saved", "DeepSpec will use this AI API base URL.");
  };

  if (!signedIn) {
    return (
      <SafeAreaView style={styles.authSafe}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.authScroll}>
            <View style={styles.brandBlock}>
              <BrandLogo size={118} />
              <Text style={styles.brandMark}>DeepSpec</Text>
              <Text style={styles.tagline}>Know what you are looking at.</Text>
            </View>

            <Card>
              <Text style={styles.eyebrow}>Tester access</Text>
              <Text style={styles.authTitle}>Sign in to scan parts</Text>
              <Text style={styles.muted}>
                Local tester sign-in for this preview. Real accounts and parent-managed billing come later.
              </Text>
              <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
              <Field label="Passcode" value={passcode} onChangeText={setPasscode} placeholder="4+ characters" secureTextEntry />
              <ActionButton disabled={!canSubmit} label="Sign in" onPress={() => setSignedIn(true)} />
              <GhostButton
                label="Continue as demo tester"
                onPress={() => {
                  setEmail("tester@deepspec.local");
                  setPasscode("0000");
                  setSignedIn(true);
                }}
              />
            </Card>

            <View style={styles.safetyNote}>
              <Text style={styles.safetyTitle}>Safety rule</Text>
              <Text style={styles.safetyText}>
                DeepSpec explains visible parts, but escalates brakes, steering, suspension, fuel, airbags, severe
                leaks, and unclear high-risk scans to professional help.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.appSafe}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <View style={styles.headerBrand}>
            <BrandLogo size={44} compact />
            <View>
              <Text style={styles.logo}>DeepSpec</Text>
              <Text style={styles.headerSub}>iOS-first scanner preview</Text>
            </View>
          </View>
          <Pressable onPress={() => setSignedIn(false)} style={styles.smallPill}>
            <Text style={styles.smallPillText}>Sign out</Text>
          </Pressable>
        </View>

        {screen === "scan" ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.screenTitle}>DeepSpec Camera</Text>
            <Text style={styles.muted}>Point at the part, label, connector, leak, or visible damage. AI is off for this build.</Text>

            <View style={styles.cameraShell}>
              {imageBase64 ? (
                <Image source={{ uri: imageBase64 }} style={styles.cameraPreview} resizeMode="cover" />
              ) : cameraPermission?.granted ? (
                <CameraView
                  ref={cameraRef}
                  style={styles.cameraPreview}
                  facing={cameraFacing}
                  onCameraReady={() => setCameraReady(true)}
                  onMountError={(event) => setError(event.message)}
                >
                  <View style={styles.cameraOverlay}>
                    <View style={[styles.liveCorner, styles.liveCornerTopLeft]} />
                    <View style={[styles.liveCorner, styles.liveCornerTopRight]} />
                    <View style={[styles.liveCorner, styles.liveCornerBottomLeft]} />
                    <View style={[styles.liveCorner, styles.liveCornerBottomRight]} />
                    <View style={styles.cameraHint}>
                      <Text style={styles.cameraHintText}>Hold steady. Fill the frame.</Text>
                    </View>
                  </View>
                </CameraView>
              ) : (
                <View style={styles.cameraPermissionBox}>
                  <BrandLogo size={92} />
                  <Text style={styles.photoEmptyTitle}>Camera access needed</Text>
                  <Text style={styles.mutedCenter}>DeepSpec needs the live camera to work like a scanner.</Text>
                  <ActionButton label="Allow camera" onPress={() => void requestCameraPermission()} />
                </View>
              )}
            </View>

            {imageBase64 ? (
              <View style={styles.row}>
                <GhostButton label="Retake" onPress={() => setImageBase64(null)} half />
                <ActionButton label="Save capture" onPress={() => void saveCameraCapture()} half />
              </View>
            ) : cameraPermission?.granted ? (
              <View style={styles.cameraControls}>
                <GhostButton
                  label={cameraFacing === "back" ? "Back camera" : "Front camera"}
                  onPress={() => setCameraFacing((current) => (current === "back" ? "front" : "back"))}
                  half
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Capture photo"
                  disabled={!cameraReady}
                  onPress={() => void capturePhoto()}
                  style={({ pressed }) => [styles.shutterButton, pressed ? styles.shutterPressed : null, !cameraReady ? styles.disabled : null]}
                >
                  <View style={styles.shutterInner} />
                </Pressable>
              </View>
            ) : null}

            <Field label="Your car (optional)" value={carContext} onChangeText={setCarContext} placeholder="2018 Mercedes Sprinter" />
            <Field
              label="What is going on? (optional)"
              value={problemContext}
              onChangeText={setProblemContext}
              placeholder="Leak under engine, grinding noise, warning light..."
              multiline
            />

            {error ? <ErrorBox message={error} /> : null}
            {busy ? <ActivityIndicator color="#3B82F6" /> : null}
          </ScrollView>
        ) : null}

        {screen === "result" && activeLookup ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Image source={{ uri: activeLookup.imageBase64 }} style={styles.resultImage} resizeMode="contain" />
            <View style={styles.titleRow}>
              <Text style={styles.screenTitle}>{activeLookup.result.partName}</Text>
              <View style={confidenceStyle(activeLookup.result.confidence)}>
                <Text style={styles.badgeText}>{activeLookup.result.confidence}</Text>
              </View>
            </View>

            <TriageCard triage={activeLookup.result.triage} />
            {activeLookup.result.triage === "needs_professional" ? (
              <ActionButton label="Find help nearby" onPress={() => void findHelpNearby()} />
            ) : null}

            <Section title="What it does" body={activeLookup.result.whatItDoes} />
            <ListSection title="What I see" items={activeLookup.result.conditionObservations} empty="No specific observations listed." />
            <ListSection title="Concerns" items={activeLookup.result.concerns} empty="Nothing concerning visible from this photo." />
            <Section title="What to do next" body={activeLookup.result.nextSteps} />

            <View style={styles.row}>
              <ActionButton label="New capture" onPress={() => setScreen("scan")} half />
              <GhostButton label="Saved scans" onPress={() => setScreen("history")} half />
            </View>
            <View style={styles.row}>
              <GhostButton label={activeLookup.rating === "up" ? "Helpful: yes" : "Helpful"} onPress={() => void rate("up")} half />
              <GhostButton label={activeLookup.rating === "down" ? "Marked wrong" : "Wrong"} onPress={() => void rate("down")} half />
            </View>
            <Field label="Correction (if wrong)" value={correction} onChangeText={setCorrection} placeholder="What was it actually?" />
            <GhostButton label="Save correction" onPress={() => void saveCorrection()} />
            <GhostButton label="Delete scan" danger onPress={() => void deleteActive()} />
          </ScrollView>
        ) : null}

        {screen === "history" ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.screenTitle}>Saved scans</Text>
            {lookups.length === 0 ? <Text style={styles.muted}>No scans yet.</Text> : null}
            {lookups.map((lookup) => (
              <Pressable key={lookup.id} onPress={() => selectLookup(lookup.id)} style={styles.historyCard}>
                <Image source={{ uri: lookup.imageBase64 }} style={styles.historyImage} />
                <View style={styles.historyBody}>
                  <Text style={styles.historyTitle}>{lookup.result.partName}</Text>
                  <Text style={styles.historyMeta}>
                    {lookup.result.confidence} confidence - {lookup.result.triage.replace(/_/g, " ")}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {screen === "chat" && activeLookup ? (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
            <ScrollView contentContainerStyle={styles.content}>
              <Text style={styles.screenTitle}>Ask about {activeLookup.result.partName}</Text>
              {activeLookup.chatHistory.length === 0 ? (
                <Text style={styles.muted}>Ask a short follow-up. DeepSpec will stay cautious for risky parts.</Text>
              ) : null}
              {activeLookup.chatHistory.map((msg) => (
                <View key={msg.id} style={msg.role === "user" ? styles.userBubble : styles.assistantBubble}>
                  <Text style={msg.role === "user" ? styles.userBubbleText : styles.assistantBubbleText}>{msg.content}</Text>
                </View>
              ))}
              {error ? <ErrorBox message={error} /> : null}
            </ScrollView>
            <View style={styles.chatComposer}>
              <TextInput
                value={chatDraft}
                onChangeText={(text) => setChatDraft(text.slice(0, 500))}
                placeholder="Ask a follow-up..."
                placeholderTextColor="#71717A"
                multiline
                style={styles.chatInput}
              />
              <Pressable onPress={() => void sendChat()} disabled={!chatDraft.trim() || busy} style={styles.sendButton}>
                <Text style={styles.sendText}>{busy ? "..." : "Send"}</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        ) : null}

        {screen === "settings" ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.screenTitle}>Settings</Text>
            <Field label="AI API base URL" value={apiBase} onChangeText={setApiBase} placeholder="http://127.0.0.1:8788" />
            <Text style={styles.muted}>
              On a real phone, use your PC LAN IP, for example http://192.168.1.25:8788. The Gemini key stays on the server.
            </Text>
            <ActionButton label="Save settings" onPress={() => void saveSettings()} />
            <Section
              title="Roadmap"
              body="Next: photo overlays. Later: live camera guidance, voice questions, and native AR after identification is reliable."
            />
          </ScrollView>
        ) : null}

        <View style={styles.nav}>
          <NavButton active={screen === "scan"} label="Scan" onPress={() => setScreen("scan")} />
          <NavButton active={screen === "history"} label="Saved" onPress={() => setScreen("history")} />
          <NavButton active={screen === "settings"} label="Settings" onPress={() => setScreen("settings")} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function BrandLogo({ size, compact }: { size: number; compact?: boolean }) {
  const cornerSize = size * 0.22;
  const cornerThickness = Math.max(3, size * 0.045);
  const lensSize = size * (compact ? 0.34 : 0.38);
  const nutSize = size * (compact ? 0.56 : 0.58);
  return (
    <View style={[styles.logoMark, { width: size, height: size, borderRadius: size * 0.22 }]}>
      <View
        style={[
          styles.scanCorner,
          styles.scanCornerTopLeft,
          { width: cornerSize, height: cornerSize, borderTopWidth: cornerThickness, borderLeftWidth: cornerThickness },
        ]}
      />
      <View
        style={[
          styles.scanCorner,
          styles.scanCornerTopRight,
          { width: cornerSize, height: cornerSize, borderTopWidth: cornerThickness, borderRightWidth: cornerThickness },
        ]}
      />
      <View
        style={[
          styles.scanCorner,
          styles.scanCornerBottomLeft,
          { width: cornerSize, height: cornerSize, borderBottomWidth: cornerThickness, borderLeftWidth: cornerThickness },
        ]}
      />
      <View
        style={[
          styles.scanCorner,
          styles.scanCornerBottomRight,
          { width: cornerSize, height: cornerSize, borderBottomWidth: cornerThickness, borderRightWidth: cornerThickness },
        ]}
      />

      {!compact ? (
        <View style={styles.scanLines}>
          <View style={[styles.scanLine, { width: size * 0.22 }]} />
          <View style={[styles.scanLine, { width: size * 0.28 }]} />
          <View style={[styles.scanLine, { width: size * 0.2 }]} />
        </View>
      ) : null}

      <View style={[styles.hexNut, { width: nutSize, height: nutSize * 0.74, borderRadius: size * 0.07 }]}>
        <View style={styles.rustPatch} />
        <View style={[styles.lensOuter, { width: lensSize, height: lensSize, borderRadius: lensSize / 2 }]}>
          <View style={[styles.lensMid, { width: lensSize * 0.72, height: lensSize * 0.72, borderRadius: lensSize * 0.36 }]}>
            <View style={[styles.lensCore, { width: lensSize * 0.42, height: lensSize * 0.42, borderRadius: lensSize * 0.21 }]} />
          </View>
        </View>
      </View>

      {!compact ? (
        <View style={styles.wrenchRow}>
          <View style={styles.wrenchIcon}>
            <View style={styles.wrenchHead} />
            <View style={styles.wrenchJaw} />
            <View style={styles.wrenchHandle} />
          </View>
          <View style={styles.spark} />
        </View>
      ) : null}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  keyboardType?: "email-address";
  secureTextEntry?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#71717A"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, multiline ? styles.textArea : null]}
      />
    </View>
  );
}

function ActionButton({ label, onPress, disabled, half }: { label: string; onPress: () => void; disabled?: boolean; half?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.primaryButton, half ? styles.half : null, disabled ? styles.disabled : null, pressed && !disabled ? styles.pressed : null]}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function GhostButton({ label, onPress, half, danger }: { label: string; onPress: () => void; half?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.ghostButton, half ? styles.half : null, danger ? styles.dangerButton : null, pressed ? styles.ghostPressed : null]}>
      <Text style={danger ? styles.dangerText : styles.ghostButtonText}>{label}</Text>
    </Pressable>
  );
}

function NavButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.navButton, active ? styles.navActive : null]}>
      <Text style={active ? styles.navTextActive : styles.navText}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
    </Card>
  );
}

function ListSection({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <Card>
      <Text style={styles.sectionTitle}>{title}</Text>
      {(items.length ? items : [empty]).map((item) => (
        <Text key={item} style={styles.listItem}>
          - {item}
        </Text>
      ))}
    </Card>
  );
}

function TriageCard({ triage }: { triage: Triage }) {
  const copy = triageCopy(triage);
  return (
    <View style={[styles.triageCard, triage === "needs_professional" ? styles.triageRisk : triage === "needs_better_photo" ? styles.triageWarn : styles.triageGood]}>
      <Text style={styles.triageTitle}>{copy.title}</Text>
      <Text style={styles.triageBody}>{copy.body}</Text>
    </View>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  authSafe: { flex: 1, backgroundColor: "#0A0A0A" },
  appSafe: { flex: 1, backgroundColor: "#0A0A0A" },
  shell: { flex: 1, backgroundColor: "#0A0A0A" },
  authScroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 28 },
  brandBlock: { alignItems: "center", marginBottom: 24 },
  brandMark: { color: "#F5F5F5", fontSize: 34, fontWeight: "800", letterSpacing: 0 },
  tagline: { color: "#A1A1AA", fontSize: 16, marginTop: 6 },
  logoMark: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#070D12",
    borderWidth: 1,
    borderColor: "#1F2937",
    marginBottom: 16,
    overflow: "hidden",
  },
  scanCorner: {
    position: "absolute",
    borderColor: "#A7F3FF",
    shadowColor: "#38BDF8",
    shadowOpacity: 0.9,
    shadowRadius: 10,
  },
  scanCornerTopLeft: { left: "12%", top: "12%", borderTopLeftRadius: 16 },
  scanCornerTopRight: { right: "12%", top: "12%", borderTopRightRadius: 16 },
  scanCornerBottomLeft: { left: "12%", bottom: "12%", borderBottomLeftRadius: 16 },
  scanCornerBottomRight: { right: "12%", bottom: "12%", borderBottomRightRadius: 16 },
  scanLines: { position: "absolute", left: "16%", gap: 6 },
  scanLine: { height: 4, borderRadius: 999, backgroundColor: "#18BDFB", opacity: 0.75, marginBottom: 7 },
  hexNut: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#AEB8C2",
    borderWidth: 2,
    borderColor: "#E5E7EB",
    transform: [{ rotate: "0deg" }],
    overflow: "hidden",
  },
  rustPatch: {
    position: "absolute",
    right: -10,
    top: "18%",
    width: "30%",
    height: "72%",
    backgroundColor: "#C2410C",
    opacity: 0.86,
    transform: [{ rotate: "-15deg" }],
  },
  lensOuter: { alignItems: "center", justifyContent: "center", backgroundColor: "#030712", borderWidth: 3, borderColor: "#111827" },
  lensMid: { alignItems: "center", justifyContent: "center", backgroundColor: "#0B3B78" },
  lensCore: { backgroundColor: "#38BDF8", shadowColor: "#38BDF8", shadowOpacity: 1, shadowRadius: 12 },
  wrenchRow: { position: "absolute", bottom: "9%", flexDirection: "row", alignItems: "center", gap: 12 },
  wrenchIcon: { width: 32, height: 32, transform: [{ rotate: "-35deg" }] },
  wrenchHead: {
    position: "absolute",
    top: 0,
    left: 2,
    width: 14,
    height: 14,
    borderRadius: 9,
    borderWidth: 4,
    borderColor: "#F5F5F5",
  },
  wrenchJaw: { position: "absolute", top: 2, left: 9, width: 11, height: 8, backgroundColor: "#070D12", borderRadius: 3 },
  wrenchHandle: {
    position: "absolute",
    left: 13,
    top: 11,
    width: 7,
    height: 24,
    borderRadius: 999,
    backgroundColor: "#F5F5F5",
  },
  spark: { width: 16, height: 16, backgroundColor: "#22D3EE", transform: [{ rotate: "45deg" }], borderRadius: 3 },
  card: { borderWidth: 1, borderColor: "#262626", backgroundColor: "#171717", borderRadius: 16, padding: 18, marginBottom: 14 },
  eyebrow: { color: "#60A5FA", fontSize: 12, fontWeight: "800", letterSpacing: 0.8, marginBottom: 10, textTransform: "uppercase" },
  authTitle: { color: "#F5F5F5", fontSize: 25, fontWeight: "800", letterSpacing: 0, marginBottom: 8 },
  muted: { color: "#A1A1AA", fontSize: 14, lineHeight: 21, marginBottom: 14 },
  mutedCenter: { color: "#A1A1AA", fontSize: 14, lineHeight: 21, textAlign: "center" },
  safetyNote: { borderWidth: 1, borderColor: "#3F2F16", backgroundColor: "#1A1308", borderRadius: 14, padding: 16, marginTop: 18 },
  safetyTitle: { color: "#F59E0B", fontSize: 13, fontWeight: "800", marginBottom: 6 },
  safetyText: { color: "#D4D4D8", fontSize: 13, lineHeight: 19 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingBottom: 12, paddingTop: 10, borderBottomColor: "#171717", borderBottomWidth: 1 },
  headerBrand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { color: "#F5F5F5", fontSize: 24, fontWeight: "900", letterSpacing: 0 },
  headerSub: { color: "#A1A1AA", fontSize: 12, marginTop: 2 },
  smallPill: { borderWidth: 1, borderColor: "#262626", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  smallPillText: { color: "#D4D4D8", fontWeight: "800", fontSize: 12 },
  content: { paddingHorizontal: 18, paddingBottom: 110, paddingTop: 18 },
  screenTitle: { color: "#F5F5F5", fontSize: 25, fontWeight: "900", letterSpacing: 0, marginBottom: 8 },
  photoBox: { minHeight: 245, borderWidth: 1, borderColor: "#262626", backgroundColor: "#101010", borderRadius: 18, overflow: "hidden", marginBottom: 14 },
  photoPreview: { width: "100%", minHeight: 245 },
  photoEmpty: { minHeight: 245, alignItems: "center", justifyContent: "center", padding: 24 },
  photoEmptyTitle: { color: "#F5F5F5", fontSize: 18, fontWeight: "800", marginBottom: 8 },
  cameraShell: {
    height: 520,
    maxHeight: "70%",
    borderWidth: 1,
    borderColor: "#262626",
    backgroundColor: "#050505",
    borderRadius: 26,
    overflow: "hidden",
    marginBottom: 14,
  },
  cameraPreview: { flex: 1, width: "100%", height: "100%" },
  cameraOverlay: { flex: 1, justifyContent: "flex-end", padding: 18 },
  liveCorner: { position: "absolute", width: 54, height: 54, borderColor: "#A7F3FF", borderWidth: 0 },
  liveCornerTopLeft: { left: 22, top: 22, borderLeftWidth: 5, borderTopWidth: 5, borderTopLeftRadius: 18 },
  liveCornerTopRight: { right: 22, top: 22, borderRightWidth: 5, borderTopWidth: 5, borderTopRightRadius: 18 },
  liveCornerBottomLeft: { left: 22, bottom: 86, borderLeftWidth: 5, borderBottomWidth: 5, borderBottomLeftRadius: 18 },
  liveCornerBottomRight: { right: 22, bottom: 86, borderRightWidth: 5, borderBottomWidth: 5, borderBottomRightRadius: 18 },
  cameraHint: {
    alignSelf: "center",
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.58)",
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginBottom: 14,
  },
  cameraHintText: { color: "#F5F5F5", fontSize: 13, fontWeight: "800" },
  cameraPermissionBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  cameraControls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#F5F5F5",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
  },
  shutterInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#F5F5F5" },
  shutterPressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  row: { flexDirection: "row", gap: 10, marginBottom: 12 },
  half: { flex: 1 },
  fieldWrap: { marginBottom: 14 },
  label: { color: "#D4D4D8", fontSize: 13, fontWeight: "800", marginBottom: 8 },
  input: { minHeight: 50, borderWidth: 1, borderColor: "#262626", borderRadius: 12, paddingHorizontal: 14, color: "#F5F5F5", backgroundColor: "#0F0F10", fontSize: 15 },
  textArea: { minHeight: 92, paddingTop: 12, textAlignVertical: "top" },
  primaryButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#3B82F6", marginBottom: 12 },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.82 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  ghostButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 14, borderWidth: 1, borderColor: "#262626", marginBottom: 12 },
  ghostPressed: { backgroundColor: "#171717" },
  ghostButtonText: { color: "#D4D4D8", fontSize: 15, fontWeight: "800" },
  dangerButton: { borderColor: "#7F1D1D" },
  dangerText: { color: "#FCA5A5", fontSize: 15, fontWeight: "800" },
  errorBox: { borderWidth: 1, borderColor: "#7F1D1D", backgroundColor: "#2A0D0D", borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { color: "#FCA5A5", fontSize: 13, lineHeight: 19 },
  resultImage: { width: "100%", height: 240, borderRadius: 16, backgroundColor: "#101010", marginBottom: 14 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeGood: { backgroundColor: "#064E3B" },
  badgeWarn: { backgroundColor: "#78350F" },
  badgeRisk: { backgroundColor: "#7C2D12" },
  badgeText: { color: "#F5F5F5", fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  triageCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 },
  triageGood: { borderColor: "#065F46", backgroundColor: "#052E24" },
  triageWarn: { borderColor: "#92400E", backgroundColor: "#261604" },
  triageRisk: { borderColor: "#991B1B", backgroundColor: "#2A0D0D" },
  triageTitle: { color: "#F5F5F5", fontSize: 17, fontWeight: "900", marginBottom: 6 },
  triageBody: { color: "#D4D4D8", fontSize: 14, lineHeight: 20 },
  sectionTitle: { color: "#A1A1AA", fontSize: 12, fontWeight: "900", letterSpacing: 0.8, marginBottom: 10, textTransform: "uppercase" },
  bodyText: { color: "#F5F5F5", fontSize: 15, lineHeight: 22 },
  listItem: { color: "#F5F5F5", fontSize: 15, lineHeight: 23, marginBottom: 5 },
  historyCard: { flexDirection: "row", gap: 12, borderWidth: 1, borderColor: "#262626", backgroundColor: "#171717", borderRadius: 14, padding: 10, marginBottom: 10 },
  historyImage: { width: 64, height: 64, borderRadius: 10, backgroundColor: "#0F0F10" },
  historyBody: { flex: 1, justifyContent: "center" },
  historyTitle: { color: "#F5F5F5", fontSize: 16, fontWeight: "900", marginBottom: 4 },
  historyMeta: { color: "#A1A1AA", fontSize: 12, lineHeight: 18 },
  userBubble: { alignSelf: "flex-end", maxWidth: "86%", borderRadius: 16, backgroundColor: "#3B82F6", padding: 12, marginBottom: 10 },
  assistantBubble: { alignSelf: "flex-start", maxWidth: "86%", borderRadius: 16, backgroundColor: "#171717", borderWidth: 1, borderColor: "#262626", padding: 12, marginBottom: 10 },
  userBubbleText: { color: "#FFFFFF", fontSize: 14, lineHeight: 20 },
  assistantBubbleText: { color: "#F5F5F5", fontSize: 14, lineHeight: 20 },
  chatComposer: { flexDirection: "row", gap: 10, alignItems: "flex-end", borderTopWidth: 1, borderTopColor: "#171717", padding: 12, paddingBottom: 18, backgroundColor: "#0A0A0A" },
  chatInput: { flex: 1, minHeight: 48, maxHeight: 110, borderWidth: 1, borderColor: "#262626", borderRadius: 14, color: "#F5F5F5", backgroundColor: "#0F0F10", paddingHorizontal: 12, paddingTop: 12, fontSize: 15 },
  sendButton: { minHeight: 48, borderRadius: 14, backgroundColor: "#3B82F6", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  sendText: { color: "#FFFFFF", fontWeight: "900" },
  nav: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", gap: 8, padding: 12, paddingBottom: 18, borderTopWidth: 1, borderTopColor: "#171717", backgroundColor: "#0A0A0A" },
  navButton: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#262626" },
  navActive: { backgroundColor: "#172554", borderColor: "#2563EB" },
  navText: { color: "#A1A1AA", fontWeight: "900" },
  navTextActive: { color: "#F5F5F5", fontWeight: "900" },
});

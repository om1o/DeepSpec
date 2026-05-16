import React, { useMemo, useState } from "react";
import {
  Alert,
  Button,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export default function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [apiBase, setApiBase] = useState("http://127.0.0.1:8000");
  const [ocrLines, setOcrLines] = useState("31100-R40-A01\nAC DELCO REMAN");
  const [barcode, setBarcode] = useState("31100-R40-A01");
  const [blurScore, setBlurScore] = useState("0.9");
  const [log, setLog] = useState<string>("");

  const canSubmit = useMemo(() => {
    return email.trim().includes("@") && passcode.trim().length >= 4;
  }, [email, passcode]);

  function signIn() {
    if (!canSubmit) {
      Alert.alert("Check the fields", "Use an email address and a passcode with at least 4 characters.");
      return;
    }
    setSignedIn(true);
  }

  if (!signedIn) {
    return (
      <SafeAreaView style={styles.authSafe}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.authAvoidingView}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.authScroll}
          >
            <View style={styles.brandBlock}>
              <Text style={styles.brandMark}>DeepSpec</Text>
              <Text style={styles.tagline}>Know what you are looking at.</Text>
            </View>

            <View style={styles.authPanel}>
              <Text style={styles.authEyebrow}>Tester access</Text>
              <Text style={styles.authTitle}>Sign in to scan parts</Text>
              <Text style={styles.authCopy}>
                This preview uses a local tester sign-in. Real accounts and parent-managed billing come later.
              </Text>

              <Text style={styles.authLabel}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#71717A"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                style={styles.authInput}
              />

              <Text style={styles.authLabel}>Passcode</Text>
              <TextInput
                value={passcode}
                onChangeText={setPasscode}
                placeholder="4+ characters"
                placeholderTextColor="#71717A"
                secureTextEntry
                textContentType="password"
                style={styles.authInput}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in"
                onPress={signIn}
                style={({ pressed }) => [
                  styles.primaryButton,
                  !canSubmit && styles.primaryButtonDisabled,
                  pressed && canSubmit ? styles.primaryButtonPressed : null,
                ]}
              >
                <Text style={styles.primaryButtonText}>Sign in</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue as demo tester"
                onPress={() => {
                  setEmail("tester@deepspec.local");
                  setPasscode("0000");
                  setSignedIn(true);
                }}
                style={({ pressed }) => [styles.secondaryButton, pressed ? styles.secondaryButtonPressed : null]}
              >
                <Text style={styles.secondaryButtonText}>Continue as demo tester</Text>
              </Pressable>
            </View>

            <View style={styles.safetyNote}>
              <Text style={styles.safetyTitle}>Safety rule</Text>
              <Text style={styles.safetyText}>
                DeepSpec can explain visible parts, but it will escalate brakes, steering, suspension, fuel, airbags,
                severe leaks, and unclear high-risk scans to professional help.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  async function createScan() {
    try {
      const form = new FormData();
      form.append("ocr_lines", ocrLines);
      form.append("barcode_text", barcode);
      form.append("blur_score", blurScore);

      const resp = await fetch(`${apiBase.replace(/\/$/, "")}/scans`, { method: "POST", body: form });
      const txt = await resp.text();
      setLog(`${resp.status}\n${txt}`);
    } catch (e) {
      setLog(String(e));
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.prototypeHeader}>
          <View>
            <Text style={styles.title}>DeepSpec Mobile Shell</Text>
            <Text style={styles.help}>Signed in as {email || "tester"}.</Text>
          </View>
          <Pressable onPress={() => setSignedIn(false)} style={styles.signOutButton}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>
        <Text style={styles.help}>Use your PC LAN IP instead of localhost when testing on-device.</Text>

        <Text style={styles.label}>API base URL</Text>
        <TextInput value={apiBase} onChangeText={setApiBase} autoCapitalize="none" style={styles.input} />

        <Text style={styles.label}>OCR lines</Text>
        <TextInput value={ocrLines} onChangeText={setOcrLines} multiline style={[styles.input, { minHeight: 90 }]} />

        <Text style={styles.label}>Barcode text</Text>
        <TextInput value={barcode} onChangeText={setBarcode} autoCapitalize="characters" style={styles.input} />

        <Text style={styles.label}>Blur score</Text>
        <TextInput value={blurScore} onChangeText={setBlurScore} keyboardType="decimal-pad" style={styles.input} />

        <Button title="POST /scans (fusion demo)" onPress={() => createScan()} />

        <Text style={styles.mono}>{log}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  authSafe: { flex: 1, backgroundColor: "#0A0A0A" },
  authAvoidingView: { flex: 1 },
  authScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  brandBlock: { marginBottom: 24 },
  brandMark: {
    color: "#F5F5F5",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: 0,
  },
  tagline: { color: "#A1A1AA", fontSize: 16, marginTop: 6 },
  authPanel: {
    borderWidth: 1,
    borderColor: "#262626",
    backgroundColor: "#171717",
    borderRadius: 18,
    padding: 20,
  },
  authEyebrow: {
    color: "#60A5FA",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  authTitle: {
    color: "#F5F5F5",
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: 0,
    marginBottom: 8,
  },
  authCopy: { color: "#A1A1AA", fontSize: 14, lineHeight: 21, marginBottom: 22 },
  authLabel: {
    color: "#D4D4D8",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 12,
  },
  authInput: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 12,
    paddingHorizontal: 14,
    color: "#F5F5F5",
    backgroundColor: "#0F0F10",
    fontSize: 15,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#3B82F6",
    marginTop: 22,
  },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonPressed: { opacity: 0.82 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#262626",
    marginTop: 12,
  },
  secondaryButtonPressed: { backgroundColor: "#262626" },
  secondaryButtonText: { color: "#D4D4D8", fontSize: 15, fontWeight: "700" },
  safetyNote: {
    borderWidth: 1,
    borderColor: "#3F2F16",
    backgroundColor: "#1A1308",
    borderRadius: 14,
    padding: 16,
    marginTop: 18,
  },
  safetyTitle: { color: "#F59E0B", fontSize: 13, fontWeight: "800", marginBottom: 6 },
  safetyText: { color: "#D4D4D8", fontSize: 13, lineHeight: 19 },
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { padding: 16, gap: 10 },
  prototypeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: "700" },
  help: { color: "#555", marginBottom: 8 },
  signOutButton: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  signOutText: { color: "#333", fontWeight: "700" },
  label: { marginTop: 6, fontSize: 13, color: "#333", fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: "#fafafa",
  },
  mono: { marginTop: 14, fontFamily: "Courier", fontSize: 12 },
});

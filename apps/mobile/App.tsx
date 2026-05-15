import React, { useState } from "react";
import { SafeAreaView, Text, TextInput, Button, ScrollView, StyleSheet } from "react-native";

export default function App() {
  const [apiBase, setApiBase] = useState("http://127.0.0.1:8000");
  const [ocrLines, setOcrLines] = useState("31100-R40-A01\nAC DELCO REMAN");
  const [barcode, setBarcode] = useState("31100-R40-A01");
  const [blurScore, setBlurScore] = useState("0.9");
  const [log, setLog] = useState<string>("");

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
        <Text style={styles.title}>DeepSpec Mobile Shell</Text>
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
  safe: { flex: 1, backgroundColor: "#fff" },
  container: { padding: 16, gap: 10 },
  title: { fontSize: 22, fontWeight: "700" },
  help: { color: "#555", marginBottom: 8 },
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

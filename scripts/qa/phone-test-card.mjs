import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "http://127.0.0.1:5175";
const baseUrl = process.env.QA_BASE_URL?.trim() || DEFAULT_BASE_URL;
const qaRoot = path.resolve("artifacts", "qa");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(qaRoot, `phone-test-card-${stamp}`);

await mkdir(outputDir, { recursive: true });

const latestWebsiteReport = await findLatestFile(/^20.*Z$/, "report.md");
const latestExternalArReport = await findLatestExternalArReport();
const payload = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  outputDir,
  phoneStatus: "pending_physical_device",
  grade: 0,
  gradeReason: "Actual phone scan has not been performed from this machine.",
  latestWebsiteReport,
  latestExternalArReport,
  checks: [
    "Open the URL on the real phone over cellular or Wi-Fi.",
    "Choose Account > No email > Continue without email.",
    "Allow camera permission when prompted.",
    "Scan a real car part in the camera view and wait for the AR label and review card.",
    "Confirm the AR box is on the actual part, not the whole car or the wrong nearby panel.",
    "Confirm the label is specific, not generic.",
    "Open details, history, and chat for the saved result.",
    "Try uploading one known external QA image from the phone photo library.",
    "Record pass/fail, phone model, browser, network, and screenshots.",
  ],
};

await writeFile(path.join(outputDir, "phone-test-card.json"), `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(path.join(outputDir, "phone-test-card.md"), renderMarkdown(payload));
await writeFile(path.join(outputDir, "phone-test-card.html"), renderHtml(payload));

console.log(JSON.stringify({
  grade: payload.grade,
  outputDir,
  phoneStatus: payload.phoneStatus,
  url: baseUrl,
}, null, 2));

function renderMarkdown(data) {
  return [
    "# DeepSpec Phone QA Card",
    "",
    `- URL: ${data.baseUrl}`,
    `- Generated: ${data.generatedAt}`,
    `- Phone status: ${data.phoneStatus}`,
    `- Grade: ${data.grade}/10`,
    `- Reason: ${data.gradeReason}`,
    data.latestWebsiteReport ? `- Latest website QA: ${data.latestWebsiteReport}` : "- Latest website QA: not found",
    data.latestExternalArReport ? `- Latest external AR QA: ${data.latestExternalArReport}` : "- Latest external AR QA: not found",
    "",
    "## Required Real Phone Checks",
    "",
    ...data.checks.map((check, index) => `${index + 1}. ${check}`),
    "",
    "## Result",
    "",
    "- Phone model:",
    "- Browser:",
    "- Network:",
    "- Camera scan label:",
    "- Camera AR placement:",
    "- Upload scan label:",
    "- Upload AR placement:",
    "- Final phone grade:",
    "- Blocking issues:",
    "",
  ].join("\n");
}

function renderHtml(data) {
  const checks = data.checks.map((check) => `<li><label><input type="checkbox"> ${escapeHtml(check)}</label></li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DeepSpec Phone QA Card</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; max-width: 760px; line-height: 1.45; color: #111827; }
    code, .url { overflow-wrap: anywhere; }
    .status { display: inline-block; padding: 4px 8px; border: 1px solid #b45309; color: #92400e; border-radius: 6px; }
    li { margin: 10px 0; }
    textarea { width: 100%; min-height: 72px; }
  </style>
</head>
<body>
  <h1>DeepSpec Phone QA Card</h1>
  <p><strong>URL:</strong> <a class="url" href="${escapeHtml(data.baseUrl)}">${escapeHtml(data.baseUrl)}</a></p>
  <p><strong>Status:</strong> <span class="status">${escapeHtml(data.phoneStatus)}</span></p>
  <p><strong>Current grade:</strong> ${data.grade}/10</p>
  <p>${escapeHtml(data.gradeReason)}</p>
  <h2>Required Real Phone Checks</h2>
  <ol>${checks}</ol>
  <h2>Result Notes</h2>
  <p>Phone model / browser / network:</p>
  <textarea></textarea>
  <p>Camera scan label and AR placement:</p>
  <textarea></textarea>
  <p>Upload scan label and AR placement:</p>
  <textarea></textarea>
  <p>Final phone grade and blockers:</p>
  <textarea></textarea>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

async function findLatestExternalArReport() {
  const entries = await safeReadQaDirs();
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("external-public-ar-"))
    .sort((a, b) => b.name.localeCompare(a.name));

  for (const dir of dirs) {
    const reportPath = path.join(qaRoot, dir.name, "external-public-ar-qa.md");
    if (await fileExists(reportPath)) {
      return reportPath;
    }
  }

  return null;
}

async function findLatestFile(dirPattern, fileName) {
  const entries = await safeReadQaDirs();
  const dirs = entries
    .filter((entry) => entry.isDirectory() && dirPattern.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name));

  for (const dir of dirs) {
    const reportPath = path.join(qaRoot, dir.name, fileName);
    if (await fileExists(reportPath)) {
      return reportPath;
    }
  }

  return null;
}

async function safeReadQaDirs() {
  try {
    return await readdir(qaRoot, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

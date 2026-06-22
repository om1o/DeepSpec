import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "http://127.0.0.1:5175";
const baseUrl = process.env.QA_BASE_URL?.trim() || DEFAULT_BASE_URL;
const qaRoot = path.resolve("artifacts", "qa");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(qaRoot, `phone-test-card-${stamp}`);
const phoneUrl = classifyPhoneUrl(baseUrl);

await mkdir(outputDir, { recursive: true });

const latestWebsiteReport = await findLatestFile(/^20.*Z$/, "report.md");
const latestWebArReport = await findLatestArReport("web-public-ar-", "web-public-ar-qa.md");
const latestExternalArReport = await findLatestExternalArReport();
const payload = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(baseUrl)}`,
  outputDir,
  phoneStatus: phoneUrl.ok ? "pending_physical_device" : "blocked_public_https_url",
  grade: 0,
  gradeReason: phoneUrl.ok
    ? "Actual phone scan has not been performed from this machine."
    : phoneUrl.reason,
  phoneUrl,
  latestWebsiteReport,
  latestWebArReport,
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
  grading: [
    "URL opens on the phone over Wi-Fi or cellular",
    "No-email login reaches the scanner",
    "Camera permission prompt works",
    "Live camera preview renders",
    "A real car part scans successfully",
    "AR box lands on the actual part area",
    "AR label is specific, not generic",
    "Details page opens for the result",
    "History shows the saved scan",
    "Phone photo-library upload also scans with correct AR placement",
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
    `- Phone URL check: ${data.phoneUrl.ok ? "pass" : "blocked"} - ${data.phoneUrl.reason}`,
    `- QR code: ${data.qrCodeUrl}`,
    data.latestWebsiteReport ? `- Latest website QA: ${data.latestWebsiteReport}` : "- Latest website QA: not found",
    data.latestWebArReport ? `- Latest strict web AR QA: ${data.latestWebArReport}` : "- Latest strict web AR QA: not found",
    data.latestExternalArReport ? `- Latest external AR QA: ${data.latestExternalArReport}` : "- Latest external AR QA: not found",
    "",
    "## Required Real Phone Checks",
    "",
    ...data.checks.map((check, index) => `${index + 1}. ${check}`),
    "",
    "## 10 Point Phone Grade",
    "",
    ...data.grading.map((check, index) => `${index + 1}. [ ] ${check}`),
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
  const grading = data.grading
    .map((check, index) => `<li><label><input class="grade-check" type="checkbox"> <strong>${index + 1}.</strong> ${escapeHtml(check)}</label></li>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DeepSpec Phone QA Card</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; max-width: 760px; line-height: 1.45; color: #111827; }
    code, .url { overflow-wrap: anywhere; }
    img { border: 1px solid #d1d5db; border-radius: 8px; max-width: 240px; width: 100%; }
    .status { display: inline-block; padding: 4px 8px; border: 1px solid #b45309; color: #92400e; border-radius: 6px; }
    .score { border: 1px solid #d1d5db; border-radius: 8px; font-size: 24px; font-weight: 700; margin: 16px 0; padding: 12px; }
    li { margin: 10px 0; }
    textarea { width: 100%; min-height: 72px; }
  </style>
</head>
<body>
  <h1>DeepSpec Phone QA Card</h1>
  <p><strong>URL:</strong> <a class="url" href="${escapeHtml(data.baseUrl)}">${escapeHtml(data.baseUrl)}</a></p>
  <p><img alt="QR code for DeepSpec phone test URL" src="${escapeHtml(data.qrCodeUrl)}"></p>
  <p><strong>Status:</strong> <span class="status">${escapeHtml(data.phoneStatus)}</span></p>
  <p><strong>Current grade:</strong> ${data.grade}/10</p>
  <p>${escapeHtml(data.gradeReason)}</p>
  <p><strong>Phone URL check:</strong> ${data.phoneUrl.ok ? "pass" : "blocked"} - ${escapeHtml(data.phoneUrl.reason)}</p>
  <h2>Required Real Phone Checks</h2>
  <ol>${checks}</ol>
  <h2>10 Point Phone Grade</h2>
  <p class="score">Score: <span id="score">0</span>/10</p>
  <ol>${grading}</ol>
  <h2>Result Notes</h2>
  <p>Phone model / browser / network:</p>
  <textarea></textarea>
  <p>Camera scan label and AR placement:</p>
  <textarea></textarea>
  <p>Upload scan label and AR placement:</p>
  <textarea></textarea>
  <p>Final phone grade and blockers:</p>
  <textarea></textarea>
  <script>
    const score = document.getElementById("score");
    const checks = Array.from(document.querySelectorAll(".grade-check"));
    function updateScore() {
      score.textContent = checks.filter((check) => check.checked).length;
    }
    checks.forEach((check) => check.addEventListener("change", updateScore));
    updateScore();
  </script>
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

function classifyPhoneUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      reason: "QA_BASE_URL is not a valid URL. Use the Vercel Preview HTTPS URL for Dad's phone.",
      type: "invalid",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: "Real phone camera testing needs an HTTPS preview URL. Local HTTP URLs are desktop-only checks.",
      type: "not_https",
    };
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)) {
    return {
      ok: false,
      reason: "Localhost and 127.0.0.1 point at the phone itself, not this computer. Use a public Vercel Preview URL.",
      type: "loopback",
    };
  }

  return {
    ok: true,
    reason: "Public HTTPS URL is suitable for a real phone camera QA attempt.",
    type: "public_https",
  };
}

async function findLatestExternalArReport() {
  return findLatestArReport("external-public-ar-", "external-public-ar-qa.md");
}

async function findLatestArReport(prefix, reportFileName) {
  const entries = await safeReadQaDirs();
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .sort((a, b) => b.name.localeCompare(a.name));

  for (const dir of dirs) {
    const reportPath = path.join(qaRoot, dir.name, reportFileName);
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

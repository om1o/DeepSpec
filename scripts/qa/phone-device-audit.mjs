import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_BASE_URL = "http://127.0.0.1:5175";
const baseUrl = process.env.QA_BASE_URL?.trim() || DEFAULT_BASE_URL;
const qaRoot = path.resolve("artifacts", "qa");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(qaRoot, `phone-device-audit-${stamp}`);

await mkdir(outputDir, { recursive: true });

const tunnel = await checkUrl(baseUrl);
const adb = await auditCommand(await resolveAdbCommand(), ["devices"]);
const idevice = await auditCommand("idevice_id", ["-l"]);
const windowsDevices = process.platform === "win32" ? await auditWindowsPhoneDevices() : {
  ok: false,
  reason: `Windows PnP audit skipped on ${process.platform}.`,
  stdout: "",
  stderr: "",
};

const detectedSignals = [
  adb.ok && hasAndroidDevice(adb.stdout),
  idevice.ok && idevice.stdout.trim().length > 0,
  windowsDevices.ok && hasPhoneLikeWindowsDevice(windowsDevices.stdout),
];
const hasPhysicalDevice = detectedSignals.some(Boolean);
const grade = hasPhysicalDevice ? 1 : 0;
const status = hasPhysicalDevice ? "physical_device_detected_but_scan_unverified" : "no_physical_device_detected";
const gradeReason = hasPhysicalDevice
  ? "A phone-like device is visible, but no actual phone scan has been performed or graded."
  : "No Android, iPhone, iPad, ADB, MTP, or portable-phone device is visible to this Windows host.";

const payload = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  grade,
  gradeReason,
  outputDir,
  status,
  checks: {
    adb,
    idevice,
    tunnel,
    windowsDevices,
  },
  requiredNextEvidence: [
    "Open the temporary URL on a real phone.",
    "Complete no-email login on the phone.",
    "Allow camera access on the phone browser.",
    "Scan a real car part and capture the resulting label and AR placement.",
    "Upload a known QA image from the phone photo library and capture the resulting label and AR placement.",
  ],
};

await writeFile(path.join(outputDir, "phone-device-audit.json"), `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(path.join(outputDir, "phone-device-audit.md"), renderMarkdown(payload));

console.log(JSON.stringify({
  grade,
  outputDir,
  status,
  url: baseUrl,
}, null, 2));

async function checkUrl(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      error: formatError(error),
    };
  }
}

async function auditCommand(command, args) {
  if (!command) {
    return {
      command: "",
      args,
      available: false,
      ok: false,
      error: "Command was not found.",
      stderr: "",
      stdout: "",
    };
  }

  try {
    const result = await execFileAsync(command, args, {
      timeout: 20_000,
      windowsHide: true,
    });
    return {
      command,
      args,
      available: true,
      ok: true,
      stderr: result.stderr.trim(),
      stdout: result.stdout.trim(),
    };
  } catch (error) {
    return {
      command,
      args,
      available: error.code !== "ENOENT",
      ok: false,
      error: formatError(error),
      stderr: typeof error.stderr === "string" ? error.stderr.trim() : "",
      stdout: typeof error.stdout === "string" ? error.stdout.trim() : "",
    };
  }
}

async function resolveAdbCommand() {
  const candidates = [
    process.env.ADB_PATH,
    path.join(os.homedir(), "AppData", "Local", "Microsoft", "WinGet", "Packages", "Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe", "platform-tools", "adb.exe"),
    "adb",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === "adb" || await isExecutable(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function isExecutable(filePath) {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function auditWindowsPhoneDevices() {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$devices = Get-PnpDevice -PresentOnly | Where-Object {",
    "  $_.FriendlyName -match 'Android|iPhone|iPad|Apple|MTP|ADB|Portable Device|Phone|Samsung|Pixel|OnePlus|Motorola'",
    "  -or $_.InstanceId -match 'USB\\\\VID_05AC|USB\\\\VID_18D1|USB\\\\VID_04E8|USB\\\\VID_22B8|USB\\\\VID_2A70|USB\\\\VID_2717'",
    "}",
    "$devices | Select-Object Status, Class, FriendlyName, InstanceId | ConvertTo-Json -Depth 3",
  ].join("\n");

  return auditCommand("powershell", ["-NoProfile", "-Command", script]);
}

function hasAndroidDevice(output) {
  return output
    .split(/\r?\n/)
    .some((line) => /\bdevice\b/.test(line) && !/^List of devices/i.test(line));
}

function hasPhoneLikeWindowsDevice(output) {
  return /Android|iPhone|iPad|Apple|MTP|ADB|Portable Device|Phone|Samsung|Pixel|OnePlus|Motorola|VID_05AC|VID_18D1|VID_04E8|VID_22B8|VID_2A70|VID_2717/i.test(output);
}

function renderMarkdown(data) {
  return [
    "# DeepSpec Phone Device Audit",
    "",
    `- URL: ${data.baseUrl}`,
    `- Generated: ${data.generatedAt}`,
    `- Status: ${data.status}`,
    `- Grade: ${data.grade}/10`,
    `- Reason: ${data.gradeReason}`,
    `- Tunnel reachable: ${formatCheck(data.checks.tunnel)}`,
    `- adb: ${formatAdb(data.checks.adb)}`,
    `- idevice_id: ${formatTool(data.checks.idevice)}`,
    `- Windows phone-like devices: ${formatTool(data.checks.windowsDevices)}`,
    "",
    "## Required Next Evidence",
    "",
    ...data.requiredNextEvidence.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Raw Outputs",
    "",
    "### adb",
    "```text",
    data.checks.adb.stdout || data.checks.adb.stderr || data.checks.adb.error || "",
    "```",
    "",
    "### idevice_id",
    "```text",
    data.checks.idevice.stdout || data.checks.idevice.stderr || data.checks.idevice.error || "",
    "```",
    "",
    "### Windows Devices",
    "```json",
    data.checks.windowsDevices.stdout || data.checks.windowsDevices.stderr || data.checks.windowsDevices.error || "",
    "```",
    "",
  ].join("\n");
}

function formatCheck(check) {
  if (check.ok) {
    return `yes, HTTP ${check.status}`;
  }

  return `no, ${check.error || check.statusText || "unknown error"}`;
}

function formatTool(check) {
  if (!check.available) {
    return "not installed or not on PATH";
  }

  if (!check.ok) {
    return `available but failed: ${check.error || check.stderr || "unknown error"}`;
  }

  return check.stdout ? "available with output" : "available with no device output";
}

function formatAdb(check) {
  if (!check.available) {
    return "not installed or not on PATH";
  }

  if (!check.ok) {
    return `available but failed: ${check.error || check.stderr || "unknown error"}`;
  }

  if (!hasAndroidDevice(check.stdout)) {
    return "available, no Android devices attached or authorized";
  }

  return "available with Android device output";
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = process.cwd();
export const QA_ARTIFACT_DIR = process.env.QA_ARTIFACT_DIR
  ? resolve(process.env.QA_ARTIFACT_DIR)
  : join(REPO_ROOT, "artifacts", "qa", new Date().toISOString().replace(/[:.]/g, "-"));
export const DEFAULT_QA_BASE_URL = "http://localhost:3000";

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function writeTextFile(path, contents) {
  ensureDir(dirname(path));
  writeFileSync(path, contents.endsWith("\n") ? contents : `${contents}\n`, "utf8");
}

export function writeJsonFile(path, value) {
  writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function repoRelative(path) {
  return relative(REPO_ROOT, path).replaceAll("\\", "/");
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    ...options,
  });

  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

export function runGit(args, options = {}) {
  const result = runCommand("git", args);
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    const message = result.error?.message || result.stderr || `git ${args.join(" ")} failed`;
    throw new Error(message.trim());
  }

  return result;
}

export function markdownTable(headers, rows) {
  const header = `| ${headers.map(escapeTableCell).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map((cell) => escapeTableCell(String(cell ?? ""))).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

export function escapeTableCell(value) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r\n", "<br>")
    .replaceAll("\n", "<br>");
}

export function bulletList(items) {
  if (!items.length) {
    return "- None";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function maxByRisk(items) {
  const order = {
    skip: 0,
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };

  return items.reduce((highest, item) => {
    if (!highest) return item;
    return order[item.risk] > order[highest.risk] ? item : highest;
  }, null);
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "qa";
}

export function loadLocalEnv(...filenames) {
  for (const filename of filenames) {
    const path = join(REPO_ROOT, filename);
    let contents;

    try {
      contents = readFileSync(path, "utf8");
    } catch {
      continue;
    }

    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key]) continue;

      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

export function getConfiguredBaseUrl() {
  const configured = process.env.DEEPSPEC_QA_BASE_URL
    || process.env.QA_BASE_URL
    || process.env.PLAYWRIGHT_BASE_URL
    || process.env.VITE_QA_BASE_URL;

  return {
    baseUrl: trimTrailingSlash(configured || DEFAULT_QA_BASE_URL),
    configured: Boolean(configured),
    source: configured ? "env" : "default",
  };
}

export function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function isMainModule(metaUrl) {
  if (!process.argv[1]) {
    return false;
  }

  return resolve(fileURLToPath(metaUrl)) === resolve(process.argv[1]);
}

export function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

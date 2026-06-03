import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadQaEnv,
  parseQaArgs,
  resolveQaArtifactDir,
  resolveQaBaseUrl,
} from "./qa-utils.mjs";

loadQaEnv();

const parsedArgs = parseQaArgs(process.argv.slice(2));
const baseUrl = resolveQaBaseUrl(parsedArgs);
const artifactDir = resolveQaArtifactDir();
const passThroughArgs = process.argv.slice(2);
const doctorScript = fileURLToPath(new URL("./qa-doctor.mjs", import.meta.url));
const realTesterScript = fileURLToPath(new URL("./real-website-tester.mjs", import.meta.url));

process.env.QA_BASE_URL = baseUrl;
process.env.QA_ARTIFACT_DIR = artifactDir;
const childEnv = {
  ...process.env,
  QA_ARTIFACT_DIR: artifactDir,
  QA_BASE_URL: baseUrl,
};

const doctorExitCode = await run(process.execPath, [doctorScript, "--url", baseUrl], childEnv);
if (doctorExitCode !== 0) {
  console.error(`Website QA stopped after qa:doctor. Report: ${artifactDir}`);
  process.exit(doctorExitCode);
}

const realQaExitCode = await run(
  process.execPath,
  [realTesterScript, "--url", baseUrl, "--headed", ...passThroughArgs],
  childEnv,
);

process.exit(realQaExitCode);

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

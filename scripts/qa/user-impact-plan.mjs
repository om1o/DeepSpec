import { join } from "node:path";
import {
  QA_ARTIFACT_DIR,
  bulletList,
  isMainModule,
  markdownTable,
  maxByRisk,
  repoRelative,
  runGit,
  unique,
  writeJsonFile,
  writeTextFile,
} from "./qa-shared.mjs";

const OUTPUT_MD = join(QA_ARTIFACT_DIR, "user-impact-plan.md");
const OUTPUT_JSON = join(QA_ARTIFACT_DIR, "user-impact-plan.json");
const DEFAULT_LAST = 10;

const RISK_ORDER = {
  skip: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const RISK_RULES = [
  {
    risk: "critical",
    surface: "Payments, pricing, checkout, or quote calculation",
    roles: ["parent", "admin"],
    keywords: ["payment", "payments", "pricing", "price", "checkout", "quote", "invoice", "billing"],
    evidence: ["screenshot", "network logs", "database check", "payment/log snapshot"],
    test: "Create a parent quote, verify the displayed price, saved quote snapshot, payable offer, and checkout handoff all match the expected pricing rules.",
    question: "If this is wrong, what would the user experience? A parent could see, approve, or pay the wrong amount.",
  },
  {
    risk: "critical",
    surface: "Auth, session, login, signup, or password reset",
    roles: ["parent", "driver", "admin", "school"],
    keywords: ["auth", "session", "password", "reset", "login", "signin", "signup", "sign-in", "sign-up"],
    evidence: ["screenshot", "console logs", "network logs", "database check"],
    test: "Sign out, sign in with the configured QA account, create or start the supported no-email session, refresh the page, and verify protected routes stay fail-closed without a valid session.",
    question: "If this is wrong, what would the user experience? A real user could be locked out, dropped into the wrong account state, or reach protected data without a valid session.",
  },
  {
    risk: "critical",
    surface: "Parent booking flow",
    roles: ["parent", "school", "admin"],
    keywords: ["booking", "bookings", "reservation", "rider", "student"],
    evidence: ["screenshot", "network logs", "database check"],
    test: "Create a parent booking with realistic riders, dates, and pickup/dropoff details; verify confirmation, admin record, and any downstream handoff match.",
    question: "If this is wrong, what would the user experience? A parent or school could book the wrong ride, date, rider, or location.",
  },
  {
    risk: "critical",
    surface: "Driver route handoff",
    roles: ["driver", "admin", "school"],
    keywords: ["driver", "handoff", "route-handoff", "route_handoff"],
    evidence: ["screenshot", "network logs", "route/tracking snapshot"],
    test: "Open the driver route, accept or start the handoff, update route status, and verify parent/admin/school views show the same state.",
    question: "If this is wrong, what would the user experience? A driver could receive the wrong route or parents and schools could see stale route status.",
  },
  {
    risk: "critical",
    surface: "Student or parent tracking",
    roles: ["parent", "driver", "school"],
    keywords: ["student-tracking", "student_tracking", "parent-tracking", "parent_tracking", "tracking", "eta", "location"],
    evidence: ["screenshot", "network logs", "route/tracking snapshot"],
    test: "Open parent tracking and driver tracking views for the same route, verify location, ETA, stop state, and stale/offline indicators match the route source.",
    question: "If this is wrong, what would the user experience? A parent or school could see the wrong location, ETA, or student status.",
  },
  {
    risk: "critical",
    surface: "Admin actions that change real data",
    roles: ["admin", "internal ops"],
    keywords: ["admin", "approve", "delete", "archive", "restore", "mutate", "update", "upsert"],
    evidence: ["screenshot", "network logs", "database check"],
    test: "Perform the admin action in a safe environment, verify the confirmation state, database row, audit trail, and user-facing follow-up state.",
    question: "If this is wrong, what would the user experience? An admin could change the wrong record or leave real users with stale data.",
  },
  {
    risk: "critical",
    surface: "Database migration, permissions, or security",
    roles: ["admin", "internal ops", "system only"],
    keywords: ["migration", "migrations", "database", "schema", "supabase", "rls", "policy", "permission", "permissions", "security", "token", "secret"],
    evidence: ["database check", "network logs", "console logs"],
    test: "Apply the migration or permission change to a disposable database, run the Supabase verifier, and prove owner/cross-user reads behave correctly.",
    question: "If this is wrong, what would the user experience? Real users could lose data access, see someone else's data, or hit broken production writes.",
  },
  {
    risk: "high",
    surface: "Parent portal flow",
    roles: ["parent"],
    keywords: ["parent", "portal", "account", "profile"],
    evidence: ["screenshot", "console logs", "network logs"],
    test: "Walk the affected parent portal path on mobile and desktop, including refresh/back navigation and empty/error states.",
    question: "If this is wrong, what would the user experience? A parent could miss key trip, booking, quote, or account information.",
  },
  {
    risk: "high",
    surface: "Route display or tracking map",
    roles: ["parent", "driver", "school"],
    keywords: ["route", "map", "maps", "tracking-map", "tracking_map"],
    evidence: ["screenshot", "network logs", "route/tracking snapshot"],
    test: "Open the route display on mobile and desktop and verify stop order, route status, ETA, and empty/offline states.",
    question: "If this is wrong, what would the user experience? A driver, parent, or school could make decisions from a stale or incorrect route.",
  },
  {
    risk: "high",
    surface: "School onboarding or activity setup",
    roles: ["school", "admin"],
    keywords: ["school", "onboarding", "activity", "activities", "campus"],
    evidence: ["screenshot", "network logs", "database check"],
    test: "Create or edit school/activity onboarding data and verify the school view, admin view, and stored records match.",
    question: "If this is wrong, what would the user experience? A school could onboard with missing or incorrect operating details.",
  },
  {
    risk: "high",
    surface: "Notifications, SMS, or email",
    roles: ["parent", "driver", "school", "internal ops"],
    keywords: ["notification", "notifications", "sms", "email", "mail", "twilio"],
    evidence: ["network logs", "database check", "payment/log snapshot"],
    test: "Trigger the notification from the user action and verify the user-visible state, queued message, provider log, and retry/error handling.",
    question: "If this is wrong, what would the user experience? A user may never receive a time-sensitive update or may receive the wrong one.",
  },
  {
    risk: "high",
    surface: "Production configuration",
    roles: ["internal ops", "system only"],
    keywords: ["vite", "config", "env", "vercel", "pwa", "manifest", "robots", "sitemap"],
    evidence: ["console logs", "network logs"],
    test: "Build and load the app with production-like env values, then verify routing, assets, auth configuration, and console/network health.",
    question: "If this is wrong, what would the user experience? The app could load the wrong environment, fail at startup, or expose broken production behavior.",
  },
  {
    risk: "medium",
    surface: "Admin display",
    roles: ["admin", "internal ops"],
    keywords: ["dashboard", "card", "cards", "table", "row", "display"],
    evidence: ["screenshot", "console logs"],
    test: "Open the admin display at realistic data sizes and verify labels, counts, empty states, and mobile layout.",
    question: "If this is wrong, what would the user experience? An admin could misread status, counts, or record details.",
  },
  {
    risk: "medium",
    surface: "Forms, filtering, search, dates, uploads, or images",
    roles: ["parent", "driver", "admin", "school"],
    keywords: ["form", "filter", "search", "calendar", "date", "upload", "image", "photo", "camera", "scanner", "scan", "identify"],
    evidence: ["screenshot", "console logs", "network logs", "database check"],
    test: "Exercise the affected form or media path with valid, empty, and invalid inputs; verify saved state, visible errors, and refresh behavior.",
    question: "If this is wrong, what would the user experience? A user could submit the wrong data, fail to upload evidence, or see stale results.",
  },
  {
    risk: "low",
    surface: "UI polish, copy, Storybook-only, or non-critical display",
    roles: ["parent", "driver", "admin", "school"],
    keywords: ["css", "style", "copy", "storybook", "empty", "loading", "error-state", "visual"],
    evidence: ["screenshot"],
    test: "Run a focused visual check for the affected state and viewport, then verify no text overlap, broken empty state, or confusing copy.",
    question: "If this is wrong, what would the user experience? A user may see confusing copy, visual overlap, or a less trustworthy interface.",
  },
];

const STORYBOOK_FIRST_SURFACES = [
  "mobile modal vs inline panel",
  "parent route tracking card",
  "driver route status",
  "booking date picker",
  "pricing card",
  "empty states",
  "error states",
  "loading states",
  "admin cards/forms",
];

const REGRESSION_CANDIDATES = [
  "pricing",
  "quote",
  "payment status",
  "checkout",
  "parent tracking",
  "driver route handoff",
  "auth",
  "session",
  "password reset",
  "admin actions",
  "school",
  "activity onboarding",
  "database migrations",
  "review/merge blocker doctor",
];

if (isMainModule(import.meta.url)) {
  await main();
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const review = options.base ? inspectBaseDiff(options.base) : inspectLastCommits(options.last);
  const scenarios = buildScenarios(review.groups);
  const summary = buildSummary(review, scenarios);
  const payload = {
    generatedAt: new Date().toISOString(),
    options,
    review,
    summary,
    scenarios,
    storybookGuidance: buildStorybookGuidance(),
  };

  writeTextFile(OUTPUT_MD, renderMarkdown(payload));
  if (options.json) {
    writeJsonFile(OUTPUT_JSON, payload);
  }

  console.log(`Wrote ${repoRelative(OUTPUT_MD)}`);
  if (options.json) {
    console.log(`Wrote ${repoRelative(OUTPUT_JSON)}`);
  }
}

function parseArgs(argv) {
  const options = {
    base: "",
    json: false,
    last: DEFAULT_LAST,
    mode: "last",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--last") {
      options.last = parsePositiveInt(argv[index + 1], DEFAULT_LAST);
      options.mode = "last";
      index += 1;
    } else if (arg.startsWith("--last=")) {
      options.last = parsePositiveInt(arg.slice("--last=".length), DEFAULT_LAST);
      options.mode = "last";
    } else if (arg === "--base") {
      options.base = argv[index + 1] || "main";
      options.mode = "base";
      index += 1;
    } else if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length) || "main";
      options.mode = "base";
    }
  }

  return options;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function inspectLastCommits(last) {
  const log = runGit(["log", `-${last}`, "--pretty=format:%H%x09%h%x09%s"]).stdout.trim();
  const groups = log
    ? log.split(/\r?\n/).map((line) => {
      const [hash, shortHash, ...subjectParts] = line.split("\t");
      const subject = subjectParts.join("\t");
      return inspectCommit(hash, shortHash, subject);
    })
    : [];

  return {
    mode: "last",
    reviewed: `last ${last} commits`,
    summary: `Reviewed last ${last} commits.`,
    groups,
  };
}

function inspectCommit(hash, shortHash, subject) {
  const nameStatus = runGit(["show", "--format=", "--name-status", "--find-renames", hash]).stdout;
  const diffResult = runGit(["show", "--format=", "--unified=1", hash], { allowFailure: true });

  return {
    id: shortHash,
    title: subject,
    kind: "commit",
    commit: hash,
    summary: `${shortHash} ${subject}`,
    files: parseNameStatus(nameStatus),
    diff: diffResult.status === 0 && !diffResult.error ? diffResult.stdout : "",
    diffWarning: diffResult.status === 0 && !diffResult.error ? "" : "Full patch text was too large or unavailable; classification used changed file paths.",
  };
}

function inspectBaseDiff(base) {
  const resolvedBase = resolveBase(base);
  const range = `${resolvedBase}...HEAD`;
  const nameStatus = runGit(["diff", "--name-status", "--find-renames", range]).stdout;
  const diffResult = runGit(["diff", "--unified=1", range], { allowFailure: true });
  const commits = runGit(["log", "--oneline", `${resolvedBase}..HEAD`], { allowFailure: true }).stdout.trim().split(/\r?\n/).filter(Boolean);
  const stat = runGit(["diff", "--stat", range], { allowFailure: true }).stdout.trim();

  return {
    mode: "base",
    reviewed: `current branch diff against ${resolvedBase}`,
    summary: `Reviewed current branch diff against ${resolvedBase}.`,
    base: resolvedBase,
    commits,
    stat,
    groups: [
      {
        id: `diff:${resolvedBase}`,
        title: `Current branch diff against ${resolvedBase}`,
        kind: "diff",
        summary: commits.length ? commits.join("; ") : `Diff against ${resolvedBase}`,
        files: parseNameStatus(nameStatus),
        diff: diffResult.status === 0 && !diffResult.error ? diffResult.stdout : "",
        diffWarning: diffResult.status === 0 && !diffResult.error ? "" : "Full patch text was too large or unavailable; classification used changed file paths.",
      },
    ],
  };
}

function resolveBase(base) {
  const local = runGit(["rev-parse", "--verify", base], { allowFailure: true });
  if (local.status === 0) {
    return base;
  }

  const remote = `origin/${base}`;
  const remoteResult = runGit(["rev-parse", "--verify", remote], { allowFailure: true });
  if (remoteResult.status === 0) {
    return remote;
  }

  throw new Error(`Could not resolve base '${base}'.`);
}

function parseNameStatus(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split(/\s+/);
      const path = status.startsWith("R") || status.startsWith("C") ? paths[paths.length - 1] : paths[0];
      return { status, path };
    });
}

function buildScenarios(groups) {
  return groups.flatMap((group) => {
    if (!group.files.length) {
      return [{
        groupId: group.id,
        groupTitle: group.title,
        changedSurface: "No changed files",
        files: [],
        roles: ["system only"],
        risk: "skip",
        userImpactQuestion: "If this is wrong, what would the user experience? No user-facing change was detected.",
        recommendedTest: "No QA needed for this empty diff.",
        qaType: "skip",
        reasoning: "Git reported no changed files for this review target.",
        evidence: [],
        regressionCandidate: false,
        storybook: "Not needed.",
      }];
    }

    const fileAssessments = group.files.map((file) => classifyFile(file, group.diff));
    const allSkippable = fileAssessments.every((item) => item.risk === "skip");
    if (allSkippable) {
      return [scenarioFromAssessments(group, fileAssessments, "Skipped non-user-facing changes")];
    }

    const bySurface = new Map();
    for (const assessment of fileAssessments.filter((item) => item.risk !== "skip")) {
      const current = bySurface.get(assessment.surface) || [];
      current.push(assessment);
      bySurface.set(assessment.surface, current);
    }

    return [...bySurface.entries()].map(([surface, assessments]) => scenarioFromAssessments(group, assessments, surface));
  });
}

function classifyFile(file, diff) {
  const path = file.path;
  const lower = path.toLowerCase();
  const diffOnlyComments = isCommentsOnlyDiff(diff, path);

  if (isDocsOnly(lower)) {
    return skipAssessment(file, "Docs-only change.");
  }

  if (diffOnlyComments) {
    return skipAssessment(file, "Comments-only or whitespace-only change.");
  }

  if (isTestOnly(lower) && !containsAny(lower, ["auth", "payment", "pricing", "checkout", "quote", "tracking", "route", "admin", "school", "migration"])) {
    return skipAssessment(file, "Test-only change outside a critical coverage area.");
  }

  const matchedRules = RISK_RULES.filter((rule) => containsAny(lower, rule.keywords));
  let rule = maxByRisk(matchedRules);

  if (!rule) {
    rule = inferFallbackRule(lower);
  }

  const testCoverageNote = isTestOnly(lower) ? " This is test coverage for a user-critical area, so it is not skipped." : "";

  return {
    file,
    surface: rule.surface,
    roles: rule.roles,
    risk: rule.risk,
    userImpactQuestion: rule.question,
    recommendedTest: rule.test,
    evidence: rule.evidence,
    reasoning: `Matched ${rule.risk} user-impact surface from ${path}.${testCoverageNote}`,
  };
}

function skipAssessment(file, reasoning) {
  return {
    file,
    surface: "Non-user-facing maintenance",
    roles: ["system only"],
    risk: "skip",
    userImpactQuestion: "If this is wrong, what would the user experience? No direct user-facing behavior should change.",
    recommendedTest: "Skip user-impact QA. Keep normal repo checks if this change is part of a release.",
    evidence: [],
    reasoning: `${reasoning} File: ${file.path}`,
  };
}

function inferFallbackRule(lower) {
  if (lower.startsWith("src/screens/") || lower.startsWith("src/components/") || lower.endsWith(".tsx") || lower.endsWith(".css")) {
    return RISK_RULES.find((rule) => rule.risk === "low");
  }

  if (lower.startsWith("api/") || lower.startsWith("src/services/") || lower.startsWith("src/lib/")) {
    return RISK_RULES.find((rule) => rule.risk === "medium");
  }

  if (lower === "package.json" || lower === "package-lock.json" || lower.includes("tsconfig") || lower.includes("eslint")) {
    return {
      risk: "low",
      surface: "Build or test tooling",
      roles: ["internal ops", "system only"],
      evidence: ["console logs"],
      test: "Run the affected npm script and the standard repo check to prove local developer and release workflows still work.",
      question: "If this is wrong, what would the user experience? Users may not notice immediately, but the team could ship unverified or broken builds.",
    };
  }

  return {
    risk: "low",
    surface: "System-only implementation detail",
    roles: ["system only"],
    evidence: ["console logs"],
    test: "Run the smallest relevant automated check and inspect whether any user route, data write, or environment behavior changed.",
    question: "If this is wrong, what would the user experience? No direct user-facing change is obvious from the file path.",
  };
}

function isDocsOnly(lower) {
  return lower.endsWith(".md")
    || lower.startsWith("docs/")
    || lower === "readme.md"
    || lower === "agents.md"
    || lower.includes("/readme.");
}

function isTestOnly(lower) {
  return lower.includes(".test.")
    || lower.includes(".spec.")
    || lower.startsWith("test/")
    || lower.startsWith("tests/")
    || lower.includes("__tests__");
}

function isCommentsOnlyDiff(diff, filePath) {
  const fileMarker = ` b/${filePath}`;
  const fileChunks = diff.split(/^diff --git /m).filter((chunk) => chunk.includes(fileMarker));
  if (!fileChunks.length) {
    return false;
  }

  const changedLines = fileChunks.join("\n").split(/\r?\n/)
    .filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"))
    .map((line) => line.slice(1).trim())
    .filter(Boolean);

  return changedLines.length > 0 && changedLines.every(isCommentLikeLine);
}

function isCommentLikeLine(line) {
  return line.startsWith("//")
    || line.startsWith("#")
    || line.startsWith("/*")
    || line.startsWith("*")
    || line.startsWith("*/")
    || line.startsWith("<!--")
    || line.endsWith("-->")
    || /^[,;{}()[\]\s]+$/.test(line);
}

function containsAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function scenarioFromAssessments(group, assessments, surface) {
  const highest = maxByRisk(assessments);
  const files = unique(assessments.map((assessment) => assessment.file.path));
  const roles = unique(assessments.flatMap((assessment) => assessment.roles));
  const evidence = unique(assessments.flatMap((assessment) => assessment.evidence));
  const risk = highest.risk;
  const regressionCandidate = isRegressionCandidate(surface, files);

  return {
    groupId: group.id,
    groupTitle: group.title,
    changedSurface: surface,
    files,
    roles,
    risk,
    userImpactQuestion: highest.userImpactQuestion,
    recommendedTest: highest.recommendedTest,
    qaType: chooseQaType(risk, surface, files, regressionCandidate),
    reasoning: unique(assessments.map((assessment) => assessment.reasoning)).join(" "),
    evidence,
    regressionCandidate,
    storybook: storybookAdvice(risk, surface, files),
    diffWarning: group.diffWarning || "",
  };
}

function isRegressionCandidate(surface, files) {
  const haystack = `${surface} ${files.join(" ")}`.toLowerCase();
  return REGRESSION_CANDIDATES.some((candidate) => haystack.includes(candidate));
}

function chooseQaType(risk, surface, files, regressionCandidate) {
  if (risk === "skip") return "skip";
  if (regressionCandidate || risk === "critical") return "permanent regression candidate";
  if (risk === "high") return "Playwright browser test";
  if (shouldUseStorybook(surface, files)) return "Storybook visual check";
  if (risk === "medium") return "one-time manual QA";
  return "Storybook visual check";
}

function storybookAdvice(risk, surface, files) {
  if (risk === "skip") {
    return "Not needed.";
  }

  if (shouldUseStorybook(surface, files) && RISK_ORDER[risk] <= RISK_ORDER.medium) {
    return "Storybook is enough if the change is isolated to the visual state and has no auth, route, network, database, payment, or tracking behavior.";
  }

  if (shouldUseStorybook(surface, files)) {
    return "Use Storybook first for the UI state, then run Playwright because this surface can affect real user flow or data.";
  }

  return "Use full Playwright or manual product QA; Storybook alone is not enough for this behavior.";
}

function shouldUseStorybook(surface, files) {
  const haystack = `${surface} ${files.join(" ")}`.toLowerCase();
  return STORYBOOK_FIRST_SURFACES.some((surfaceName) => haystack.includes(surfaceName.split(" ")[0]))
    || files.some((file) => {
      const lower = file.toLowerCase();
      return lower.startsWith("src/components/")
        || lower.includes("storybook")
        || lower.endsWith(".css");
    });
}

function buildSummary(review, scenarios) {
  const highRiskAreas = unique(scenarios.filter((scenario) => RISK_ORDER[scenario.risk] >= RISK_ORDER.high).map((scenario) => scenario.changedSurface));
  const skipped = scenarios.filter((scenario) => scenario.risk === "skip").length;
  const changedFiles = unique(review.groups.flatMap((group) => group.files.map((file) => file.path)));

  return {
    reviewed: review.reviewed,
    highRiskAreas,
    skippedCount: skipped,
    changedFiles,
    highestValue: scenarios.filter((scenario) => scenario.risk !== "skip").sort((a, b) => RISK_ORDER[b.risk] - RISK_ORDER[a.risk])[0] || null,
  };
}

function buildStorybookGuidance() {
  return {
    useStorybookFor: STORYBOOK_FIRST_SURFACES,
    storybookEnoughWhen: "The change is isolated to a visual state, component layout, copy, loading, error, or empty state with no route, auth, network, database, payment, tracking, or handoff behavior.",
    fullPlaywrightNeededWhen: "The change can alter a user workflow, persisted data, permissions, checkout/pricing, route/tracking state, notifications, or cross-role visibility.",
  };
}

function renderMarkdown({ review, summary, scenarios, storybookGuidance }) {
  const matrixRows = scenarios.map((scenario) => [
    scenario.groupId,
    scenario.changedSurface,
    scenario.roles.join(", "),
    scenario.risk,
    scenario.qaType,
    scenario.recommendedTest,
  ]);
  const highest = summary.highestValue;

  return `# User Impact QA Plan

## Summary

${review.summary}

High-risk areas found:
${bulletList(summary.highRiskAreas)}

Skipped:
- ${summary.skippedCount} skipped scenario(s), usually docs-only, comments-only, metadata-only, formatting-only, or non-critical test-only changes.

## Commit Or Diff Summary

${renderReviewDetails(review)}

## Changed Files

${bulletList(summary.changedFiles)}

## QA Matrix

${markdownTable(["Commit/Diff", "Changed Surface", "Role", "Risk", "Test Type", "Recommended Test"], matrixRows)}

## Highest-Value QA Test

${highest ? renderHighestValue(highest) : "No user-facing QA scenario was detected for this review target."}

## Scenario Details

${scenarios.map(renderScenario).join("\n\n")}

## Storybook Guidance

Storybook first:
${bulletList(storybookGuidance.useStorybookFor)}

Storybook is enough when:
${storybookGuidance.storybookEnoughWhen}

Full Playwright is needed when:
${storybookGuidance.fullPlaywrightNeededWhen}
`;
}

function renderReviewDetails(review) {
  if (review.mode === "base") {
    return [
      `Base: ${review.base}`,
      "",
      "Commits:",
      bulletList(review.commits),
      "",
      "Diff stat:",
      review.stat ? `\`\`\`\n${review.stat}\n\`\`\`` : "No diff stat.",
    ].join("\n");
  }

  return bulletList(review.groups.map((group) => `${group.id} ${group.title}`));
}

function renderHighestValue(scenario) {
  return `Role:
${scenario.roles.join(", ")}

Surface:
${scenario.changedSurface}

Question:
${scenario.userImpactQuestion}

Test:
${scenario.recommendedTest}

Evidence:
${bulletList(scenario.evidence)}

Regression?
${scenario.regressionCandidate ? "Yes, because this matches a known user-impact regression candidate." : "No, one-time QA is enough unless this area keeps regressing."}`;
}

function renderScenario(scenario) {
  return `### ${scenario.groupId} - ${scenario.changedSurface}

- Affected role: ${scenario.roles.join(", ")}
- Risk tier: ${scenario.risk}
- User-impact question: ${scenario.userImpactQuestion}
- Recommended QA test: ${scenario.recommendedTest}
- QA type: ${scenario.qaType}
- Reasoning: ${scenario.reasoning}
- Diff warning: ${scenario.diffWarning || "none"}
- Suggested evidence: ${scenario.evidence.length ? scenario.evidence.join(", ") : "none"}
- Storybook vs Playwright: ${scenario.storybook}
- Changed files: ${scenario.files.length ? scenario.files.join(", ") : "none"}`;
}

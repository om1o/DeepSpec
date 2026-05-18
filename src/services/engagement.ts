import type { FeedbackSubmission, WaitlistSignup } from "../types";

export const ENGAGEMENT_STORAGE_KEY = "deep-spec:engagement";
const MAX_ENTRIES = 100;

type EngagementData = {
  waitlist: WaitlistSignup[];
  feedback: FeedbackSubmission[];
};

type SaveResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      message: string;
      value: T;
    };

export function getEngagementData(): EngagementData {
  if (!hasLocalStorage()) {
    return { waitlist: [], feedback: [] };
  }

  try {
    const rawData = localStorage.getItem(ENGAGEMENT_STORAGE_KEY);
    if (!rawData) {
      return { waitlist: [], feedback: [] };
    }

    const parsed = JSON.parse(rawData) as Partial<EngagementData>;
    return {
      waitlist: Array.isArray(parsed.waitlist)
        ? parsed.waitlist.map(normalizeSignup).filter((signup): signup is WaitlistSignup => Boolean(signup))
        : [],
      feedback: Array.isArray(parsed.feedback)
        ? parsed.feedback.map(normalizeFeedback).filter((feedback): feedback is FeedbackSubmission => Boolean(feedback))
        : [],
    };
  } catch {
    return { waitlist: [], feedback: [] };
  }
}

export function saveWaitlistSignup(input: {
  email: string;
  mainProblem: string;
  userType: WaitlistSignup["userType"];
}): SaveResult<WaitlistSignup | null> {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) {
    return { ok: false, message: "Enter a real email address.", value: null };
  }

  const data = getEngagementData();
  const signup: WaitlistSignup = {
    id: createId(),
    createdAt: new Date().toISOString(),
    email,
    userType: isUserType(input.userType) ? input.userType : "other",
    mainProblem: cleanText(input.mainProblem, 240),
  };

  const dedupedWaitlist = data.waitlist.filter((entry) => entry.email !== email);
  const nextData = {
    ...data,
    waitlist: [signup, ...dedupedWaitlist].slice(0, MAX_ENTRIES),
  };
  const writeResult = writeEngagementData(nextData);

  return writeResult.ok ? { ok: true, value: signup } : { ok: false, message: writeResult.message, value: signup };
}

export function saveFeedbackSubmission(input: {
  category: FeedbackSubmission["category"];
  contactEmail: string;
  message: string;
}): SaveResult<FeedbackSubmission | null> {
  const message = cleanText(input.message, 800);
  if (message.length < 8) {
    return { ok: false, message: "Write a little more detail first.", value: null };
  }

  const contactEmail = normalizeEmail(input.contactEmail);
  if (contactEmail && !isEmail(contactEmail)) {
    return { ok: false, message: "That contact email does not look right.", value: null };
  }

  const data = getEngagementData();
  const feedback: FeedbackSubmission = {
    id: createId(),
    createdAt: new Date().toISOString(),
    category: isFeedbackCategory(input.category) ? input.category : "other",
    message,
    contactEmail,
  };

  const nextData = {
    ...data,
    feedback: [feedback, ...data.feedback].slice(0, MAX_ENTRIES),
  };
  const writeResult = writeEngagementData(nextData);

  return writeResult.ok ? { ok: true, value: feedback } : { ok: false, message: writeResult.message, value: feedback };
}

function writeEngagementData(data: EngagementData): SaveResult<EngagementData> {
  if (!hasLocalStorage()) {
    return {
      ok: false,
      message: "Early access forms are not available in this browser.",
      value: data,
    };
  }

  try {
    localStorage.setItem(ENGAGEMENT_STORAGE_KEY, JSON.stringify(data));
    return { ok: true, value: data };
  } catch (error) {
    return {
      ok: false,
      message: isQuotaError(error)
        ? "Your device storage is full. Delete older saved data, then try again."
        : "Deep Spec could not save this on this device.",
      value: data,
    };
  }
}

function normalizeSignup(value: unknown): WaitlistSignup | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const signup = value as Partial<WaitlistSignup>;
  if (
    typeof signup.id !== "string" ||
    typeof signup.createdAt !== "string" ||
    typeof signup.email !== "string" ||
    !isEmail(signup.email)
  ) {
    return null;
  }

  return {
    id: signup.id,
    createdAt: signup.createdAt,
    email: normalizeEmail(signup.email),
    userType: isUserType(signup.userType) ? signup.userType : "other",
    mainProblem: typeof signup.mainProblem === "string" ? cleanText(signup.mainProblem, 240) : "",
  };
}

function normalizeFeedback(value: unknown): FeedbackSubmission | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const feedback = value as Partial<FeedbackSubmission>;
  if (typeof feedback.id !== "string" || typeof feedback.createdAt !== "string" || typeof feedback.message !== "string") {
    return null;
  }

  const contactEmail = typeof feedback.contactEmail === "string" ? normalizeEmail(feedback.contactEmail) : "";

  return {
    id: feedback.id,
    createdAt: feedback.createdAt,
    category: isFeedbackCategory(feedback.category) ? feedback.category : "other",
    message: cleanText(feedback.message, 800),
    contactEmail: isEmail(contactEmail) ? contactEmail : "",
  };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase().slice(0, 160);
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanText(value: string, maxLength: number) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function isUserType(value: unknown): value is WaitlistSignup["userType"] {
  return (
    value === "car_owner" ||
    value === "van_life" ||
    value === "used_car_buyer" ||
    value === "weekend_wrencher" ||
    value === "other"
  );
}

function isFeedbackCategory(value: unknown): value is FeedbackSubmission["category"] {
  return (
    value === "scanner" ||
    value === "ai_result" ||
    value === "saved_scans" ||
    value === "chat" ||
    value === "business" ||
    value === "other"
  );
}

function hasLocalStorage() {
  return typeof localStorage !== "undefined";
}

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `engagement-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isQuotaError(error: unknown) {
  return error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

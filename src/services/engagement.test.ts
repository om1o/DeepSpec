import {
  ENGAGEMENT_STORAGE_KEY,
  getEngagementData,
  saveFeedbackSubmission,
  saveWaitlistSignup,
} from "./engagement";

describe("engagement", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("saves waitlist signups locally and dedupes by email", () => {
    const first = saveWaitlistSignup({
      email: "TEST@Example.com ",
      mainProblem: "I want help before buying a used car.",
      userType: "used_car_buyer",
    });
    const second = saveWaitlistSignup({
      email: "test@example.com",
      mainProblem: "Updated problem.",
      userType: "car_owner",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(getEngagementData().waitlist).toHaveLength(1);
    expect(getEngagementData().waitlist[0]).toMatchObject({
      email: "test@example.com",
      mainProblem: "Updated problem.",
      userType: "car_owner",
    });
  });

  it("rejects invalid waitlist emails", () => {
    const result = saveWaitlistSignup({
      email: "bad",
      mainProblem: "",
      userType: "car_owner",
    });

    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
  });

  it("saves feedback locally", () => {
    const result = saveFeedbackSubmission({
      category: "business",
      contactEmail: "owner@example.com",
      message: "I would pay for a clean used-car inspection report.",
    });

    expect(result.ok).toBe(true);
    expect(getEngagementData().feedback[0]).toMatchObject({
      category: "business",
      contactEmail: "owner@example.com",
      message: "I would pay for a clean used-car inspection report.",
    });
  });

  it("ignores corrupt engagement storage", () => {
    localStorage.setItem(ENGAGEMENT_STORAGE_KEY, "{bad json");

    expect(getEngagementData()).toEqual({ waitlist: [], feedback: [] });
  });
});

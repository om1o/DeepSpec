export type Lookup = {
  id: string;
  createdAt: string;
  imageBase64: string;
  userCarContext: string;
  userProblemContext: string;
  result: LookupResultPayload;
  rating: "up" | "down" | null;
  correction: string | null;
  chatHistory: ChatMessage[];
};

export type LookupResultPayload = {
  partName: string;
  confidence: "high" | "medium" | "low";
  whatItDoes: string;
  conditionObservations: string[];
  concerns: string[];
  isSafetyCritical: boolean;
  nextSteps: string;
  needsBetterPhoto: boolean;
  followUpQuestions: string[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

/** Raw JSON shapes from Gemini (snake_case) */
export type IdentifyJson = {
  part_name: string;
  confidence: "high" | "medium" | "low";
  what_it_does: string;
  condition_observations: string[];
  concerns: string[];
  is_safety_critical: boolean;
  next_steps: string;
  needs_better_photo: boolean;
  follow_up_questions?: string[];
};

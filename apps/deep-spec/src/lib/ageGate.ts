/** localStorage key — keep in sync with AgeGate confirm action */
export const AGE_CONFIRMED_LS_KEY = "deep-spec:age-confirmed-v1";

export function isAgeConfirmed(): boolean {
  return localStorage.getItem(AGE_CONFIRMED_LS_KEY) === "yes";
}

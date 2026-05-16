export type MotionPermissionState = "idle" | "granted" | "denied" | "unsupported";

export type CapturedFrame = {
  imageBase64: string;
  capturedAt: string;
};

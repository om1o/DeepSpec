import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MotionPermissionState } from "../types";

type PermissionResponse = "granted" | "denied";

type DeviceMotionConstructor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionResponse>;
};

type MotionSample = {
  time: number;
  still: boolean;
};

export const STILLNESS_CONFIG = {
  stableDurationMs: 2000,
  accelerationThreshold: 0.5,
  rotationThreshold: 5,
} as const;

export function useStillness() {
  const [permissionState, setPermissionState] = useState<MotionPermissionState>(() => {
    if (!hasMotionEvent()) {
      return "unsupported";
    }

    return requiresMotionPermission() ? "idle" : "granted";
  });
  const [isStableFromMotion, setIsStableFromMotion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const samplesRef = useRef<MotionSample[]>([]);
  const hasReceivedMotionRef = useRef(false);

  const needsPermission = permissionState === "idle";
  const usesFallback = permissionState === "unsupported" || permissionState === "denied";
  const isStable = usesFallback ? true : isStableFromMotion;

  const requestPermission = useCallback(async () => {
    if (!hasMotionEvent()) {
      setPermissionState("unsupported");
      return;
    }

    const MotionEventConstructor = window.DeviceMotionEvent as DeviceMotionConstructor;

    try {
      if (typeof MotionEventConstructor.requestPermission === "function") {
        const result = await MotionEventConstructor.requestPermission();
        setPermissionState(result === "granted" ? "granted" : "denied");
        return;
      }

      setPermissionState("granted");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Motion permission failed.");
      setPermissionState("denied");
    }
  }, []);

  useEffect(() => {
    if (permissionState !== "granted") {
      return undefined;
    }

    const handleMotion = (event: DeviceMotionEvent) => {
      hasReceivedMotionRef.current = true;

      const now = Date.now();
      const still = isMotionSampleStill(event);

      const samples = samplesRef.current.filter((sample) => now - sample.time <= STILLNESS_CONFIG.stableDurationMs);
      samples.push({ time: now, still });
      samplesRef.current = samples;

      const firstSample = samples[0];
      const hasFullWindow = Boolean(firstSample && now - firstSample.time >= STILLNESS_CONFIG.stableDurationMs - 100);
      setIsStableFromMotion(hasFullWindow && samples.every((sample) => sample.still));
    };

    window.addEventListener("devicemotion", handleMotion);

    const fallbackTimer = window.setTimeout(() => {
      if (!hasReceivedMotionRef.current) {
        setPermissionState("unsupported");
      }
    }, 1400);

    return () => {
      window.removeEventListener("devicemotion", handleMotion);
      window.clearTimeout(fallbackTimer);
    };
  }, [permissionState]);

  return useMemo(
    () => ({
      error,
      isStable,
      needsPermission,
      permissionState,
      requestPermission,
      usesFallback,
    }),
    [error, isStable, needsPermission, permissionState, requestPermission, usesFallback],
  );
}

function hasMotionEvent() {
  return typeof window !== "undefined" && "DeviceMotionEvent" in window;
}

function requiresMotionPermission() {
  if (!hasMotionEvent()) {
    return false;
  }

  return typeof (window.DeviceMotionEvent as DeviceMotionConstructor).requestPermission === "function";
}

export function isMotionSampleStill(event: Pick<DeviceMotionEvent, "acceleration" | "accelerationIncludingGravity" | "rotationRate">) {
  const acceleration = getAccelerationMagnitude(event);
  const rotation = getRotationMagnitude(event);

  return acceleration < STILLNESS_CONFIG.accelerationThreshold && rotation < STILLNESS_CONFIG.rotationThreshold;
}

function getAccelerationMagnitude(event: Pick<DeviceMotionEvent, "acceleration" | "accelerationIncludingGravity">) {
  const acceleration = event.acceleration;
  if (acceleration && hasNumber(acceleration.x) && hasNumber(acceleration.y) && hasNumber(acceleration.z)) {
    return magnitude(acceleration.x, acceleration.y, acceleration.z);
  }

  const includingGravity = event.accelerationIncludingGravity;
  if (
    includingGravity &&
    hasNumber(includingGravity.x) &&
    hasNumber(includingGravity.y) &&
    hasNumber(includingGravity.z)
  ) {
    return Math.abs(magnitude(includingGravity.x, includingGravity.y, includingGravity.z) - 9.81);
  }

  return 0;
}

function getRotationMagnitude(event: Pick<DeviceMotionEvent, "rotationRate">) {
  const rotation = event.rotationRate;
  if (!rotation) {
    return 0;
  }

  return magnitude(rotation.alpha ?? 0, rotation.beta ?? 0, rotation.gamma ?? 0);
}

function magnitude(x: number, y: number, z: number) {
  return Math.sqrt(x * x + y * y + z * z);
}

function hasNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

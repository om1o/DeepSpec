import { useEffect, useState } from "react";
import { bootstrapStorageBackend, getActiveStorageBackend } from "../services/storage";
import AgeGate from "./AgeGate";
import { isAgeConfirmed } from "../lib/ageGate";
import App from "../App";

function Splash({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ds-bg px-6 text-[15px] text-ds-muted">
      <p className="animate-pulse">{message}</p>
    </div>
  );
}

export default function AppBootstrap() {
  const [ageOk, setAgeOk] = useState(() => isAgeConfirmed());
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    if (!ageOk) return;
    let cancelled = false;
    (async () => {
      await bootstrapStorageBackend();
      if (cancelled) return;
      const mode = getActiveStorageBackend();
      console.info("[storage]", { backend: mode });
      setStorageReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [ageOk]);

  if (!ageOk) {
    return <AgeGate onConfirmed={() => setAgeOk(true)} />;
  }

  if (!storageReady) {
    return <Splash message="Preparing storage…" />;
  }

  return <App />;
}

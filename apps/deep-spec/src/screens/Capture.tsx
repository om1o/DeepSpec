import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AIServiceError, runAI } from "../services/aiService";
import { IDENTIFY_PROMPT } from "../services/systemPrompts";
import { saveNewLookup } from "../services/storage";
import type { IdentifyJson } from "../types";
import { mapIdentifyJson } from "../lib/mapIdentify";
import { cn, compressImageFile } from "../lib/utils";
import { Button, Card } from "../components/ui";

function buildVisionUserMessage(car: string, problem: string) {
  const lines = [
    car.trim() ? `Vehicle context from user:\n${car.trim()}` : "",
    problem.trim() ? `What appears to be going on:\n${problem.trim()}` : "",
    "Identify and analyze the automotive part visible in this photo. Follow all output rules.",
  ].filter(Boolean);
  return lines.join("\n\n");
}

export default function Capture() {
  const navigate = useNavigate();
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [car, setCar] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const onPick = useCallback(async (file: File | null) => {
    setErrMsg(null);
    if (!file?.type.startsWith("image/")) {
      setErrMsg("Pick a JPG or PNG image.");
      setImageDataUrl(null);
      return;
    }
    try {
      setImageDataUrl(await compressImageFile(file));
    } catch {
      setErrMsg("Could not read that photo. Try another file.");
      setImageDataUrl(null);
    }
  }, []);

  const onIdentify = useCallback(async () => {
    if (!imageDataUrl || busy) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const raw = await runAI({
        type: "vision",
        imageBase64: imageDataUrl,
        userMessage: buildVisionUserMessage(car, problem),
        systemPrompt: IDENTIFY_PROMPT,
        responseAsJson: true,
      });
      const result = mapIdentifyJson(raw as IdentifyJson);
      const id = crypto.randomUUID();
      const lookup = {
        id,
        createdAt: new Date().toISOString(),
        imageBase64: imageDataUrl,
        userCarContext: car,
        userProblemContext: problem,
        result,
        rating: null,
        correction: null,
        chatHistory: [],
      };
      await saveNewLookup(lookup);
      navigate(`/result/${id}`, { replace: true });
    } catch (e) {
      const msg =
        e instanceof AIServiceError ? e.message : e instanceof Error ? e.message : "Something went wrong.";
      setErrMsg(msg);
    } finally {
      setBusy(false);
    }
  }, [busy, car, imageDataUrl, navigate, problem]);

  return (
    <div className="flex min-h-screen flex-col px-4 pb-10 pt-4">
      <header className="mb-6 flex items-center gap-3">
        <Link className="text-[15px] font-medium text-ds-primary hover:underline" to="/">
          Back
        </Link>
      </header>

      <Card className="mb-6 overflow-hidden border-0 shadow-md dark:bg-ds-card">
        <label className="block cursor-pointer">
          {!imageDataUrl ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 bg-neutral-100 p-8 text-center dark:bg-neutral-900/70">
              <span className="text-[17px] font-medium text-neutral-900 dark:text-ds-text">Add a photo</span>
              <span className="text-[14px] text-ds-muted-light dark:text-ds-muted">Camera roll or uploaded file</span>
            </div>
          ) : (
            <img src={imageDataUrl} alt="" className="mx-auto block max-h-[46vh] w-full object-contain" />
          )}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(ev) => onPick(ev.target.files?.item(0) ?? null)}
          />
        </label>
      </Card>

      {!imageDataUrl ? (
        <p className="mb-8 text-center text-[14px] text-ds-muted-light dark:text-ds-muted">
          Tap the box above — on phones you can snap a pic or browse your gallery.
        </p>
      ) : (
        <>
          <div className="mb-6 flex gap-3">
            <Button type="button" variant="ghost" className="flex-1" onClick={() => setImageDataUrl(null)}>
              Retake / pick another
            </Button>
          </div>

          <label className="mb-2 block text-[13px] font-medium uppercase tracking-wide text-ds-muted-light dark:text-ds-muted">
            Your car (optional)
          </label>
          <input
            value={car}
            onChange={(e) => setCar(e.target.value)}
            placeholder="e.g. 2018 Mercedes Sprinter"
            className="mb-4 w-full rounded-lg border border-ds-border-light bg-white px-4 py-3 text-[15px] text-neutral-900 outline-none ring-ds-primary/30 focus:border-ds-primary focus:ring dark:border-ds-border dark:bg-ds-card dark:text-ds-text"
          />

          <label className="mb-2 block text-[13px] font-medium uppercase tracking-wide text-ds-muted-light dark:text-ds-muted">
            What&apos;s going on? (optional)
          </label>
          <textarea
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            rows={4}
            placeholder="Noise, leaks, dash lights…"
            className="mb-6 w-full resize-none rounded-lg border border-ds-border-light bg-white px-4 py-3 text-[15px] text-neutral-900 outline-none ring-ds-primary/30 focus:border-ds-primary focus:ring dark:border-ds-border dark:bg-ds-card dark:text-ds-text"
          />
        </>
      )}

      {errMsg ? (
        <Card className="mb-6 border-red-900/35 bg-red-500/10 text-[14px] text-red-950 dark:bg-red-500/15 dark:text-red-200">
          {errMsg}
        </Card>
      ) : null}

      <button
        type="button"
        disabled={!imageDataUrl || busy}
        onClick={() => void onIdentify()}
        className={cn(
          "relative flex min-h-[52px] w-full cursor-pointer items-center justify-center rounded-xl text-[17px] font-semibold tracking-tight text-white transition-opacity disabled:opacity-35",
          "bg-gradient-to-r from-[#2563EB] via-[#3B82F6] to-[#60A5FA]",
        )}
      >
        <span className={cn("transition-opacity", busy ? "opacity-30" : "opacity-100")}>Identify</span>
        <span
          className={cn(
            "pointer-events-none absolute inset-0 animate-pulse rounded-xl bg-blue-400/22",
            busy ? "block" : "hidden",
          )}
          aria-hidden
        />
        {busy ? (
          <span className="absolute text-[15px] font-medium tracking-tight opacity-95">Analyzing…</span>
        ) : null}
      </button>
    </div>
  );
}

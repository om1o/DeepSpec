/// <reference types="node" />

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default function handler(_request: unknown, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({
    preview: process.env.VERCEL_ENV === "preview",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
}

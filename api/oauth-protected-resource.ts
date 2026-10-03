import { createOAuthMetadata } from "../chatgpt-plugin/server";

type VercelResponse = {
  setHeader: (name: string, value: string) => void;
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
};

export default function handler(_request: unknown, response: VercelResponse) {
  response.setHeader("Cache-Control", "public, max-age=300");
  try {
    response.status(200).json(createOAuthMetadata(process.env));
  } catch (error) {
    response.status(503).json({
      error: error instanceof Error ? error.message : "DeepSpec plugin metadata is not configured.",
    });
  }
}

import { createPortalResponse } from "./billing.shared";

type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.status(405).json({
      error: {
        code: "method_not_allowed",
        message: "Use POST to open DeepSpec billing.",
      },
    });
    return;
  }

  const result = await createPortalResponse(request.body, process.env);
  response.status(result.status).json(result.body);
}

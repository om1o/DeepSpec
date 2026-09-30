import { createAccountEntitlementResponse } from "./billing.shared";

type VercelRequest = {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({
      error: {
        code: "method_not_allowed",
        message: "Use GET to verify DeepSpec account access.",
      },
    });
    return;
  }

  const result = await createAccountEntitlementResponse(request.headers ?? {}, process.env);
  response.status(result.status).json(result.body);
}

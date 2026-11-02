export function buildStreamResolutionHeaders(token: string | null): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("x-turnstile-token", token);
  return headers;
}

export type StreamTurnstileFailure = "rejected" | "unavailable";

/** Recognize only the server's explicit Turnstile responses, not provider errors. */
export async function getStreamTurnstileFailure(
  response: Response
): Promise<StreamTurnstileFailure | null> {
  if (response.status !== 403 && response.status !== 503) return null;

  let message: unknown;
  try {
    message = (await response.clone().json() as { message?: unknown }).message;
  } catch {
    return null;
  }

  if (response.status === 403 && message === "Source resolution verification is required") {
    return "rejected";
  }
  if (response.status === 503 && message === "Source verification is temporarily unavailable") {
    return "unavailable";
  }
  return null;
}

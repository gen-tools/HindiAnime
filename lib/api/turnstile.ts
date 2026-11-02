export const STREAM_TURNSTILE_ACTION = "stream_resolution";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5_000;

export type TurnstileVerification =
  | { ok: true }
  | { ok: false; status: 403 | 503; reason: string };

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

/**
 * Validate one short-lived, single-use Turnstile token before source resolution.
 * The public enable flag keeps rollout disabled by default; enabled but incomplete
 * configuration fails closed.
 */
export async function verifyStreamTurnstile(
  request: Request,
  fetcher: typeof fetch = fetch
): Promise<TurnstileVerification> {
  if (process.env.NEXT_PUBLIC_TURNSTILE_ENABLED !== "true") return { ok: true };

  const secret = process.env.TURNSTILE_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const expectedHostnames = (process.env.TURNSTILE_EXPECTED_HOSTNAMES || "")
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean);
  if (!secret || !siteKey || expectedHostnames.length === 0) {
    return { ok: false, status: 503, reason: "turnstile_configuration_missing" };
  }

  const token = request.headers.get("x-turnstile-token")?.trim();
  if (!token || token.length > 2_048) {
    return { ok: false, status: 403, reason: "turnstile_token_missing_or_invalid" };
  }

  const controller = new AbortController();
  const abortFromRequest = () => controller.abort();
  if (request.signal.aborted) return { ok: false, status: 503, reason: "request_aborted" };
  request.signal.addEventListener("abort", abortFromRequest, { once: true });
  const timeout = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);

  try {
    const form = new URLSearchParams({ secret, response: token });
    const response = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, status: 503, reason: "siteverify_http_error" };

    const result = (await response.json()) as SiteverifyResponse;
    if (result.success !== true) {
      // Siteverify rejects expired and previously redeemed tokens as well.
      return { ok: false, status: 403, reason: "siteverify_rejected_token" };
    }
    if (!result.hostname || !expectedHostnames.includes(result.hostname.toLowerCase())) {
      return { ok: false, status: 403, reason: "siteverify_hostname_mismatch" };
    }
    if (result.action !== STREAM_TURNSTILE_ACTION) {
      return { ok: false, status: 403, reason: "siteverify_action_mismatch" };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 503, reason: "siteverify_unavailable" };
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortFromRequest);
  }
}

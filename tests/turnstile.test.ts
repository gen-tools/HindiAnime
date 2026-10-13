import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
// Node 24's built-in test runner loads the TypeScript helper via native type stripping.
// @ts-expect-error TypeScript's bundler resolution forbids explicit .ts import suffixes.
import { STREAM_TURNSTILE_ACTION, verifyStreamTurnstile } from "../lib/api/turnstile.ts";
// @ts-expect-error See note above: native Node type stripping loads this TS module.
import { buildStreamResolutionHeaders, getStreamTurnstileFailure } from "../lib/api/turnstile-client.ts";

const ENV_KEYS = [
  "NEXT_PUBLIC_TURNSTILE_ENABLED",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_EXPECTED_HOSTNAMES",
] as const;
const previousEnvironment = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function configureTurnstile() {
  process.env.NEXT_PUBLIC_TURNSTILE_ENABLED = "true";
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "test-site-key";
  process.env.TURNSTILE_SECRET_KEY = "test-secret-only-for-mock";
  process.env.TURNSTILE_EXPECTED_HOSTNAMES = "hindi-anime.com, localhost";
}

function siteverifyResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    success: true,
    hostname: "hindi-anime.com",
    action: STREAM_TURNSTILE_ACTION,
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previousEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("valid playback token is verified server-side with the configured hostname and action", async () => {
  configureTurnstile();
  let verificationRequest: Request | undefined;
  const request = new Request("https://hindi-anime.com/api/stream-proxy", {
    method: "POST",
    headers: { "x-turnstile-token": "one-use-token" },
  });

  const result = await verifyStreamTurnstile(request, async (input, init) => {
    verificationRequest = new Request(input, init);
    return siteverifyResponse();
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(verificationRequest?.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  const body = new URLSearchParams(await verificationRequest!.text());
  assert.equal(body.get("response"), "one-use-token");
  assert.equal(body.get("secret"), "test-secret-only-for-mock");
  assert.equal(verificationRequest?.headers.has("x-turnstile-token"), false);
});

test("direct source-resolution calls without a header token are rejected and query tokens are ignored", async () => {
  configureTurnstile();
  let siteverifyCalls = 0;
  const request = new Request("https://hindi-anime.com/api/stream-proxy?id=naruto&token=query-token", { method: "GET" });
  const result = await verifyStreamTurnstile(request, async () => {
    siteverifyCalls++;
    return siteverifyResponse();
  });

  assert.deepEqual(result, { ok: false, status: 403, reason: "turnstile_token_missing_or_invalid" });
  assert.equal(siteverifyCalls, 0);
});

test("invalid, expired, and reused tokens are rejected by Siteverify", async () => {
  configureTurnstile();
  for (const failure of [
    { success: false, "error-codes": ["invalid-input-response"] },
    { success: false, "error-codes": ["timeout-or-duplicate"] },
  ]) {
    const request = new Request("https://hindi-anime.com/api/stream-proxy", {
      headers: { "x-turnstile-token": "rejected-token" },
    });
    const result = await verifyStreamTurnstile(request, async () => siteverifyResponse(failure));
    assert.deepEqual(result, { ok: false, status: 403, reason: "siteverify_rejected_token" });
  }
});

test("hostname and action mismatches are rejected", async () => {
  configureTurnstile();
  for (const mismatch of [{ hostname: "attacker.example" }, { action: "login" }]) {
    const request = new Request("https://hindi-anime.com/api/stream-proxy", {
      headers: { "x-turnstile-token": "token" },
    });
    const result = await verifyStreamTurnstile(request, async () => siteverifyResponse(mismatch));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  }
});

test("Siteverify HTTP, network, and malformed-response failures fail closed", async () => {
  configureTurnstile();
  const request = () => new Request("https://hindi-anime.com/api/stream-proxy", {
    headers: { "x-turnstile-token": "token" },
  });

  assert.deepEqual(
    await verifyStreamTurnstile(request(), async () => new Response("unavailable", { status: 502 })),
    { ok: false, status: 503, reason: "siteverify_http_error" }
  );
  assert.deepEqual(
    await verifyStreamTurnstile(request(), async () => { throw new Error("mock network failure"); }),
    { ok: false, status: 503, reason: "siteverify_unavailable" }
  );
  assert.deepEqual(
    await verifyStreamTurnstile(request(), async () => new Response("not-json", { status: 200 })),
    { ok: false, status: 503, reason: "siteverify_unavailable" }
  );
});

test("enabled protection fails closed when configuration is incomplete", async () => {
  configureTurnstile();
  delete process.env.TURNSTILE_SECRET_KEY;
  const result = await verifyStreamTurnstile(new Request("https://hindi-anime.com/api/stream-proxy"));
  assert.deepEqual(result, { ok: false, status: 503, reason: "turnstile_configuration_missing" });
});

test("feature is disabled by default and enabled playback request accepts the header token", async () => {
  delete process.env.NEXT_PUBLIC_TURNSTILE_ENABLED;
  const disabled = await verifyStreamTurnstile(new Request("https://hindi-anime.com/api/stream-proxy"));
  assert.deepEqual(disabled, { ok: true });

  configureTurnstile();
  const playbackRequest = new Request("https://hindi-anime.com/api/stream-proxy", {
    method: "POST",
    headers: { "x-turnstile-token": "fresh-playback-token" },
  });
  const result = await verifyStreamTurnstile(playbackRequest, async () => siteverifyResponse());
  assert.deepEqual(result, { ok: true });
});

test("player sends a fresh token in a request header, never in the URL", () => {
  const headers = buildStreamResolutionHeaders("fresh-playback-token");
  const request = new Request("https://hindi-anime.com/api/stream-proxy", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(request.headers.get("content-type"), "application/json");
  assert.equal(request.headers.get("x-turnstile-token"), "fresh-playback-token");
  assert.equal(new URL(request.url).search, "");
  assert.equal(buildStreamResolutionHeaders(null).has("x-turnstile-token"), false);
});

test("player recognizes only explicit Turnstile API rejections for manual fresh-token retry", async () => {
  assert.equal(await getStreamTurnstileFailure(new Response(JSON.stringify({
    message: "Source resolution verification is required",
  }), { status: 403 })), "rejected");
  assert.equal(await getStreamTurnstileFailure(new Response(JSON.stringify({
    message: "Source verification is temporarily unavailable",
  }), { status: 503 })), "unavailable");

  assert.equal(await getStreamTurnstileFailure(new Response(JSON.stringify({
    message: "Provider unavailable",
  }), { status: 503 })), null);
  assert.equal(await getStreamTurnstileFailure(new Response("not json", { status: 403 })), null);
  assert.equal(await getStreamTurnstileFailure(new Response("unauthorized", { status: 401 })), null);
});

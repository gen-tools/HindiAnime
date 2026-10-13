import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const HOME_URL = "https://animesalt.cx/";
const WORKER_URL = `https://worker.test/?url=${encodeURIComponent(HOME_URL)}`;
const COOLDOWN_KEY = "animesalt-homepage:upstream-cooldown:v1";
const LAST_GOOD_KEY = "animesalt-homepage:last-good:v1";

const validHomepage = (title: string) => `<!doctype html><html><body>
  <h2 class="section-title">Most-Watched Series</h2>
  <div class="chart-item"><a href="https://animesalt.cx/series/${title.toLowerCase().replace(/\s+/g, "-")}/"><span class="chart-title">${title}</span><img src="https://images.test/series.jpg"></a></div>
  <h2 class="section-title">Most-Watched Films</h2>
  <div class="chart-item"><a href="https://animesalt.cx/movies/featured-film/"><span class="chart-title">Featured Film</span><img src="https://images.test/film.jpg"></a></div>
  <h2 class="section-title">Fresh Drops</h2>
  <article class="post"><a href="https://animesalt.cx/series/fresh-title/"><h2 class="entry-title">Fresh Title</h2><img src="https://images.test/fresh.jpg"></a></article>
</body></html>`;

async function createWorkerHarness(fetchUpstream: (url: string | Request, init: RequestInit) => Promise<Response>) {
  const workerSource = await readFile(new URL("../cloudflare-worker.js", import.meta.url), "utf8");
  const executableSource = workerSource
    .replace(/^[ \t]*import \{ WorkerEntrypoint \} from "cloudflare:workers";[ \t]*\r?\n/m,
      "class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }\n")
    .replace(/^[ \t]*export default /m, "const WorkerRouter = ")
    .replace(/^[ \t]*export class AnimeSaltHomepageCache/m, "class AnimeSaltHomepageCache") +
    "\nglobalThis.TestHomepageCache = AnimeSaltHomepageCache; globalThis.TestWorkerRouter = WorkerRouter;";

  let now = 1_800_000_000_000;
  const values = new Map<string, string>();
  const kv = {
    async get(key: string) { return values.get(key) ?? null; },
    async put(key: string, value: string) { values.set(key, value); },
    async delete(key: string) { values.delete(key); },
  };
  const context: Record<string, unknown> = {
    URL,
    Request,
    Response,
    Headers,
    AbortController,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    console: { info() {}, warn() {}, error() {} },
    fetch: fetchUpstream,
    Date: class extends Date { static now() { return now; } },
  };
  context.globalThis = context;
  vm.runInNewContext(executableSource, context, { filename: "cloudflare-worker.js" });
  const WorkerEntrypoint = context.TestHomepageCache as new (ctx: unknown, env: unknown) => { fetch(request: Request): Promise<Response> };
  const entrypoint = new WorkerEntrypoint({}, { ANIMESALT_HOMEPAGE_KV: kv });
  const router = context.TestWorkerRouter as { fetch(request: Request, env: unknown, ctx?: unknown): Promise<Response> };
  return {
    entrypoint,
    router,
    values,
    advance(ms: number) { now += ms; },
    request() { return new Request(WORKER_URL, { headers: { Origin: "https://hindi-anime.com" } }); },
    generalRequest(target: string) {
      return new Request(`https://worker.test/?url=${encodeURIComponent(target)}`, {
        headers: { Origin: "https://hindi-anime.com" },
      });
    },
  };
}

test("challenge serves validated stale HTML, suppresses requests during cooldown, then recovers", async () => {
  let mode: "success" | "challenge" = "success";
  let calls = 0;
  const harness = await createWorkerHarness(async () => {
    calls += 1;
    return mode === "success"
      ? new Response(validHomepage(calls === 1 ? "Warm Title" : "Recovered Title"), { status: 200, headers: { "content-type": "text/html" } })
      : new Response("<html><title>Just a moment...</title><body>challenge</body></html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } });
  });

  const warmed = await harness.entrypoint.fetch(harness.request());
  assert.equal(warmed.status, 200);
  assert.match(await warmed.text(), /Warm Title/);
  assert.ok(harness.values.has(LAST_GOOD_KEY));

  harness.advance(5 * 60 * 1000 + 1);
  mode = "challenge";
  const challenged = await harness.entrypoint.fetch(harness.request());
  assert.equal(challenged.status, 200);
  assert.match(await challenged.text(), /Warm Title/);
  assert.ok(harness.values.has(COOLDOWN_KEY));
  assert.equal(calls, 2);

  const duringCooldown = await harness.entrypoint.fetch(harness.request());
  assert.equal(duringCooldown.status, 200);
  assert.match(await duringCooldown.text(), /Warm Title/);
  assert.equal(calls, 2);

  harness.advance(5 * 60 * 1000 + 1);
  mode = "success";
  const recovered = await harness.entrypoint.fetch(harness.request());
  assert.equal(recovered.status, 200);
  assert.match(await recovered.text(), /Recovered Title/);
  assert.equal(harness.values.has(COOLDOWN_KEY), false);
  assert.equal(calls, 3);
});

test("cold challenge returns safe failure and probe lease suppresses immediate retry", async () => {
  let calls = 0;
  const harness = await createWorkerHarness(async () => {
    calls += 1;
    return new Response("<html><title>Just a moment...</title></html>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } });
  });

  const first = await harness.entrypoint.fetch(harness.request());
  assert.equal(first.status, 503);
  assert.equal(harness.values.has(LAST_GOOD_KEY), false);
  const second = await harness.entrypoint.fetch(harness.request());
  assert.equal(second.status, 503);
  assert.equal(calls, 1);
});

test("transient fetch failure serves stale data and allows one recovery probe after its lease", async () => {
  let mode: "success" | "failure" = "success";
  let calls = 0;
  const harness = await createWorkerHarness(async () => {
    calls += 1;
    if (mode === "failure") throw new Error("upstream unavailable");
    return new Response(validHomepage(calls === 1 ? "Cached Title" : "Recovered Title"), {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  });

  const warm = await harness.entrypoint.fetch(harness.request());
  assert.equal(warm.status, 200);
  harness.advance(5 * 60 * 1000 + 1);
  mode = "failure";

  const failedProbe = await harness.entrypoint.fetch(harness.request());
  assert.equal(failedProbe.status, 200);
  assert.match(await failedProbe.text(), /Cached Title/);
  const suppressedRetry = await harness.entrypoint.fetch(harness.request());
  assert.equal(suppressedRetry.status, 200);
  assert.equal(calls, 2);

  harness.advance(30 * 1000 + 1);
  mode = "success";
  const recovered = await harness.entrypoint.fetch(harness.request());
  assert.equal(recovered.status, 200);
  assert.match(await recovered.text(), /Recovered Title/);
  assert.equal(calls, 3);
});

test("a challenge cooldown suppresses repeated requests but permits one recovery fetch after expiry", async () => {
  let blocked = false;
  let calls = 0;
  const harness = await createWorkerHarness(async () => {
    calls += 1;
    return blocked
      ? new Response("<html><title>Just a moment...</title></html>", {
          status: 403,
          headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
        })
      : new Response(validHomepage("Fresh Title"), {
          status: 200,
          headers: { "content-type": "text/html" },
        });
  });

  await harness.entrypoint.fetch(harness.request());
  harness.advance(5 * 60 * 1000 + 1);
  blocked = true;
  await harness.entrypoint.fetch(harness.request());
  assert.equal(calls, 2);
  await harness.entrypoint.fetch(harness.request());
  await harness.entrypoint.fetch(harness.request());
  assert.equal(calls, 2);

  harness.advance(5 * 60 * 1000 + 1);
  blocked = false;
  const recovered = await harness.entrypoint.fetch(harness.request());
  assert.equal(recovered.status, 200);
  assert.equal(calls, 3);
});

test("general proxy cools down only a challenged AnimeSalt URL and retries after expiry", async () => {
  let mode: "challenge" | "success" = "challenge";
  const calls: string[] = [];
  const harness = await createWorkerHarness(async (request) => {
    const requested = request instanceof Request ? request.url : String(request);
    calls.push(requested);
    return mode === "challenge"
      ? new Response("<html><title>Just a moment...</title><div id=\"challenge-form\"></div></html>", {
          status: 403,
          headers: { "content-type": "text/html", server: "cloudflare" },
        })
      : new Response("<html><body>Recovered detail</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
  });
  const target = "https://animesalt.cx/series/one-piece/";

  const challenged = await harness.router.fetch(harness.generalRequest(target), { ANIMESALT_HOMEPAGE_KV: { ...harness.values,
    async get(key: string) { return harness.values.get(key) ?? null; },
    async put(key: string, value: string) { harness.values.set(key, value); },
  } });
  assert.equal(challenged.status, 403);
  assert.equal(challenged.headers.get("x-animesalt-challenge-cooldown"), "1");
  assert.equal(calls.length, 1);

  const suppressed = await harness.router.fetch(harness.generalRequest(target), {
    ANIMESALT_HOMEPAGE_KV: {
      async get(key: string) { return harness.values.get(key) ?? null; },
      async put(key: string, value: string) { harness.values.set(key, value); },
      async delete(key: string) { harness.values.delete(key); },
    },
  });
  assert.equal(suppressed.status, 503);
  assert.equal(suppressed.headers.get("x-animesalt-challenge-cooldown"), "1");
  assert.equal(calls.length, 1, "same challenged URL must not reach AnimeSalt again during cooldown");

  // Cooldowns are exact-target keyed; a different page gets its own attempt.
  const otherTarget = await harness.router.fetch(harness.generalRequest("https://animesalt.cx/movies/one-piece/"), {
    ANIMESALT_HOMEPAGE_KV: {
      async get(key: string) { return harness.values.get(key) ?? null; },
      async put(key: string, value: string) { harness.values.set(key, value); },
      async delete(key: string) { harness.values.delete(key); },
    },
  });
  assert.equal(otherTarget.status, 403);
  assert.equal(calls.length, 2);

  harness.advance(5 * 60 * 1000 + 1);
  mode = "success";
  const recovered = await harness.router.fetch(harness.generalRequest(target), {
    ANIMESALT_HOMEPAGE_KV: {
      async get(key: string) { return harness.values.get(key) ?? null; },
      async put(key: string, value: string) { harness.values.set(key, value); },
      async delete(key: string) { harness.values.delete(key); },
    },
  });
  assert.equal(recovered.status, 200);
  assert.match(await recovered.text(), /Recovered detail/);
  assert.equal(calls.length, 3);
});

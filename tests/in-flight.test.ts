import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error Node's built-in test runner loads this TS helper via native type stripping.
import { shareInFlightRequest } from "../lib/api/in-flight.ts";

test("identical concurrent requests share one promise and failures can be retried", async () => {
  const pending = new Map<string, Promise<string>>();
  let calls = 0;
  let release!: (value: string) => void;
  const work = () => {
    calls += 1;
    return new Promise<string>((resolve) => { release = resolve; });
  };

  const first = shareInFlightRequest(pending, "homepage", work);
  const second = shareInFlightRequest(pending, "homepage", work);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  release("feed");
  assert.equal(await first, "feed");
  await Promise.resolve();
  assert.equal(pending.size, 0);

  await assert.rejects(shareInFlightRequest(pending, "failed", async () => {
    throw new Error("temporary failure");
  }));
  await Promise.resolve();
  assert.equal(pending.size, 0);
  assert.equal(await shareInFlightRequest(pending, "failed", async () => "recovered"), "recovered");
});

test("different request keys do not share work", async () => {
  const pending = new Map<string, Promise<string>>();
  let calls = 0;
  const create = async () => `result-${++calls}`;

  const first = shareInFlightRequest(pending, "anime-a", create);
  const second = shareInFlightRequest(pending, "anime-b", create);
  assert.notEqual(first, second);
  assert.deepEqual(await Promise.all([first, second]), ["result-1", "result-2"]);
});

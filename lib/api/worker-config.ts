export const WORKER_HOST = "wispy-cherry-6934.sheztech.workers.dev";
export const DEFAULT_WORKER_BASE_URL = `https://${WORKER_HOST}`;

/** Public browser-facing Worker base; never contains the server shared secret. */
export function getPublicWorkerBaseUrl(): string {
  const rawUrl = process.env.NEXT_PUBLIC_CF_PROXY_URL?.trim();
  if (!rawUrl) return DEFAULT_WORKER_BASE_URL;

  try {
    const url = new URL(rawUrl);
    const validQuery = url.search === "" ||
      (url.searchParams.size === 1 && url.searchParams.has("url") && url.searchParams.get("url") === "");
    if (url.protocol !== "https:" || url.hostname !== WORKER_HOST || url.username || url.password ||
      url.pathname !== "/" || !validQuery || url.hash) return DEFAULT_WORKER_BASE_URL;
    return url.origin;
  } catch {
    return DEFAULT_WORKER_BASE_URL;
  }
}

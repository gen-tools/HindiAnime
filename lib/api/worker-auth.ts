import "server-only";

const WORKER_HOST = "proxy.hindi-anime.com";
const SECRET_HEADER = "x-hindianime-proxy-secret";

function getServerWorkerBaseUrl(): string {
  if (typeof window !== "undefined") {
    throw new Error("Authenticated Cloudflare Worker requests are server-only.");
  }

  const rawUrl = process.env.CF_PROXY_URL?.trim();
  if (!rawUrl) {
    console.error("[worker-auth] CF_PROXY_URL is missing; protected Worker request was not sent.");
    throw new Error("CF_PROXY_URL is required for authenticated Worker requests.");
  }

  try {
    const url = new URL(rawUrl);
    const validQuery =
      url.search === "" ||
      (url.searchParams.size === 1 && url.searchParams.has("url") && url.searchParams.get("url") === "");
    if (
      url.protocol !== "https:" ||
      url.hostname !== WORKER_HOST ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      !validQuery ||
      url.hash
    ) {
      throw new Error("invalid Worker URL configuration");
    }
    return url.origin;
  } catch {
    console.error("[worker-auth] CF_PROXY_URL must target the configured HTTPS Worker; protected Worker request was not sent.");
    throw new Error("CF_PROXY_URL is not configured for the authenticated Worker.");
  }
}

export function buildServerWorkerProxyUrl(targetUrl: string): string {
  return `${getServerWorkerBaseUrl()}/?url=${encodeURIComponent(targetUrl)}`;
}

export function buildServerWorkerCatalogUrl(kind: "series" | "movies", page: number): string {
  const url = new URL(`${getServerWorkerBaseUrl()}/catalog`);
  url.searchParams.set("kind", kind);
  url.searchParams.set("page", String(page));
  return url.toString();
}

export function getServerWorkerHeaders(headers?: HeadersInit): Headers {
  if (typeof window !== "undefined") {
    throw new Error("Authenticated Cloudflare Worker requests are server-only.");
  }

  const secret = process.env.CF_PROXY_SHARED_SECRET;
  if (!secret) {
    console.error("[worker-auth] CF_PROXY_SHARED_SECRET is missing; protected Worker request was not sent.");
    throw new Error("CF_PROXY_SHARED_SECRET is required for authenticated Worker requests.");
  }

  const result = new Headers(headers);
  result.set(SECRET_HEADER, secret);
  return result;
}

import "server-only";

function getKoyebBaseUrl(): string {
  const url = (process.env.KOYEB_BACKEND_URL || process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "").trim().replace(/\/+$/, "");
  if (!url) {
    throw new Error(
      "[koyeb-client] KOYEB_BACKEND_URL is not set. Add it to Vercel environment variables."
    );
  }
  return url;
}

function getKoyebAuthToken(): string {
  return (process.env.KOYEB_AUTH_TOKEN || process.env.AUTH_TOKEN || "").trim();
}

function buildHeaders(extra?: Record<string, string>): Headers {
  const token = getKoyebAuthToken();
  const h = new Headers(extra);
  if (token) h.set("Authorization", `Bearer ${token}`);
  h.set("Accept", "application/json");
  return h;
}

interface KoyebFetchOptions {
  timeoutSeconds?: number;
  next?: { revalidate?: number; tags?: string[] };
  headers?: Record<string, string>;
}

export async function koyebFetch<T = unknown>(
  path: string,
  opts: KoyebFetchOptions = {}
): Promise<T> {
  const baseUrl = getKoyebBaseUrl();
  const url = `${baseUrl}${path}`;
  const { timeoutSeconds = 20, next, headers: extraHeaders } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const fetchOpts: RequestInit & { next?: { revalidate?: number; tags?: string[] } } = {
      headers: buildHeaders(extraHeaders),
      signal: controller.signal,
    };
    if (next) {
      fetchOpts.next = next;
    } else {
      fetchOpts.cache = "no-store";
    }

    const res = await fetch(url, fetchOpts);
    if (!res.ok) throw new Error(`Koyeb backend returned HTTP ${res.status} for ${path}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

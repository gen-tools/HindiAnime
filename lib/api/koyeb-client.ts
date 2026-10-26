import "server-only";

const BACKEND_BASE_URL = "https://api.hindi-anime.com";

function getKoyebAuthToken(): string {
  const token = (process.env.KOYEB_AUTH_TOKEN || process.env.AUTH_TOKEN || "").trim();
  if (!token) {
    throw new Error(
      "[koyeb-client] KOYEB_AUTH_TOKEN is required. Set it as a server-only Vercel environment variable."
    );
  }
  return token;
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
  headers?: Record<string, string>;
}

export async function koyebFetch<T = unknown>(
  path: string,
  opts: KoyebFetchOptions = {}
): Promise<T> {
  if (!path.startsWith("/api/")) {
    throw new Error("[koyeb-client] Only /api/* backend paths are allowed.");
  }
  const url = `${BACKEND_BASE_URL}${path}`;
  const { timeoutSeconds = 20, headers: extraHeaders } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const fetchOpts: RequestInit = {
      headers: buildHeaders(extraHeaders),
      signal: controller.signal,
      cache: "no-store",
    };

    const res = await fetch(url, fetchOpts);
    if (!res.ok) throw new Error(`Koyeb backend returned HTTP ${res.status} for ${path}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

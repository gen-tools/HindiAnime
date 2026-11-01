import { DEFAULT_WORKER_BASE_URL } from "@/lib/api/worker-config";

function trimBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed || null;
}

/** Public JSON snapshot endpoints do not use or expose the Worker shared secret. */
export function getPublicSnapshotUrl(path: string): string {
  const baseUrl = trimBaseUrl(process.env.NEXT_PUBLIC_CF_DATA_API_URL)
    || trimBaseUrl(process.env.NEXT_PUBLIC_CF_PROXY_URL)
    || DEFAULT_WORKER_BASE_URL;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export function isPublicSnapshotApiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CF_SNAPSHOT_API_ENABLED === "true";
}

export function isServerSnapshotApiEnabled(): boolean {
  return typeof window === "undefined" && process.env.CF_SNAPSHOT_API_ENABLED === "true";
}

export function getServerSnapshotUrl(path: string): string {
  const baseUrl = trimBaseUrl(process.env.CF_DATA_API_URL)
    || trimBaseUrl(process.env.CF_PROXY_URL)
    || DEFAULT_WORKER_BASE_URL;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

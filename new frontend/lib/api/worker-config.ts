/**
 * Legacy workers.dev hostname (kept until cloud.hindi-anime.com is confirmed live).
 * New primary custom domain: cloud.hindi-anime.com
 */
export const WORKER_LEGACY_HOST = "wispy-cherry-6934.sheztech.workers.dev";
export const WORKER_CUSTOM_HOST = "cloud.hindi-anime.com";

/** Both hostnames are accepted — remove legacy once the new domain is confirmed. */
export const ALLOWED_WORKER_HOSTS: ReadonlySet<string> = new Set([
  WORKER_LEGACY_HOST,
  WORKER_CUSTOM_HOST,
]);

/** The preferred default for new server-side requests. */
export const DEFAULT_WORKER_BASE_URL = `https://${WORKER_CUSTOM_HOST}`;

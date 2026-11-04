import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Staging intentionally has no persistent ISR backend configured. The current
// pages can build and be previewed without provisioning R2 or Durable Objects.
// Choose an incremental cache and revalidation queue only after resource review.
export default defineCloudflareConfig();

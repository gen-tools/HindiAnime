import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// This deployment uses runtime rendering plus Cloudflare's HTTP response
// cache. Do not configure persistent Next.js ISR storage or a revalidation queue.
export default defineCloudflareConfig();

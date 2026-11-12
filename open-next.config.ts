import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";
import type {
  CacheEntryType,
  CacheValue,
  IncrementalCache,
  WithLastModified,
} from "@opennextjs/aws/types/overrides.js";

// The generated homepage is immutable and can be read from Workers Static
// Assets. Keep every runtime/ISR/fetch cache key on the existing no-persistence
// behavior; the read-only adapter must not be used for dynamic route entries.
const homepageOnlyIncrementalCache: IncrementalCache = {
  name: staticAssetsIncrementalCache.name,
  async get<CacheType extends CacheEntryType = "cache">(
    key: string,
    cacheType?: CacheType,
  ): Promise<WithLastModified<CacheValue<CacheType>> | null> {
    if (
      !["", "/", "index", "/index"].includes(key) ||
      cacheType === "fetch" ||
      cacheType === "composable"
    ) {
      return null;
    }

    return staticAssetsIncrementalCache.get("/index", "cache") as Promise<
      WithLastModified<CacheValue<CacheType>> | null
    >;
  },
  async set() {},
  async delete() {},
};

export default defineCloudflareConfig({
  incrementalCache: homepageOnlyIncrementalCache,
});

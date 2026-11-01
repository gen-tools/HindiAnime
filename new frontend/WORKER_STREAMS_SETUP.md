# Cloudflare Worker stream sources

This frontend resolves sources directly in the Cloudflare Worker. It does not
call the local Node/Express project. When available, the player lists:

1. Hindi Anime HLS, using the copied HindiAnime player UI.
2. MyStream embed.
3. Google Drive preview embed.
4. PlayZen embed.

The Worker keeps the original HLS manifest URL in `directHlsUrl`. It uses a
signed `/hls-proxy` URL for playback when the Worker secret is configured. The
Google Drive source uses Google's preview player, so no Node `/gdrive-stream`
endpoint is needed.

## Worker settings

On the Worker serving the new frontend, add this plain-text variable:

- `PUBLIC_SOURCE_RESOLVER_ENABLED` = `true`

Add this as a Cloudflare Worker **Secret** so the Worker can sign its own HLS
proxy links:

- `HINDIANIME_PROXY_SECRET`

That secret is used only by the Worker and must not be placed in Vercel or
browser-visible frontend variables. If it is missing, the resolver can still
return the original HLS URL, but playback may fail if the upstream blocks direct
browser requests.

The new `/sources` endpoint fetches AnimeSalt, AnimaHD, and AnimeFlash/PlayZen
directly. `/stream` remains as the existing legacy route for the old frontend;
the new frontend does not call it.

## Frontend settings

Set these in the new frontend's Vercel project, then redeploy that frontend:

```env
NEXT_PUBLIC_CF_PROXY_URL=https://YOUR-WORKER.workers.dev
NEXT_PUBLIC_SOURCE_WORKER_ENABLED=true
```

Do not include `/?url=` in `NEXT_PUBLIC_CF_PROXY_URL`, and do not add any
secret/token to the frontend environment.

## Check the resolver

Open this in a browser, replacing the Worker host and title as needed:

```text
https://YOUR-WORKER.workers.dev/sources?id=solo-leveling&season=1&ep=1
```

The JSON should contain up to four results in the order above. Sources are
provider-dependent, so a result can be absent for a specific title or episode.
For HLS, `directHlsUrl` should contain the original manifest URL and `url`
should contain the Worker proxy URL when the HLS secret is set.

The Worker asset is local to this copied frontend. Deploying it to the same
Worker hostname that the old frontend uses will publish a new Worker version
for that shared hostname; keep the old and new Worker names separate if the old
frontend must remain isolated.

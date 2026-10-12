import { buildServerWorkerCatalogUrl, getServerWorkerHeaders } from "@/lib/api/worker-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;

function errorResponse(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Same-origin browser entry point for the restricted Worker catalog endpoint.
 * The shared secret is added server-side and is never exposed to client code.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const kinds = url.searchParams.getAll("kind");
  const pages = url.searchParams.getAll("page");
  const kind = kinds.length === 1 ? kinds[0] : "";
  const pageText = pages.length === 1 ? pages[0] : "";
  const page = Number(pageText);
  const hasUnexpectedParameter = Array.from(url.searchParams.keys()).some(
    (key) => key !== "kind" && key !== "page"
  );

  if (
    hasUnexpectedParameter ||
    (kind !== "series" && kind !== "movies") ||
    !/^[1-9]\d{0,3}$/.test(pageText) ||
    !Number.isSafeInteger(page) ||
    page > 1000
  ) {
    return errorResponse("Invalid catalog request", 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildServerWorkerCatalogUrl(kind, page), {
      method: "GET",
      headers: getServerWorkerHeaders({
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9",
      }),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      return errorResponse("Catalog temporarily unavailable", response.status);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (!/(?:rss\+xml|application\/xml|text\/xml)/.test(contentType)) {
      return errorResponse("Catalog source returned an unexpected response", 502);
    }

    const feed = await response.text();
    if (
      feed.length === 0 ||
      new TextEncoder().encode(feed).byteLength > MAX_FEED_BYTES ||
      !/<rss\b/i.test(feed) ||
      !/<item(?:\s|>)/i.test(feed)
    ) {
      return errorResponse("Catalog source returned an invalid feed", 502);
    }

    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    for (const name of [
      "x-catalog-total-pages",
      "x-catalog-page-size",
      "x-catalog-cache",
    ]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }

    return new Response(feed, { status: 200, headers });
  } catch {
    return errorResponse(
      controller.signal.aborted
        ? "Catalog request timed out"
        : "Catalog temporarily unavailable",
      controller.signal.aborted ? 504 : 502
    );
  } finally {
    clearTimeout(timeout);
  }
}

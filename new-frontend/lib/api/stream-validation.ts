/**
 * Domains that are known to be link shorteners, ad-walls, or unusable stream hosts.
 * Keep this list in a small shared module so client playback does not import the
 * server-side API/scraper client just to validate a URL.
 */
export const BLOCKED_STREAM_DOMAINS = [
  // Link shorteners / ad-walls
  "mvlink",
  "linkskit",
  "linkvertise",
  "hindmovie",
  "hshare",
  "shortx",
  "ouo.io",
  "ouo.press",
  "shareus",
  "gofile",
  "dropgalaxy",
  "katfile",
  "turbobit",
  "rapidgator",
  "1fichier",
  "mediafire",
  "mega.nz",
  "mega.co",
  "shorte.st",
  "adf.ly",
  "adfly",
  "shrinkme",
  "earn4link",
  "droplink",
  "clicksfly",
  "gplinks",
  "cuty.io",
  "exe.io",
  // Ad-wall video hosts
  "multishows",
  "streamtape",
  "doodstream",
  "dood.watch",
  "dood.la",
  "dood.pm",
  "dood.to",
  "ds2play",
  "voe.sx",
  "voe.network",
  "mixdrop",
  "sendvid",
  "uqload",
  "upstream.to",
  "evoload",
  "clipwatching",
  "waaw.tv",
  "gounlimited",
  "vudeo",
  // Broken / timeout / ASN-locked stream hosts
  "cloudy.upns.one",
  "upns.one",
  "p2pplay.pro",
  "acek-cdn",
  "dramiyos-cdn",
  "prx-am",
  "animesama",
];

export function isValidEmbedUrl(embed: string | null | undefined): boolean {
  if (!embed || typeof embed !== "string") return false;
  const trimmed = embed.trim();
  if (trimmed === "") return false;
  if (trimmed.toLowerCase() === "not found") return false;
  if (trimmed.toLowerCase() === "error loading") return false;
  if (trimmed.startsWith("data:")) return false;
  // Reject direct downloads of archive or raw container files.
  if (/\.(mkv|zip|rar|7z|tar|gz|torrent|iso)(\?|$)/i.test(trimmed)) return false;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    // Reject root homepages but allow hash-fragment embeds such as cloudy.upns.one/#id.
    const cleanPath = url.pathname.replace(/\/+$/, "");
    const hashId = url.hash.replace(/^#/, "").trim();
    if (!cleanPath && !hashId) return false;

    const host = url.hostname.toLowerCase();
    if (BLOCKED_STREAM_DOMAINS.some((domain) => host.includes(domain))) return false;

    // Reject AnimeSalt homepages and non-player paths.
    if (
      host.includes("animesalt.cx") &&
      !cleanPath.includes("/video/") &&
      !cleanPath.includes("/embed/") &&
      !cleanPath.includes("multi-lang-plyr")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export function buildAnimeSaltEpisodeCandidates(
  slug: string,
  season: string | number,
  episode: string | number
): string[] {
  const sNum = parseInt(String(season), 10) || 1;
  const epNum = parseInt(String(episode), 10) || 1;
  const baseSlug = slug
    .replace(/-season-\d+$/i, "")
    .replace(/-s\d+$/i, "")
    .replace(/-\d+(st|nd|rd|th)-season$/i, "");

  return [
    `https://animesalt.cx/episode/${baseSlug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${slug}-${sNum}x${epNum}/`,
    `https://animesalt.cx/episode/${baseSlug}-${epNum}/`,
  ];
}

export function isValidAnimeSaltHtml(html: string): boolean {
  return (
    html.length >= 1000 &&
    !html.includes("404 Not Found") &&
    !html.includes("Just a moment...") &&
    !html.includes("cf-chl-widget") &&
    !html.includes("challenge-platform") &&
    !html.includes("cf-browser-verification") &&
    !html.includes("Attention Required! | Cloudflare") &&
    !html.includes("enable-javascript") &&
    !html.includes("security check")
  );
}

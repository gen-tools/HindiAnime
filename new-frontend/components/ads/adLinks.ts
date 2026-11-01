const DIRECT_LINK_URL =
  "https://www.profitableratecpmnetwork.com/dhkh9azm?key=cf159f5cc904cdf9a3b583e2b3108cc8";

/** Open the ad in a separate tab while keeping the site in the foreground. */
export function openAdLink(): void {
  if (typeof window === "undefined") return;
  window.open(DIRECT_LINK_URL, "_blank", "noopener,noreferrer");
  window.focus();
}

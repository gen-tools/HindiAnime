import Link from "next/link";
import { Logo } from "./Logo";
import { genres } from "@/lib/mock/genres";

const platformLinks = [
  { label: "Home", href: "/" },
  { label: "Latest Episodes", href: "/latest" },
  { label: "Popular", href: "/popular" },
  { label: "Movies", href: "/movies" },
  { label: "Schedule", href: "/schedule" },
];

const legalLinks = [
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "DMCA Policy", href: "/dmca" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
];

export function Footer() {
  return (
    <footer className="border-t border-border-line bg-surface-dark">
      <div className="container-page grid grid-cols-2 gap-x-8 gap-y-10 py-14 md:grid-cols-4 lg:grid-cols-6">
        <div className="col-span-2 lg:col-span-2">
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-text-muted">
           Watch Hindi, Tamil, Telugu, English, and Japanese anime online for free on HindiAnime. Stream dubbed and subbed anime series and movies, browse by genre, and catch the latest episodes anytime.
          </p>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold text-text-primary">Platform</h3>
          <ul className="space-y-2.5">
            {platformLinks.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="focus-ring text-sm text-text-muted hover:text-green-light">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold text-text-primary">Genres</h3>
          <ul className="space-y-2.5">
            {genres.slice(0, 5).map((g) => (
              <li key={g.slug}>
                <Link
                  href={`/genre/${g.slug}`}
                  className="focus-ring text-sm text-text-muted hover:text-green-light"
                >
                  {g.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold text-text-primary">Languages</h3>
          <ul className="space-y-2.5">
            {[
              { label: "Hindi Dubbed Anime", href: "/language/hindi" },
              { label: "Tamil Dubbed Anime", href: "/language/tamil" },
              { label: "Telugu Dubbed Anime", href: "/language/telugu" },
            ].map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="focus-ring text-sm text-text-muted hover:text-green-light"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold text-text-primary">Legal</h3>
          <ul className="space-y-2.5">
            {legalLinks.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="focus-ring text-sm text-text-muted hover:text-green-light">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-4 text-sm font-semibold text-text-primary">Follow Us</h3>
          <nav aria-label="Social media" className="flex items-center gap-2.5">
            <a
              href="https://x.com/HindiAnimecom"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Hindi Anime on X (opens in a new tab)"
              title="Follow Hindi Anime on X"
              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-line text-text-muted transition-colors hover:border-green-primary/60 hover:bg-green-primary/10 hover:text-green-light"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.6 22H2.5l7.3-8.4L1.9 2h6.5l4.5 6.7L18.9 2Zm-1.1 18h1.7L7.4 3.9H5.6L17.8 20Z" />
              </svg>
            </a>
            <a
              href="https://www.instagram.com/hindi_animecom"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Hindi Anime on Instagram (opens in a new tab)"
              title="Follow Hindi Anime on Instagram"
              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-line text-text-muted transition-colors hover:border-green-primary/60 hover:bg-green-primary/10 hover:text-green-light"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="18" cy="6" r=".8" className="fill-current stroke-none" />
              </svg>
            </a>
          </nav>
        </div>
      </div>

      <div className="border-t border-border-line">
        <div className="container-page flex flex-col items-center justify-between gap-2 py-5 text-xs text-text-muted sm:flex-row">
          <p>© 2026 Hindi Anime. All rights reserved.</p>
          <p>Developed by Sheztech</p>
        </div>
      </div>
    </footer>
  );
}

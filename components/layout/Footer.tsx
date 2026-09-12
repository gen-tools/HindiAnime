import Link from "next/link";
import { Logo } from "./Logo";
import { genres } from "@/lib/mock/genres";
import { languages } from "@/lib/mock/languages";

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
            Watch Hindi dubbed anime and anime in Hindi online. Discover dubbed and subbed anime series and movies in Hindi, Tamil, Telugu, English, Japanese, Korean, Malayalam, Kannada, Bengali, and Marathi, all in one place.
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
              { label: "Bengali Dubbed Anime", href: "/language/bengali" },
              { label: "Kannada Dubbed Anime", href: "/language/kannada" },
              { label: "Malayalam Dubbed Anime", href: "/language/malayalam" },
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
      </div>

      <div className="border-t border-border-line">
        <div className="container-page flex flex-col items-center justify-between gap-2 py-5 text-xs text-text-muted sm:flex-row">
          <p>© 2026 HindiAnime. All rights reserved.</p>
          <p>Developed by Sheztech</p>
        </div>
      </div>
    </footer>
  );
}

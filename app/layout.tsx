import type { Metadata } from "next";
import { Inter, Manrope, Bebas_Neue } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://hindi-anime.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Hindi Anime | Watch Hindi Dubbed Anime Online",
    template: "%s | Hindi Anime",
  },
  description:
    "Watch Hindi dubbed anime online, plus anime in Tamil, Telugu, English and Japanese. Explore popular series, movies, latest episodes and genres on Hindi Anime.",
  openGraph: {
    title: "Hindi Anime | Watch Hindi Dubbed Anime Online",
    description:
      "Watch Hindi dubbed anime online, plus anime in Tamil, Telugu, English and Japanese. Explore popular series, movies, latest episodes and genres on Hindi Anime.",
    siteName: "Hindi Anime",
    url: SITE_URL,
    type: "website",
  },
  // Public pages are indexable by default; individual API/proxy routes set their own noindex
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

// WebSite structured data — signals preferred site name to Google
const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Hindi Anime",
  alternateName: ["HindiAnime", "Hindi Anime Online"],
  url: SITE_URL,
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${manrope.variable} ${bebas.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
      </head>
      <body
        className="flex min-h-screen flex-col font-body antialiased"
        suppressHydrationWarning
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-green-primary focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <Header />
        <main id="main-content" className="flex-1 mobile-nav-clearance">
          {children}
        </main>
        <Footer />
        <MobileBottomNav />
      </body>
    </html>
  );
}

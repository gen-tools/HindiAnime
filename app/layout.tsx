import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Manrope, Bebas_Neue } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { AdsterraPopunder } from "@/components/ads/AdsterraPopunder";
import { CANONICAL_SITE_ORIGIN, DEFAULT_OG_IMAGE, getCanonicalUrl } from "@/lib/seo";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_SITE_ORIGIN),
  alternates: { canonical: getCanonicalUrl("/") },
  title: {
    default: "Hindi Anime | Watch Hindi Dubbed Anime Online",
    template: "%s | Hindi Anime",
  },
  description:
    "Watch Hindi dubbed anime, Tamil dubbed anime, and Telugu dubbed anime online. Explore popular series, movies, latest episodes and genres on Hindi Anime.",
  keywords: [
    "Hindi Anime",
    "Watch Hindi Dubbed Anime",
    "Hindi Dubbed Anime Online",
    "Anime in Hindi",
    "Tamil Dubbed Anime",
    "Telugu Dubbed Anime",
    "Hindi Dubbed Anime Series",
    "Free Anime Streaming",
    "Watch Anime Online",
  ],
  category: "entertainment",
  openGraph: {
    title: "Hindi Anime | Watch Hindi Dubbed Anime Online",
    description:
      "Watch Hindi dubbed anime, Tamil dubbed anime, and Telugu dubbed anime online. Explore popular series, movies, latest episodes and genres on Hindi Anime.",
    siteName: "Hindi Anime",
    url: CANONICAL_SITE_ORIGIN,
    locale: "en_US",
    type: "website",
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "Hindi Anime - Watch Hindi Dubbed Anime Online",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hindi Anime | Watch Hindi Dubbed Anime Online",
    description:
      "Watch Hindi dubbed anime, Tamil dubbed anime, and Telugu dubbed anime online. Explore popular series, movies, latest episodes and genres on Hindi Anime.",
    images: [DEFAULT_OG_IMAGE],
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

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${CANONICAL_SITE_ORIGIN}/#organization`,
      name: "Hindi Anime",
      url: CANONICAL_SITE_ORIGIN,
      logo: `${CANONICAL_SITE_ORIGIN}/icon.svg`,
    },
    {
      "@type": "WebSite",
      "@id": `${CANONICAL_SITE_ORIGIN}/#website`,
      url: CANONICAL_SITE_ORIGIN,
      name: "Hindi Anime",
      alternateName: ["HindiAnime", "Hindi Anime Online"],
      publisher: {
        "@id": `${CANONICAL_SITE_ORIGIN}/#organization`,
      },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${CANONICAL_SITE_ORIGIN}/search?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${manrope.variable} ${bebas.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd).replace(/</g, "\\u003c") }} />
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
        <AdsterraPopunder />
        <main id="main-content" className="flex-1 mobile-nav-clearance">
          {children}
        </main>
        <Footer />
        <MobileBottomNav />
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-TJRESED02F"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){window.dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-TJRESED02F');
          `}
        </Script>
      </body>
    </html>
  );
}

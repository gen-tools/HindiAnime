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

export const metadata: Metadata = {
  metadataBase: new URL("https://hindianime.example.com"),
  title: {
    default: "HindiAnime — Watch Anime in Hindi, Tamil, Telugu & More",
    template: "%s | HindiAnime",
  },
  description:
    "Stream anime dubbed and subbed across ten languages. A concept anime streaming interface with a dark, cinematic, emerald-accented design.",
  openGraph: {
    title: "HindiAnime — Watch Anime in Hindi, Tamil, Telugu & More",
    description:
      "Stream anime dubbed and subbed across ten languages on HindiAnime's concept streaming interface.",
    siteName: "HindiAnime",
    type: "website",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-video-preview": -1,
      "max-image-preview": "none",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable} ${bebas.variable}`} data-scroll-behavior="smooth">
      <body className="flex min-h-screen flex-col font-body antialiased">
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

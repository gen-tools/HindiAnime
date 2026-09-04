import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the HindiAnime team.",
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}

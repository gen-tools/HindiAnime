import type { Metadata } from "next";
import { createCanonicalMetadata } from "@/lib/seo";

export const metadata: Metadata = createCanonicalMetadata("/contact", {
  title: "Contact",
  description: "Get in touch with the Hindi Anime team.",
});

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}

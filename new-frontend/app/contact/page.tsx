import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Mail, MessageSquareText } from "lucide-react";
import { createCanonicalMetadata } from "@/lib/seo";

const CONTACT_EMAIL = "contact@hindi-anime.com";

export const metadata: Metadata = createCanonicalMetadata("/contact", {
  title: "Contact Us",
  description: "Contact the Hindi Anime team with questions, feedback, or partnership inquiries.",
});

export default function ContactPage() {
  return (
    <main className="container-page py-12 md:py-20">
      <section className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-border-line bg-surface shadow-2xl shadow-black/20 md:grid-cols-[0.9fr_1.1fr]">
        <div className="relative overflow-hidden bg-gradient-to-br from-green-primary/20 via-surface to-surface-dark p-7 md:p-10">
          <div className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-green-bright/10 blur-3xl" />
          <div className="relative">
            <span className="eyebrow text-sm text-green-light">GET IN TOUCH</span>
            <h1 className="font-display mt-3 text-3xl font-extrabold tracking-tight text-text-primary md:text-4xl">
              We&apos;re here to help.
            </h1>
            <p className="mt-4 max-w-md leading-7 text-text-secondary">
              Have a question, found an issue, or want to share feedback? Send our team an email
              and include the anime title or page link if it helps explain your message.
            </p>
            <div className="mt-8 flex items-start gap-3 rounded-2xl border border-border-line bg-black/20 p-4">
              <MessageSquareText className="mt-0.5 h-5 w-5 shrink-0 text-green-bright" aria-hidden="true" />
              <p className="text-sm leading-6 text-text-muted">
                For playback problems, please mention the title, episode, and server you tried.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-center p-7 md:p-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-green-bright/20 bg-green-primary/10">
            <Mail className="h-5 w-5 text-green-bright" aria-hidden="true" />
          </div>
          <h2 className="font-display mt-5 text-xl font-bold text-text-primary">Email us</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            The quickest way to reach us is by email. Your email app will open with a new message.
          </p>
          <Link
            href={`mailto:${CONTACT_EMAIL}`}
            className="focus-ring mt-6 inline-flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-green-bright/30 bg-green-primary/10 px-4 py-3 text-sm font-semibold text-green-light transition-colors hover:border-green-bright/60 hover:bg-green-primary/15 sm:w-fit sm:min-w-72"
          >
            <span className="break-all">{CONTACT_EMAIL}</span>
            <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Link>
          <p className="mt-6 text-xs leading-5 text-text-muted">
            By contacting us, please avoid including passwords or other sensitive account details.
          </p>
        </div>
      </section>
    </main>
  );
}

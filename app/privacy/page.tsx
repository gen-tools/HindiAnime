import type { Metadata } from "next";
import { ShieldCheck, Lock, Eye, FileText } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy | HINDIANIME",
  description: "Privacy Policy and data protection guidelines for HindiAnime.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="container-page max-w-4xl py-12 md:py-16">
      <div className="inline-flex items-center gap-2 rounded-full border border-green-primary/30 bg-green-primary/10 px-3 py-1 text-xs font-semibold text-green-light">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>Legal &amp; Privacy</span>
      </div>

      <h1 className="font-display mt-3 text-3xl font-extrabold text-text-primary md:text-5xl">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-text-muted">Last updated: August 2026</p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-text-secondary">
        <section className="rounded-xl border border-border-line bg-surface p-6">
          <h2 className="font-display text-lg font-bold text-text-primary mb-2 flex items-center gap-2">
            <Eye className="h-4 w-4 text-green-light" />
            1. Overview &amp; Information We Collect
          </h2>
          <p>
            HindiAnime is committed to protecting your privacy. We do not require account creation
            or personal identifiers to browse or stream concept content. We may collect non-personal
            diagnostic and preference data (such as chosen audio language, volume, or playback position)
            stored locally on your device via browser localStorage.
          </p>
        </section>

        <section className="rounded-xl border border-border-line bg-surface p-6">
          <h2 className="font-display text-lg font-bold text-text-primary mb-2 flex items-center gap-2">
            <Lock className="h-4 w-4 text-green-light" />
            2. Cookies and Local Storage
          </h2>
          <p>
            We use essential local storage to remember your preferred player settings and subtitle
            configurations. We do not use intrusive third-party cross-site tracking cookies.
          </p>
        </section>

        <section className="rounded-xl border border-border-line bg-surface p-6">
          <h2 className="font-display text-lg font-bold text-text-primary mb-2 flex items-center gap-2">
            <FileText className="h-4 w-4 text-green-light" />
            3. Third-Party Media Providers
          </h2>
          <p>
            Stream embeds and artwork are delivered through external media endpoints and TMDB. When you
            interact with an embedded player, the respective provider may process your IP address in accordance
            with their standard streaming protocols.
          </p>
        </section>
      </div>
    </div>
  );
}

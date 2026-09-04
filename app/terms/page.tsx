import type { Metadata } from "next";
import { FileText, CheckCircle2, AlertTriangle, Shield } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Service | HINDIANIME",
  description: "Terms of Service and platform usage terms for HindiAnime.",
};

export default function TermsOfServicePage() {
  return (
    <div className="container-page max-w-4xl py-12 md:py-16">
      <div className="inline-flex items-center gap-2 rounded-full border border-green-primary/30 bg-green-primary/10 px-3 py-1 text-xs font-semibold text-green-light">
        <FileText className="h-3.5 w-3.5" />
        <span>Terms &amp; Conditions</span>
      </div>

      <h1 className="font-display mt-3 text-3xl font-extrabold text-text-primary md:text-5xl">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-text-muted">Last updated: August 2026</p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-text-secondary">
        <section className="rounded-xl border border-border-line bg-surface p-6">
          <h2 className="font-display text-lg font-bold text-text-primary mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-light" />
            1. Acceptance of Terms
          </h2>
          <p>
            By accessing or using HindiAnime, you agree to comply with and be bound by these Terms of Service.
            If you do not agree to these terms, please do not use the platform.
          </p>
        </section>

        <section className="rounded-xl border border-border-line bg-surface p-6">
          <h2 className="font-display text-lg font-bold text-text-primary mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-green-light" />
            2. Intellectual Property &amp; Content Disclaimer
          </h2>
          <p>
            HindiAnime does not host, upload, or store copyright-protected media files directly on its
            servers. All video content is indexed or embedded from third-party media hosts. All trademarks,
            logos, and anime copyrights belong to their respective creators and production committees.
          </p>
        </section>

        <section className="rounded-xl border border-border-line bg-surface p-6">
          <h2 className="font-display text-lg font-bold text-text-primary mb-2 flex items-center gap-2">
            <Shield className="h-4 w-4 text-green-light" />
            3. Permitted Personal Use
          </h2>
          <p>
            The platform is provided solely for personal, non-commercial entertainment and testing purposes.
            Users agree not to scrape, redistribute, or disrupt platform infrastructure.
          </p>
        </section>
      </div>
    </div>
  );
}

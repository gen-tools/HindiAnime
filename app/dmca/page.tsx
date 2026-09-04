import type { Metadata } from "next";
import { ShieldAlert, FileText, CheckCircle2, AlertTriangle, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "DMCA Policy | HINDIANIME",
  description: "DMCA copyright policy and takedown request guidelines for HindiAnime.",
};

export default function DmcaPolicyPage() {
  return (
    <div className="container-page max-w-4xl py-12 md:py-16">
      <div className="inline-flex items-center gap-2 rounded-full border border-green-primary/30 bg-green-primary/10 px-3 py-1 text-xs font-semibold text-green-light">
        <ShieldAlert className="h-3.5 w-3.5" />
        <span>Copyright &amp; Compliance</span>
      </div>

      <h1 className="font-display mt-3 text-3xl font-extrabold text-text-primary md:text-5xl">
        DMCA Policy
      </h1>
      <p className="mt-2 text-sm text-text-muted">Last updated: September 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-text-secondary">
        {/* Intro */}
        <section className="rounded-xl border border-border-line bg-surface p-6 sm:p-8">
          <p className="text-base font-medium text-text-primary">
            HINDIANIME respects the rights of copyright owners.
          </p>
          <p className="mt-3">
            HINDIANIME does not intentionally host or store copyrighted video files on its own servers. Our website may provide links or embeds to content hosted by third-party services.
          </p>
          <p className="mt-3">
            If you are the copyright owner or an authorized representative and believe that content linked or displayed on HINDIANIME violates your copyright, you can contact us with a DMCA takedown request.
          </p>
        </section>

        {/* How to Send a DMCA Request */}
        <section className="rounded-xl border border-border-line bg-surface p-6 sm:p-8">
          <h2 className="font-display text-xl font-bold text-text-primary mb-3 flex items-center gap-2">
            <FileText className="h-5 w-5 text-green-light shrink-0" />
            How to Send a DMCA Request
          </h2>
          <p className="mb-4 text-text-muted">Please include the following details in your notice:</p>
          <ul className="space-y-2.5">
            {[
              "Your full name",
              "Your email address",
              "The name of the copyrighted work",
              "The exact URL of the content on HINDIANIME",
              "A direct URL to the copyrighted work, if available",
              "A statement explaining that you are the copyright owner or authorized to act for the owner",
              "A statement confirming that the information in your request is accurate",
            ].map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-green-primary mt-0.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 rounded-lg border border-border-line bg-surface-dark p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs text-text-muted uppercase tracking-wider font-semibold">Send your request to</p>
              <a
                href="mailto:sa0663787@gmail.com"
                className="text-base font-bold text-green-light hover:underline"
              >
                sa0663787@gmail.com
              </a>
            </div>
            <a
              href="mailto:sa0663787@gmail.com?subject=DMCA%20Takedown%20Request"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-primary px-4 py-2 text-sm font-semibold text-white hover:bg-green-primary/90 transition-colors"
            >
              <Mail className="h-4 w-4" />
              <span>Email DMCA Notice</span>
            </a>
          </div>
        </section>

        {/* What We Will Do */}
        <section className="rounded-xl border border-border-line bg-surface p-6 sm:p-8">
          <h2 className="font-display text-xl font-bold text-text-primary mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-light shrink-0" />
            What We Will Do
          </h2>
          <p>
            After receiving a valid copyright complaint, we will review the reported content and take appropriate action, which may include removing or disabling the related link or page.
          </p>
          <p className="mt-3">
            We may contact you if more information is required.
          </p>
        </section>

        {/* Important */}
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 sm:p-8">
          <h2 className="font-display text-xl font-bold text-amber-400 mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
            Important
          </h2>
          <p className="text-text-secondary">
            HINDIANIME does not claim ownership of third-party content.
          </p>
          <p className="mt-3 text-text-secondary">
            The availability of a link or embedded content on HINDIANIME does not mean that HINDIANIME owns or licenses that content.
          </p>
          <p className="mt-3 text-text-secondary">
            We encourage users to support anime creators and copyright owners by using official and licensed streaming services whenever available.
          </p>
        </section>

        {/* Contact */}
        <section className="rounded-xl border border-border-line bg-surface p-6 sm:p-8">
          <h2 className="font-display text-xl font-bold text-text-primary mb-3 flex items-center gap-2">
            <Mail className="h-5 w-5 text-green-light shrink-0" />
            Contact
          </h2>
          <p className="mb-2">For copyright-related requests:</p>
          <p>
            <strong className="text-text-primary">Email:</strong>{" "}
            <a
              href="mailto:sa0663787@gmail.com"
              className="text-green-light hover:underline font-semibold"
            >
              sa0663787@gmail.com
            </a>
          </p>
          <p className="mt-4 text-xs text-text-muted">
            Last updated: September 2026
          </p>
        </section>
      </div>
    </div>
  );
}

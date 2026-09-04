import { ButtonLink } from "@/components/ui/Button";
import { Compass } from "lucide-react";

export function DiscoverySection() {
  return (
    <section className="py-14 md:py-20">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-2xl border border-border-line bg-surface px-6 py-14 text-center sm:px-10">
          <div
            className="pointer-events-none absolute left-1/2 top-0 h-64 w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-primary/20 blur-[100px]"
            aria-hidden="true"
          />
          <span className="eyebrow relative inline-block text-sm text-green-light">KEEP EXPLORING</span>
          <h2 className="font-display relative mx-auto mt-3 max-w-lg text-2xl font-extrabold text-text-primary md:text-3xl">
            Hundreds of titles across ten languages, updated every week.
          </h2>
          <p className="relative mx-auto mt-3 max-w-md text-sm text-text-secondary">
            Search by genre, language, or what&apos;s airing this week — there&apos;s always something new
            queued up.
          </p>
          <div className="relative mt-7 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/search" size="lg" icon={<Compass className="h-4 w-4" />}>
              Explore the Catalog
            </ButtonLink>
            <ButtonLink href="/schedule" variant="secondary" size="lg">
              View Schedule
            </ButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}

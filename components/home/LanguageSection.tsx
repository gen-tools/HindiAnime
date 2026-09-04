import Link from "next/link";
import { languages } from "@/lib/mock/languages";
import { cn } from "@/lib/utils";

export function LanguageSection() {
  return (
    <section className="py-8 md:py-10">
      <div className="container-page">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-text-primary md:text-2xl">
            Browse by Language
          </h2>
          <Link
            href="/language"
            className="text-xs font-semibold text-text-secondary hover:text-green-light"
          >
            All languages →
          </Link>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {languages.map((lang, i) => (
            <Link
              key={lang.code}
              href={`/language/${lang.code}`}
              className={cn(
                "focus-ring rounded-full border px-5 py-2.5 text-sm font-semibold transition-all hover:-translate-y-0.5",
                i === 0
                  ? "border-green-bright bg-green-primary/20 text-green-light shadow-[0_0_16px_-4px_rgba(34,197,94,0.5)]"
                  : "border-border-line bg-surface text-text-secondary hover:border-green-primary/60 hover:text-white"
              )}
            >
              {lang.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

import { getLanguageLabel } from "@/lib/mock/languages";
import { cn } from "@/lib/utils";
import type { LanguageCode } from "@/types/language";

export function LanguageBadges({
  languages,
  max = 4,
  className,
}: {
  languages: LanguageCode[];
  max?: number;
  className?: string;
}) {
  const visible = languages.slice(0, max);
  const remaining = languages.length - visible.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-muted", className)}>
      {visible.map((lang, i) => (
        <span key={lang} className="flex items-center gap-1.5">
          <span className="text-text-secondary">{getLanguageLabel(lang)}</span>
          {i < visible.length - 1 && <span className="text-border-line">•</span>}
        </span>
      ))}
      {remaining > 0 && <span className="text-green-light">+{remaining}</span>}
    </div>
  );
}

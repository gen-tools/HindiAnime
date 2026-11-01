"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function ReadMoreText({
  text,
  className,
  collapsedLines = 3,
}: {
  text: string;
  className?: string;
  collapsedLines?: 2 | 3 | 4;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const shouldCollapse = text.trim().length > 180;
  const clampClass = {
    2: "line-clamp-2",
    3: "line-clamp-3",
    4: "line-clamp-4",
  }[collapsedLines];

  return (
    <div>
      <p
        id={contentId}
        className={cn(
          "whitespace-pre-line",
          shouldCollapse && !expanded && clampClass,
          className
        )}
      >
        {text}
      </p>
      {shouldCollapse && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
          className="focus-ring mt-1 inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-sm font-semibold text-green-light transition-colors hover:text-green-bright"
        >
          {expanded ? "Read less" : "Read more"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

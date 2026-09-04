import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function RatingBadge({ rating, className }: { rating: number; className?: string }) {
  if (!Number.isFinite(rating) || rating <= 0) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-black/50 px-1.5 py-0.5 text-xs font-bold text-green-light backdrop-blur-sm",
        className
      )}
    >
      <Star className="h-3 w-3 fill-green-light text-green-light" />
      {rating.toFixed(1)}
    </span>
  );
}

import type { Metadata } from "next";
import { createCanonicalMetadata } from "@/lib/seo";

export const metadata: Metadata = createCanonicalMetadata("/schedule", {
  title: "Schedule",
  description: "The weekly anime release schedule on Hindi Anime, day by day.",
});

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return children;
}

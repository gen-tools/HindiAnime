import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Schedule",
  description: "The weekly anime release schedule on HindiAnime, day by day.",
};

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return children;
}

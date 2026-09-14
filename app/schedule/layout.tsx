import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Schedule",
  description: "The weekly anime release schedule on Hindi Anime, day by day.",
};

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return children;
}

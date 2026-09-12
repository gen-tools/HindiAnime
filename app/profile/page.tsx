import type { Metadata } from "next";
import { ProfileView } from "@/components/profile/ProfileView";

export const metadata: Metadata = {
  title: "Guest Profile & Library | HINDIANIME",
  description:
    "Manage your local watch progress, anime favorites list, watch history, and viewing statistics stored directly in your browser.",
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const tabParam = params.tab;

  const validTabs = ["continue", "favorites", "history", "settings"] as const;
  const initialTab = validTabs.includes(tabParam as (typeof validTabs)[number])
    ? (tabParam as (typeof validTabs)[number])
    : "continue";

  return <ProfileView initialTab={initialTab} />;
}

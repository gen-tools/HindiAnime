import type { Metadata } from "next";
import { createCanonicalMetadata } from "@/lib/seo";
import { ProfileView } from "@/components/profile/ProfileView";

export const metadata: Metadata = createCanonicalMetadata("/profile", {
  title: "Guest Profile & Library",
  description:
    "Manage your local watch progress, anime favorites list, watch history, and viewing statistics stored directly in your browser.",
  robots: { index: false, follow: false },
});

export default function ProfilePage() {
  return <ProfileView initialTab="continue" />;
}

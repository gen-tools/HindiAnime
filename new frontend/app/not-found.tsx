import Link from "next/link";
import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center gap-4 py-20 text-center">
      <span className="font-eyebrow text-7xl text-green-primary/70">404</span>
      <h1 className="font-display text-2xl font-bold text-text-primary">This page went off-air</h1>
      <p className="max-w-sm text-sm text-text-muted">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <ButtonLink href="/" icon={<Compass className="h-4 w-4" />} className="mt-2">
        Back to Home
      </ButtonLink>
      <Link href="/search" className="focus-ring text-sm text-text-secondary hover:text-green-light">
        Or search the catalog
      </Link>
    </div>
  );
}

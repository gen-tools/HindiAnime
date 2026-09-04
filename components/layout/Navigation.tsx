"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Home", href: "/" },
  { label: "Latest", href: "/latest" },
  { label: "Popular", href: "/popular" },
  { label: "Movies", href: "/movies" },
  { label: "Genres", href: "/genre" },
  { label: "Languages", href: "/language" },
  { label: "Schedule", href: "/schedule" },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
      {navItems.map((item) => {
        const isActive =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href.split("/").slice(0, 2).join("/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "focus-ring relative px-3.5 py-2 text-sm font-medium transition-colors",
              isActive ? "text-white" : "text-text-secondary hover:text-white"
            )}
          >
            {item.label}
            {isActive && (
              <span className="absolute inset-x-3 -bottom-[1px] h-[2px] rounded-full bg-green-bright shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export { navItems };

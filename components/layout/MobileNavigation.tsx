"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { navItems } from "./Navigation";
import { Logo } from "./Logo";

export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="focus-ring rounded-lg p-2 text-text-primary hover:bg-white/5"
      >
        <Menu className="h-5 w-5" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed inset-y-0 right-0 z-50 flex w-[82%] max-w-xs flex-col bg-surface-dark border-l border-border-line"
              role="dialog"
              aria-modal="true"
              aria-label="Mobile navigation"
            >
              <div className="flex items-center justify-between border-b border-border-line px-5 py-4">
                <Logo />
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="focus-ring rounded-lg p-2 text-text-muted hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-1 px-3 py-4" aria-label="Primary">
                {navItems.map((item) => {
                  const isActive =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href.split("/").slice(0, 2).join("/"));
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "focus-ring rounded-lg px-4 py-3 text-[15px] font-semibold transition-colors",
                        isActive
                          ? "bg-green-primary/15 text-green-light"
                          : "text-text-secondary hover:bg-white/5 hover:text-white"
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

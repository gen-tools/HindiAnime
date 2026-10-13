import type { ReactNode } from "react";

export function FadeIn({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <div className="section-reveal" style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

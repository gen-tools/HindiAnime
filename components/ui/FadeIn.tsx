"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

export function FadeIn({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-20px" }}
      transition={{ duration: 0.35, ease: "easeOut", delay }}
      className="transform-gpu"
    >
      {children}
    </motion.div>
  );
}

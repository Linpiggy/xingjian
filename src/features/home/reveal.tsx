/** 进入视口时上移淡入；系统开启“减少动态效果”时直接显示 */
"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * 水合完成后才采用系统“减少动态效果”设置：服务端无法得知该设置，
 * 若在首次渲染就分支，会导致服务端与客户端的样式不一致。
 */
export function useMotionReduced(): boolean {
  const hydrated = useHydrated();
  const reduced = useReducedMotion();
  return hydrated && Boolean(reduced);
}

export function Reveal({
  children,
  delay = 0,
  y = 28,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduced = useMotionReduced();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={
        reduced ? { duration: 0 } : { duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }
      }
    >
      {children}
    </motion.div>
  );
}

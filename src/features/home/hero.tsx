/**
 * 首屏：标题逐行升起；三张目的地照片以不同速度视差滚动，离开首屏时整体淡出。
 */
"use client";

import { ArrowDown } from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
import { useRef } from "react";
import { useMotionReduced } from "./reveal";
import { DESTINATIONS } from "@/lib/destinations";

const EASE = [0.22, 1, 0.36, 1] as const;
const LINES = ["说出想去的地方，", "功课交给 AI 来做"];

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useMotionReduced();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const still = (value: number) => (reduced ? 0 : value);
  const yMain = useTransform(scrollYProgress, [0, 1], [0, still(-90)]);
  const yTop = useTransform(scrollYProgress, [0, 1], [0, still(-220)]);
  const yBottom = useTransform(scrollYProgress, [0, 1], [0, still(-40)]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, reduced ? 1 : 1.12]);
  const fade = useTransform(scrollYProgress, [0, 0.75], [1, reduced ? 1 : 0]);
  const [hero, second, third] = DESTINATIONS;

  return (
    <section ref={ref} className="relative mx-auto max-w-7xl px-5 sm:px-8">
      <motion.div
        style={{ opacity: fade }}
        className="grid min-h-[calc(100dvh-4rem)] items-center gap-12 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16"
      >
        <div>
          <h1 className="font-display text-[clamp(2.3rem,4.6vw,4.4rem)] leading-[1.15] text-ink">
            {LINES.map((line, index) => (
              <span key={line} className="block overflow-hidden whitespace-nowrap pb-1">
                <motion.span
                  className="block"
                  initial={{ y: "105%" }}
                  animate={{ y: 0 }}
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { duration: 1, delay: 0.15 + index * 0.14, ease: EASE }
                  }
                >
                  {line}
                </motion.span>
              </span>
            ))}
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduced ? { duration: 0 } : { duration: 0.9, delay: 0.5, ease: EASE }
            }
            className="mt-7 max-w-xl text-[17px] leading-[1.9] text-ink-soft"
          >
            行间是一位会做功课的旅行规划
            Agent。它查资料、搜地点、看天气、算路线、排时间、估预算，几分钟后交给你一本拿着就能出发的旅行手册。觉得哪里不合适，直接说一句，它就去改。
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduced ? { duration: 0 } : { duration: 0.9, delay: 0.65, ease: EASE }
            }
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <a
              href="#planner"
              className="inline-flex h-12 items-center rounded-lg bg-ink px-6 font-medium text-paper transition-colors hover:bg-pine-deep"
            >
              开始规划
            </a>
            <a
              href="#samples"
              className="inline-flex h-12 items-center rounded-lg border border-line bg-card px-5 text-ink transition-colors hover:border-ink-faint"
            >
              看看示例手册
            </a>
          </motion.div>
        </div>

        <div className="relative h-[380px] sm:h-[520px]" aria-hidden>
          <motion.figure
            style={{ y: yMain }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={
              reduced ? { duration: 0 } : { duration: 1.2, delay: 0.2, ease: EASE }
            }
            className="absolute inset-y-0 left-0 w-[66%] overflow-hidden rounded-2xl shadow-float"
          >
            <motion.div style={{ scale }} className="absolute inset-0">
              <Image
                src={hero.photo}
                alt=""
                fill
                priority
                sizes="(min-width: 1024px) 34vw, 66vw"
                className="object-cover"
              />
            </motion.div>
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-5 pt-16 text-white">
              <span className="font-display text-3xl">{hero.city}</span>
              <span className="ml-2 text-sm text-white/85">{hero.tagline}</span>
            </figcaption>
          </motion.figure>
          <motion.figure
            style={{ y: yTop }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduced ? { duration: 0 } : { duration: 1.2, delay: 0.4, ease: EASE }
            }
            className="absolute right-0 top-[4%] h-[44%] w-[40%] overflow-hidden rounded-2xl shadow-float"
          >
            <Image src={second.photo} alt="" fill sizes="20vw" className="object-cover" />
            <figcaption className="absolute bottom-2 left-3 font-display text-lg text-white drop-shadow">
              {second.city}
            </figcaption>
          </motion.figure>
          <motion.figure
            style={{ y: yBottom }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduced ? { duration: 0 } : { duration: 1.2, delay: 0.55, ease: EASE }
            }
            className="absolute bottom-[2%] right-[6%] h-[42%] w-[38%] overflow-hidden rounded-2xl shadow-float"
          >
            <Image src={third.photo} alt="" fill sizes="20vw" className="object-cover" />
            <figcaption className="absolute bottom-2 left-3 font-display text-lg text-white drop-shadow">
              {third.city}
            </figcaption>
          </motion.figure>
        </div>
      </motion.div>

      <motion.a
        href="#how"
        style={{ opacity: fade }}
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-xs text-ink-faint lg:flex"
      >
        向下了解它怎么做功课
        <motion.span
          animate={reduced ? undefined : { y: [0, 6, 0] }}
          transition={
            reduced
              ? { duration: 0 }
              : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
          }
        >
          <ArrowDown size={16} aria-hidden />
        </motion.span>
      </motion.a>
    </section>
  );
}

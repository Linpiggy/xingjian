/**
 * 目的地长廊：桌面端吸顶，纵向滚动驱动横向平移，照片内部再做轻微反向视差；
 * 窄屏使用原生横向滑动（scroll-snap），不劫持滚动。
 */
"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMotionReduced } from "./reveal";
import { DESTINATIONS, type Destination } from "@/lib/destinations";

function Card({
  item,
  progress,
  index,
}: {
  item: Destination;
  progress: MotionValue<number>;
  index: number;
}) {
  const reduced = useMotionReduced();
  const shift = useTransform(
    progress,
    [0, 1],
    reduced ? ["0%", "0%"] : [`${-6 + index}%`, `${6 - index}%`],
  );
  return (
    <Link
      href={`/?city=${encodeURIComponent(item.city)}#planner`}
      className="group relative block h-[64vh] w-[min(38vw,560px)] shrink-0 overflow-hidden rounded-3xl bg-paper-deep"
    >
      <motion.div style={{ x: shift }} className="absolute -inset-x-[8%] inset-y-0">
        <Image
          src={item.photo}
          alt={`${item.city}风光`}
          fill
          sizes="40vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />
      </motion.div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-7 text-white">
        <div>
          <p className="font-display text-sm text-white/70">
            {String(index + 1).padStart(2, "0")}
          </p>
          <p className="font-display text-5xl">{item.city}</p>
          <p className="mt-2 text-white/85">{item.tagline}</p>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-sm backdrop-blur transition-colors group-hover:bg-white/25">
          去规划
          <ArrowUpRight size={15} aria-hidden />
        </span>
      </div>
    </Link>
  );
}

export function DestinationRail() {
  const section = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);
  const { scrollYProgress } = useScroll({
    target: section,
    offset: ["start start", "end end"],
  });
  // 两端各留一小段停顿：先看清标题，最后一张完整停留
  const x = useTransform(scrollYProgress, [0.12, 0.9], [0, -distance]);

  useEffect(() => {
    const measure = () => {
      if (track.current) {
        setDistance(Math.max(0, track.current.scrollWidth - window.innerWidth));
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <section aria-label="目的地">
      {/* 桌面：纵向滚动驱动横向长廊 */}
      <div ref={section} className="relative hidden h-[300vh] lg:block">
        <div className="sticky top-0 flex h-dvh items-center overflow-hidden">
          <motion.div
            ref={track}
            style={{ x }}
            className="flex items-center gap-6 pl-[max(2rem,calc((100vw-80rem)/2+2rem))] pr-16"
          >
            <div className="w-[340px] shrink-0 pr-6">
              <h2 className="font-display text-5xl leading-tight text-ink">
                从一座
                <br />
                城市开始
              </h2>
              <p className="mt-5 text-ink-soft">
                知识库已整理这些城市的玩法；其他城市同样可以规划，Agent
                会直接查询高德实时数据。
              </p>
            </div>
            {DESTINATIONS.map((item, index) => (
              <Card
                key={item.city}
                item={item}
                index={index}
                progress={scrollYProgress}
              />
            ))}
          </motion.div>
        </div>
      </div>

      {/* 窄屏：原生横滑 */}
      <div className="py-20 lg:hidden">
        <h2 className="px-5 font-display text-3xl text-ink sm:px-8">从一座城市开始</h2>
        <div className="mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 sm:px-8">
          {DESTINATIONS.map((item) => (
            <Link
              key={item.city}
              href={`/?city=${encodeURIComponent(item.city)}#planner`}
              className="relative aspect-[3/4] w-[72vw] shrink-0 snap-start overflow-hidden rounded-2xl bg-paper-deep"
            >
              <Image
                src={item.photo}
                alt={`${item.city}风光`}
                fill
                sizes="72vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                <p className="font-display text-3xl">{item.city}</p>
                <p className="mt-1 text-sm text-white/85">{item.tagline}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

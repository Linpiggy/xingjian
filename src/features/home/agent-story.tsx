/**
 * “Agent 怎么做功课”滚动叙事：桌面端整段吸顶，随滚动进度切换 5 个步骤，
 * 右侧舞台演示每一步在做什么（路线一步会随滚动逐段画出）；窄屏退化为逐段淡入的列表。
 */
"use client";

import {
  AlertTriangle,
  BookOpenText,
  Check,
  CloudRain,
  CloudSun,
  MapPinned,
  Route,
  ShieldCheck,
  Sun,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useRef, useState } from "react";
import { Reveal, useMotionReduced } from "./reveal";

const STEPS = [
  {
    icon: BookOpenText,
    title: "检索知识",
    text: "先查目的地知识库：怎么分区游、哪里要预约、吃什么、要避开什么。用到的条目会在手册里标明来源。",
  },
  {
    icon: MapPinned,
    title: "查询真实地点",
    text: "用高德地图搜索景点和顺路餐厅，评分、营业时间、实景图都是实时数据，不会凭空编出一个地点。",
  },
  {
    icon: CloudSun,
    title: "看天气",
    text: "查询行程日期的天气预报。哪天下雨，就把户外项目往后挪，换上博物馆或茶馆。",
  },
  {
    icon: Route,
    title: "排路线与时间",
    text: "按地理位置把景点分到每一天，少走回头路；再用真实的步行、公交、打车耗时排出每一站几点到。",
  },
  {
    icon: ShieldCheck,
    title: "校验与修正",
    text: "服务端逐条检查：地点是不是真的、三餐齐不齐、到了会不会已经闭馆。发现问题就退回给 Agent 自己改。",
  },
];

const PINS = [
  { name: "灵隐寺", x: 14, y: 42, time: "09:30" },
  { name: "楼外楼", x: 48, y: 30, time: "12:20" },
  { name: "断桥残雪", x: 66, y: 22, time: "14:00" },
  { name: "雷峰塔", x: 56, y: 70, time: "16:30" },
  { name: "河坊街", x: 84, y: 62, time: "18:30" },
];

function MapBase({ children }: { children?: React.ReactNode }) {
  return (
    <div className="relative size-full overflow-hidden rounded-2xl bg-paper-deep/60">
      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <pattern id="grid" width="8" height="8" patternUnits="userSpaceOnUse">
            <path
              d="M8 0H0V8"
              fill="none"
              stroke="var(--color-line)"
              strokeWidth="0.15"
            />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#grid)" />
        <ellipse cx="55" cy="48" rx="20" ry="17" fill="var(--color-sky-soft)" />
      </svg>
      <span className="absolute left-[50%] top-[45%] text-xs text-sky/70">西湖</span>
      {children}
    </div>
  );
}

function Pins({ withTime = false }: { withTime?: boolean }) {
  return (
    <>
      {PINS.map((pin, index) => (
        <motion.div
          key={pin.name}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
          initial={{ opacity: 0, scale: 0.4, y: -12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{
            delay: 0.1 + index * 0.12,
            type: "spring",
            stiffness: 380,
            damping: 22,
          }}
        >
          <span
            className={`grid size-7 place-items-center rounded-full text-xs font-semibold text-white shadow-lift ring-2 ring-card ${
              index === 1 || index === 4 ? "bg-clay" : "bg-pine"
            }`}
          >
            {index + 1}
          </span>
          <span className="absolute left-1/2 top-8 -translate-x-1/2 whitespace-nowrap rounded bg-card/95 px-1.5 py-0.5 text-[11px] text-ink shadow-lift">
            {withTime ? (
              <b className="mr-1 font-medium tabular text-pine">{pin.time}</b>
            ) : null}
            {pin.name}
          </span>
        </motion.div>
      ))}
    </>
  );
}

function Stage({
  step,
  routeProgress,
}: {
  step: number;
  routeProgress: MotionValue<number>;
}) {
  if (step === 0) {
    const docs = [
      ["灵隐寺与飞来峰游览要点", "进入灵隐寺需先购买飞来峰景区门票，再另购香花券……", 92],
      [
        "杭州：西湖片区怎么分区游",
        "环湖一圈约 15 公里，不建议一天走完，可按片区安排……",
        71,
      ],
      ["杭帮菜与街头小吃", "口味清淡偏甜，代表菜有西湖醋鱼、龙井虾仁……", 48],
    ] as const;
    return (
      <div className="flex size-full flex-col justify-center gap-2 p-4 sm:gap-3 sm:p-10">
        <div className="mb-1 self-start rounded-full border border-line bg-card px-3 py-1 text-xs text-ink-soft sm:mb-2 sm:px-4 sm:py-1.5 sm:text-sm">
          检索 · <span className="text-ink">灵隐寺 门票 怎么玩</span> · 杭州
        </div>
        {docs.map(([title, excerpt, score], index) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              delay: 0.1 + index * 0.12,
              duration: 0.6,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="rounded-xl border border-line bg-card p-3 shadow-lift sm:p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-ink">{title}</span>
              <span className="tabular text-xs text-ink-faint">相关度 {score}</span>
            </div>
            <p className="mt-1 truncate text-sm text-ink-soft">{excerpt}</p>
            <div className="mt-3 h-1 rounded-full bg-paper-deep">
              <motion.div
                className="h-full rounded-full bg-pine"
                initial={{ width: 0 }}
                animate={{ width: `${score}%` }}
                transition={{ delay: 0.3 + index * 0.12, duration: 0.8 }}
              />
            </div>
          </motion.div>
        ))}
      </div>
    );
  }
  if (step === 1) {
    return (
      <MapBase>
        <Pins />
      </MapBase>
    );
  }
  if (step === 2) {
    const days = [
      { label: "周六", icon: CloudSun, text: "多云", temp: "12–19°", note: "" },
      {
        label: "周日",
        icon: CloudRain,
        text: "小雨",
        temp: "11–15°",
        note: "户外后移，换博物馆",
      },
      { label: "周一", icon: Sun, text: "晴", temp: "10–18°", note: "" },
    ];
    return (
      <div className="grid size-full grid-cols-3 content-center gap-2 p-4 sm:gap-3 sm:p-10">
        {days.map((day, index) => (
          <motion.div
            key={day.label}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + index * 0.12, duration: 0.6 }}
            className={`rounded-2xl border bg-card p-3 text-center shadow-lift sm:p-5 ${day.note ? "border-sky" : "border-line"}`}
          >
            <p className="text-sm text-ink-faint">{day.label}</p>
            <day.icon
              className={`mx-auto my-2 size-6 sm:my-3 sm:size-8 ${day.note ? "text-sky" : "text-amber"}`}
              aria-hidden
            />
            <p className="font-medium text-ink">{day.text}</p>
            <p className="tabular text-sm text-ink-soft">{day.temp}</p>
            {day.note ? (
              <p className="mt-2 rounded-md bg-sky-soft px-1.5 py-1 text-[11px] leading-snug text-sky sm:mt-3 sm:text-xs">
                {day.note}
              </p>
            ) : null}
          </motion.div>
        ))}
      </div>
    );
  }
  if (step === 3) {
    const path = PINS.map((pin, index) => `${index ? "L" : "M"} ${pin.x} ${pin.y}`).join(
      " ",
    );
    return (
      <MapBase>
        <svg
          className="absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          <motion.path
            d={path}
            fill="none"
            stroke="var(--color-pine)"
            strokeWidth="0.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pathLength: routeProgress }}
          />
        </svg>
        <Pins withTime />
      </MapBase>
    );
  }
  const checks = [
    { ok: true, text: "12 个地点都来自高德检索结果" },
    { ok: true, text: "每天都安排了午餐和晚餐" },
    { ok: false, text: "雷峰塔 18:40 到达时已闭园", fix: "已与晚餐对调，16:30 先上塔" },
    { ok: true, text: "最后一站在返程前 1.5 小时结束" },
  ];
  return (
    <div className="flex size-full flex-col justify-center gap-2 p-4 sm:gap-3 sm:p-10">
      {checks.map((item, index) => (
        <motion.div
          key={item.text}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + index * 0.15, duration: 0.5 }}
          className="flex items-start gap-3 rounded-xl border border-line bg-card px-3 py-2 text-sm shadow-lift sm:px-4 sm:py-3 sm:text-base"
        >
          {item.ok ? (
            <Check size={18} className="mt-0.5 shrink-0 text-pine" aria-hidden />
          ) : (
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden />
          )}
          <div>
            <p className={item.ok ? "text-ink" : "text-ink-faint line-through"}>
              {item.text}
            </p>
            {item.fix ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.9 }}
                className="mt-0.5 text-sm text-pine"
              >
                Agent 自行修正：{item.fix}
              </motion.p>
            ) : null}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export function AgentStory() {
  const ref = useRef<HTMLDivElement>(null);
  const fullRoute = useMotionValue(1);
  const reduced = useMotionReduced();
  const [step, setStep] = useState(0);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  const routeProgress = useTransform(scrollYProgress, [0.6, 0.78], [0.05, 1]);
  const bar = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  useMotionValueEvent(scrollYProgress, "change", (value) => {
    setStep(Math.min(STEPS.length - 1, Math.max(0, Math.floor(value * STEPS.length))));
  });

  return (
    <section
      id="how"
      aria-labelledby="how-title"
      className="relative border-y border-line bg-paper-deep/50"
    >
      {/* 桌面：吸顶滚动叙事 */}
      <div ref={ref} className="hidden h-[460vh] lg:block">
        <div className="sticky top-0 flex h-dvh items-center">
          <div className="mx-auto grid w-full max-w-7xl grid-cols-[0.9fr_1.1fr] items-center gap-16 px-8">
            <div>
              <h2 id="how-title" className="font-display text-4xl leading-tight text-ink">
                不是一段聊天回复，
                <br />
                而是一套做功课的流程
              </h2>
              <ol className="mt-12 space-y-1">
                {STEPS.map((item, index) => {
                  const active = index === step;
                  return (
                    <li key={item.title}>
                      <motion.div
                        animate={{ opacity: active ? 1 : 0.38 }}
                        transition={{ duration: 0.4 }}
                        className="flex gap-5 py-3"
                      >
                        <span className="w-8 shrink-0 pt-0.5 font-display text-lg tabular text-pine">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <h3 className="flex items-center gap-2 text-xl font-semibold text-ink">
                            <item.icon size={20} className="text-pine" aria-hidden />
                            {item.title}
                          </h3>
                          <motion.p
                            initial={false}
                            animate={{
                              height: active ? "auto" : 0,
                              opacity: active ? 1 : 0,
                            }}
                            transition={{
                              duration: reduced ? 0 : 0.45,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            className="overflow-hidden text-[15px] leading-relaxed text-ink-soft"
                          >
                            <span className="block pt-2">{item.text}</span>
                          </motion.p>
                        </div>
                      </motion.div>
                    </li>
                  );
                })}
              </ol>
              <div
                className="mt-8 h-0.5 w-full max-w-sm overflow-hidden rounded-full bg-line"
                aria-hidden
              >
                <motion.div style={{ width: bar }} className="h-full bg-pine" />
              </div>
            </div>
            <div className="relative aspect-[5/4] rounded-3xl border border-line bg-card shadow-float">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  className="absolute inset-0"
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.35 }}
                >
                  <Stage step={step} routeProgress={routeProgress} />
                </motion.div>
              </AnimatePresence>
              <span className="absolute bottom-3 right-4 text-[11px] text-ink-faint">
                界面示意
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 窄屏：逐段淡入 */}
      <div className="px-5 py-20 sm:px-8 lg:hidden">
        <h2 className="font-display text-3xl leading-snug text-ink">
          不是一段聊天回复，而是一套做功课的流程
        </h2>
        <ol className="mt-10 space-y-12">
          {STEPS.map((item, index) => (
            <li key={item.title}>
              <Reveal>
                <p className="font-display text-sm text-pine">
                  {String(index + 1).padStart(2, "0")} / 05
                </p>
                <h3 className="mt-1 text-xl font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
                  {item.text}
                </p>
                <div className="relative mt-5 aspect-square rounded-2xl border border-line bg-card sm:aspect-[5/4]">
                  <Stage step={index} routeProgress={fullRoute} />
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

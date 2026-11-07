import { BookOpenText, CloudSun, MapPinned, Route, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { PlannerForm } from "@/features/planner/planner-form";
import { RecentTrips } from "@/features/trip/recent-trips";
import { DESTINATIONS } from "@/lib/destinations";

const STEPS = [
  {
    icon: BookOpenText,
    title: "检索知识",
    text: "从目的地知识库中检索分区玩法、美食、预约与避坑要点，并在手册里标注引用。",
  },
  {
    icon: MapPinned,
    title: "查询真实地点",
    text: "调用高德地图搜索景点和顺路餐厅，评分、营业时间、实景图都来自真实数据。",
  },
  {
    icon: CloudSun,
    title: "看天气",
    text: "查询行程日期的天气预报，下雨就把户外项目往后挪，多安排室内。",
  },
  {
    icon: Route,
    title: "排路线与时间",
    text: "按地理位置分组，减少来回折返；再用真实步行、公交和打车耗时排出每一站的时间。",
  },
  {
    icon: ShieldCheck,
    title: "校验与修正",
    text: "服务端检查营业时间冲突、编造的地点和缺漏的餐次，发现问题让 Agent 自己改正。",
  },
];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const { city = "" } = await searchParams;
  const [hero, second, third] = DESTINATIONS;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="relative mx-auto max-w-7xl px-5 pb-10 pt-6 sm:px-8 lg:pt-12">
          <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
            <div className="animate-rise">
              <h1 className="font-display text-[clamp(2.4rem,5.2vw,4.4rem)] leading-[1.12] text-ink">
                说出想去的地方，
                <br />
                功课交给 AI 来做
              </h1>
              <p className="mt-6 max-w-xl text-[17px] leading-[1.85] text-ink-soft">
                行间是一位会做功课的旅行规划
                Agent。它查资料、搜地点、看天气、算路线、排时间、估预算，几分钟后交给你一本拿着就能出发的旅行手册。觉得哪里不合适，直接说一句，它就去改。
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  href="#planner"
                  className="inline-flex h-12 items-center rounded-lg bg-ink px-6 font-medium text-paper transition-colors hover:bg-pine-deep"
                >
                  开始规划
                </a>
                <a
                  href="#how"
                  className="inline-flex h-12 items-center rounded-lg px-4 text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
                >
                  它是怎么工作的
                </a>
              </div>
            </div>

            <div
              className="relative grid h-[340px] grid-cols-[1.5fr_1fr] grid-rows-2 gap-3 sm:h-[440px]"
              aria-hidden
            >
              <figure className="relative row-span-2 overflow-hidden rounded-2xl shadow-lift">
                <Image
                  src={hero.photo}
                  alt=""
                  fill
                  priority
                  sizes="(min-width: 1024px) 30vw, 60vw"
                  className="object-cover"
                />
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 pt-12 text-white">
                  <span className="font-display text-2xl">{hero.city}</span>
                  <span className="ml-2 text-sm text-white/85">{hero.tagline}</span>
                </figcaption>
              </figure>
              {[second, third].map((item) => (
                <figure
                  key={item.city}
                  className="relative overflow-hidden rounded-2xl shadow-lift"
                >
                  <Image
                    src={item.photo}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 20vw, 40vw"
                    className="object-cover"
                  />
                  <figcaption className="absolute bottom-2 left-3 font-display text-lg text-white drop-shadow">
                    {item.city}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section id="planner" className="scroll-mt-6 px-5 pb-20 sm:px-8">
          <div className="mx-auto max-w-4xl rounded-2xl border border-line bg-card p-5 shadow-float sm:p-9">
            <h2 className="font-display text-2xl text-ink sm:text-[28px]">
              这次旅行，想怎么过？
            </h2>
            <p className="mb-7 mt-1.5 text-sm text-ink-soft">
              填得越具体，手册越贴合你。只填目的地也可以直接生成。
            </p>
            <PlannerForm key={city} initialCity={city} />
          </div>
        </section>

        <section
          id="how"
          className="scroll-mt-6 border-y border-line bg-paper-deep/60 px-5 py-20 sm:px-8"
        >
          <div className="mx-auto max-w-7xl">
            <h2 className="font-display text-3xl text-ink">
              不是一段聊天回复，而是一套做功课的流程
            </h2>
            <p className="mt-3 max-w-2xl text-ink-soft">
              大模型负责理解需求、做取舍；查数据和算时间交给工具和算法。每一步你都能在规划页实时看到。
            </p>
            <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map((step, index) => (
                <li key={step.title} className="bg-paper p-6">
                  <div className="flex items-center justify-between">
                    <step.icon size={22} className="text-pine" aria-hidden />
                    <span className="font-display text-sm text-ink-faint">
                      {index + 1} / 5
                    </span>
                  </div>
                  <h3 className="mt-6 text-lg font-semibold text-ink">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                    {step.text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
          <h2 className="font-display text-3xl text-ink">从一座城市开始</h2>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {DESTINATIONS.map((item) => (
              <Link
                key={item.city}
                href={`/?city=${encodeURIComponent(item.city)}#planner`}
                className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-paper-deep"
              >
                <Image
                  src={item.photo}
                  alt={`${item.city}风光`}
                  fill
                  sizes="(min-width: 1024px) 33vw, 50vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4 text-white sm:p-5">
                  <div className="font-display text-2xl sm:text-3xl">{item.city}</div>
                  <div className="mt-0.5 text-sm text-white/85">{item.tagline}</div>
                </div>
              </Link>
            ))}
          </div>
          <RecentTrips />
        </section>
      </main>

      <footer className="border-t border-line px-5 py-10 text-xs leading-relaxed text-ink-faint sm:px-8">
        <div className="mx-auto max-w-7xl space-y-2">
          <p>
            地点、路线与天气数据：高德开放平台。行程由 AI
            生成，票价与开放时间请以官方公告为准。
          </p>
          <p>
            目的地照片来自 Wikimedia Commons：
            {DESTINATIONS.map((item, index) => (
              <span key={item.city}>
                {index ? "；" : ""}
                <a
                  href={item.credit.sourceUrl}
                  className="underline-offset-2 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.city} © {item.credit.author}
                </a>
                ，
                <a
                  href={item.credit.licenseUrl}
                  className="underline-offset-2 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.credit.license}
                </a>
              </span>
            ))}
          </p>
        </div>
      </footer>
    </>
  );
}

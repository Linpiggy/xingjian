import { SiteHeader } from "@/components/site-header";
import { AgentStory } from "@/features/home/agent-story";
import { DestinationRail } from "@/features/home/destination-rail";
import { Hero } from "@/features/home/hero";
import { Reveal } from "@/features/home/reveal";
import { PlannerForm } from "@/features/planner/planner-form";
import { RecentTrips } from "@/features/trip/recent-trips";
import { SampleTrips } from "@/features/trip/sample-trips";
import { DESTINATIONS } from "@/lib/destinations";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const { city = "" } = await searchParams;

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />

        <AgentStory />

        <section
          id="samples"
          className="mx-auto max-w-7xl scroll-mt-6 px-5 pt-24 sm:px-8 lg:pt-32"
        >
          <Reveal>
            <h2 className="font-display text-3xl text-ink sm:text-4xl">先翻翻成品</h2>
            <p className="mb-10 mt-3 max-w-2xl text-ink-soft">
              这两份手册由行间 Agent
              实际生成，翻开后可以锁定、换顺序、替换地点，也可以直接对 AI 说想怎么改。
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <SampleTrips />
          </Reveal>
        </section>

        <DestinationRail />

        <section id="planner" className="scroll-mt-6 px-5 pb-24 pt-8 sm:px-8 lg:pt-16">
          <Reveal className="mx-auto max-w-4xl">
            <h2 className="text-center font-display text-3xl text-ink sm:text-[40px]">
              现在，轮到你了
            </h2>
            <p className="mb-10 mt-3 text-center text-ink-soft">
              填得越具体，手册越贴合你。只填目的地也可以直接生成。
            </p>
          </Reveal>
          <Reveal delay={0.1} y={40} className="mx-auto max-w-4xl">
            <div className="rounded-2xl border border-line bg-card p-5 shadow-float sm:p-9">
              <PlannerForm key={city} initialCity={city} />
            </div>
          </Reveal>
          <div className="mx-auto max-w-7xl">
            <RecentTrips />
          </div>
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

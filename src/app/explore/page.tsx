import Link from "next/link";
import {
  ArrowRight,
  Compass,
  MapPin,
  Coffee,
  Utensils,
  SlidersHorizontal,
} from "lucide-react";
import { TripSiteHeader } from "@/features/itinerary/trip-site-header";
import "@/features/itinerary/itinerary.css";
import "./travel-home.css";
import { ArcIcon } from "@/components/arc/icon/icon";
import { ButtonLink } from "@/components/arc/button/button";

export const metadata = { title: "行间 | 从一次期待开始" };

export default function ExplorePage() {
  return (
    <div className="trip-app travel-home">
      <TripSiteHeader />
      <main id="main" tabIndex={-1} className="travel-home-main">
        <section className="travel-home-hero" aria-labelledby="travel-home-heading">
          <div className="travel-home-copy">
            <p className="travel-home-label">
              <ArcIcon icon={Compass} size="md" aria-hidden="true" />
              把日子，留给喜欢的地方
            </p>
            <h1 id="travel-home-heading">
              你的下一站，
              <br />
              值得好好期待。
            </h1>
            <p className="travel-home-intro">
              可以把安排交给 AI，也可以亲自挑选想去的地点。
              在同一个工作台，把每天的吃玩、步行与停留，慢慢调成喜欢的样子。
            </p>
            <div className="travel-home-actions">
              <ButtonLink href="/plan" variant="primary">
                开始规划 <ArcIcon icon={ArrowRight} size="md" aria-hidden="true" />
              </ButtonLink>
              <ButtonLink href="/itinerary" variant="ghost">
                继续当前行程 <ArcIcon icon={ArrowRight} size="md" aria-hidden="true" />
              </ButtonLink>
            </div>
            <p className="travel-home-scope">一座城市 · 1—14 天 · 1—20 人</p>
          </div>
          <figure className="travel-home-figure">
            <div className="travel-paper-art" aria-hidden="true">
              <div className="travel-paper-back">
                <span>把想去，写成出发。</span>
              </div>
              <div className="travel-paper-front">
                <div className="travel-paper-top">
                  <span>我的旅行提案</span>
                  <span>行间</span>
                </div>
                <strong className="travel-paper-title">
                  有计划，
                  <br />
                  也有余地。
                </strong>
                <div className="travel-paper-timeline">
                  <div>
                    <ArcIcon icon={Coffee} size="md" />
                    <span>先吃一顿喜欢的早餐</span>
                  </div>
                  <div>
                    <ArcIcon icon={MapPin} size="md" />
                    <span>走进感兴趣的地方</span>
                  </div>
                  <div>
                    <ArcIcon icon={Utensils} size="md" />
                    <span>在下一站，尝一口当地</span>
                  </div>
                </div>
                <span className="travel-paper-bottom">
                  让吃饭、走路和停留，都有自己的位置。
                </span>
              </div>
              <div className="travel-paper-note">
                <ArcIcon icon={SlidersHorizontal} size="md" />
                <span>
                  不必一次定稿
                  <strong>先预览，再决定。</strong>
                </span>
              </div>
            </div>
            <figcaption>行程结构示意，非真实地图或已生成方案</figcaption>
          </figure>
        </section>
        <section className="travel-home-entrypoints" aria-label="选择规划方式">
          <Link href="/plan">
            <span>从一个想法开始</span>
            <strong>让 AI 安排完整一天</strong>
            <ArcIcon icon={ArrowRight} size="md" aria-hidden="true" />
          </Link>
          <Link href="/itinerary">
            <span>已经有了方案</span>
            <strong>回到你的旅行提案</strong>
            <ArcIcon icon={ArrowRight} size="md" aria-hidden="true" />
          </Link>
          <Link href="/plan">
            <span>已经想好必去</span>
            <strong>在需求里补充必去地点</strong>
            <ArcIcon icon={ArrowRight} size="md" aria-hidden="true" />
          </Link>
        </section>
        <p className="travel-home-footnote">
          候选来自地点搜索，体验建议由 AI 提供；开放、预约与实际费用仍需核实。
          当前行程仅保留在本次浏览会话内，刷新会清空。
        </p>
      </main>
    </div>
  );
}

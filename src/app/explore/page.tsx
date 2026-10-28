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

export const metadata = { title: "行间 | 从一次期待开始" };

export default function ExplorePage() {
  return (
    <div className="trip-app travel-home">
      <TripSiteHeader />
      <main id="main" className="travel-home-main">
        <section className="travel-home-hero" aria-labelledby="travel-home-heading">
          <div className="travel-home-copy">
            <p className="travel-home-label">
              <Compass size={18} aria-hidden="true" />
              把日子，留给喜欢的地方
            </p>
            <h1 id="travel-home-heading">
              你的下一站，
              <br />
              值得好好期待。
            </h1>
            <p className="travel-home-intro">
              告诉我们想去的城市、能玩的时间与预算。把每天的吃玩和换地点安排好，再按你的想法慢慢调整。
            </p>
            <div className="travel-home-actions">
              <Link href="/plan" className="travel-home-start">
                开始规划 <ArrowRight size={19} aria-hidden="true" />
              </Link>
              <Link href="/itinerary">
                继续当前行程 <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <p className="travel-home-scope">一座城市 · 1—14 天 · 1—20 人</p>
          </div>
          <figure className="travel-home-figure">
            <div className="travel-paper-art" aria-hidden="true">
              <div className="travel-paper-back">
                <span>把想去，写成出发。</span>
                <Compass size={80} strokeWidth={1} />
              </div>
              <div className="travel-paper-front">
                <div className="travel-paper-top">
                  <span>我的旅行提案</span>
                  <span>行间</span>
                </div>
                <strong>
                  有计划，
                  <br />
                  也有余地。
                </strong>
                <div className="travel-paper-timeline">
                  <div>
                    <Coffee size={19} />
                    <span>先吃一顿喜欢的早餐</span>
                  </div>
                  <div>
                    <MapPin size={19} />
                    <span>走进感兴趣的地方</span>
                  </div>
                  <div>
                    <Utensils size={19} />
                    <span>在下一站，尝一口当地</span>
                  </div>
                </div>
                <span className="travel-paper-bottom">
                  让吃饭、走路和停留，都有自己的位置。
                </span>
              </div>
              <div className="travel-paper-note">
                <SlidersHorizontal size={20} />
                <span>
                  不必一次定稿
                  <br />
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
            <ArrowRight size={20} aria-hidden="true" />
          </Link>
          <Link href="/itinerary">
            <span>已经有了方案</span>
            <strong>回到你的旅行提案</strong>
            <ArrowRight size={20} aria-hidden="true" />
          </Link>
          <Link href="/manual">
            <span>想亲自选择地点</span>
            <strong>打开手动选点工作台</strong>
            <ArrowRight size={20} aria-hidden="true" />
          </Link>
        </section>
        <p className="travel-home-footnote">
          候选来自地点搜索，体验建议由 AI
          提供；开放、预约与实际费用仍需核实。当前行程仅保留在本次浏览会话内，刷新会清空。
        </p>
      </main>
    </div>
  );
}

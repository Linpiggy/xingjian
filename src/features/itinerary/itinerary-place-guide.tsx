import type { ItineraryGuide } from "@/domain/itinerary";

export function ItineraryPlaceGuide({
  guide,
  meal,
}: {
  guide: ItineraryGuide;
  meal: boolean;
}) {
  return (
    <section
      className="trip-place-guide"
      aria-label={meal ? "AI 用餐建议" : "AI 游玩建议"}
    >
      <header>
        <h3>{meal ? "这一餐，怎样吃" : "这一站，怎样玩"}</h3>
        <span>AI 体验建议 · 非已核实地点介绍</span>
      </header>
      <p>{guide.experience}</p>
      <div className="trip-guide-columns">
        <section>
          <h4>体验重点</h4>
          <ul>
            {guide.highlights.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </section>
        <section>
          <h4>{meal ? "点餐建议" : "游玩建议"}</h4>
          <ul>
            {guide.tips.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </section>
      </div>
      <section className="trip-guide-checks">
        <h4>出发前再确认</h4>
        <ul>
          {guide.checkBeforeGo.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </section>
      <p className="trip-guide-disclaimer">
        以上由生成方案时的模型提供，不是商家、景区或评论证据；营业、菜单、预约及现场规定以实际核实为准。
      </p>
    </section>
  );
}

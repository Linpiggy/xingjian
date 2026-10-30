import { Coffee, Footprints, MapPin, Utensils, Landmark } from "lucide-react";
import type { Itinerary } from "@/domain/itinerary";
import { formatMinute } from "@/domain/draft";

const visuals = { visit: Landmark, breakfast: Coffee, lunch: Utensils, dinner: Utensils };
const labels = { visit: "游览", breakfast: "早餐", lunch: "午餐", dinner: "晚餐" };
export function DayOverview({
  day,
  selected,
  onSelect,
}: {
  day: Itinerary["days"][number];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const schedule = day.schedule;
  if (!schedule) {
    return null;
  }
  const attractions = schedule.items.filter((item) => item.activity.kind === "visit");
  const visits = attractions.length;
  const meals = schedule.items.length - visits;
  const measured = schedule.legs.filter((leg) => leg.route?.meters != null);
  const meters = measured.reduce((sum, leg) => sum + (leg.route?.meters ?? 0), 0);
  const unknown = schedule.legs.length - measured.length;
  return (
    <section className="trip-day-overview" aria-label="当日行程速览">
      <div className="trip-day-metrics">
        <span>
          <MapPin size={17} aria-hidden="true" />
          <strong>{visits}</strong> 处游览
        </span>
        <span>
          <Utensils size={17} aria-hidden="true" />
          <strong>{meals}</strong> 次用餐
        </span>
        <span>
          <Footprints size={17} aria-hidden="true" />
          {measured.length ? `已知步行 ${(meters / 1000).toFixed(1)} km` : "步行距离未知"}
          {unknown > 0 && <small>{unknown} 段待核实</small>}
        </span>
      </div>
      {attractions.length > 0 && (
        <div className="trip-day-highlights">
          <strong>当天重点</strong>
          <ul>
            {attractions.map((item) => (
              <li key={item.activity.id}>
                <button
                  type="button"
                  aria-label={`查看当天重点：${item.activity.place.name}`}
                  onClick={() => onSelect(item.activity.id)}
                >
                  {item.activity.place.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="trip-rhythm-details">
        <summary>查看行程节奏 · {schedule.items.length} 站</summary>
        <ol className="trip-rhythm">
          {schedule.items.map((item, index) => {
            const Icon = visuals[item.activity.kind];
            return (
              <li key={item.activity.id}>
                <button
                  type="button"
                  aria-label={`在地图中定位第 ${index + 1} 站：${item.activity.place.name}`}
                  aria-pressed={selected === item.activity.id}
                  title={item.activity.place.name}
                  onClick={() => onSelect(item.activity.id)}
                >
                  <Icon size={23} strokeWidth={1.6} aria-hidden="true" />
                  <strong>{labels[item.activity.kind]}</strong>
                  <time>{formatMinute(item.startMinute)}</time>
                </button>
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}

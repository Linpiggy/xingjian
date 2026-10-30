import { Coffee, Footprints, MapPin, Utensils, Landmark } from "lucide-react";
import type { Itinerary } from "@/domain/itinerary";
import { formatMinute } from "@/domain/draft";
import { Disclosure } from "@/components/arc/disclosure/disclosure";
import { ArcIcon } from "@/components/arc/icon/icon";

const visuals = { visit: Landmark, breakfast: Coffee, lunch: Utensils, dinner: Utensils };
const labels = { visit: "游览", breakfast: "早餐", lunch: "午餐", dinner: "晚餐" };
export function DayOverview({ day }: { day: Itinerary["days"][number] }) {
  const schedule = day.schedule;
  if (!schedule) {
    return null;
  }
  const attractions = schedule.items.filter((item) => item.activity.kind === "visit");
  const measured = schedule.legs.filter((leg) => leg.route?.meters != null);
  const meters = measured.reduce((sum, leg) => sum + (leg.route?.meters ?? 0), 0);
  const unknown = schedule.legs.length - measured.length;
  return (
    <section className="trip-day-overview" aria-label="当日行程速览">
      <div className="trip-day-metrics">
        <span>
          <ArcIcon icon={MapPin} size="md" aria-hidden="true" />
          <strong>{attractions.length}</strong> 处游览
        </span>
        <span>
          <ArcIcon icon={Utensils} size="md" aria-hidden="true" />
          <strong>{schedule.items.length - attractions.length}</strong> 次用餐
        </span>
        <span>
          <ArcIcon icon={Footprints} size="md" aria-hidden="true" />
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
                <span>{item.activity.place.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Disclosure
        className="trip-rhythm-details"
        title={`查看行程节奏 · ${schedule.items.length} 站`}
      >
        <ol className="trip-rhythm">
          {schedule.items.map((item) => {
            const Icon = visuals[item.activity.kind];
            return (
              <li key={item.activity.id}>
                <div title={item.activity.place.name}>
                  <ArcIcon icon={Icon} size="lg" strokeWidth={1.6} aria-hidden="true" />
                  <strong>{labels[item.activity.kind]}</strong>
                  <time>{formatMinute(item.startMinute)}</time>
                </div>
              </li>
            );
          })}
        </ol>
      </Disclosure>
    </section>
  );
}

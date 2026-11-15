/** 车次相关的共享计算：前后端都用 */
import type { Train, TrainLeg } from "./schema";

/** 一趟车的各段；旧数据没有 legs 时把整趟当作一段 */
export function trainLegs(train: Train): TrainLeg[] {
  // 旧数据可能没有 legs 字段（未经迁移时为 undefined），按单段处理
  if (train.legs?.length) {
    return train.legs;
  }
  return [
    {
      trip: train.trip,
      type: train.type,
      from: train.from,
      to: train.to,
      depart: train.depart,
      arrive: train.arrive,
      departDayOffset: 0,
      arriveDayOffset: train.arriveDayOffset || (train.arriveNextDay ? 1 : 0),
      minutes: train.minutes,
      seats: train.seats,
    },
  ];
}

export function transferCount(train: Train): number {
  return Math.max(0, trainLegs(train).length - 1);
}

/** 到达日偏移：+1 表示次日到达 */
export function dayOffsetLabel(offset: number): string {
  return offset > 0 ? `+${offset}` : "";
}

/** 每段车票取二等座（没有时取最便宜的有座席别）的最高档价格；任一段未知则整趟未知 */
export function legFare(leg: TrainLeg): number | null {
  if (!leg.seats.length) {
    return null;
  }
  const seat =
    leg.seats.find((item) => item.name.includes("二等")) ??
    leg.seats.find((item) => !item.name.includes("无座")) ??
    leg.seats[0];
  return seat.maxPrice ?? seat.price;
}

export function trainFare(train: Train | null): number | null {
  if (!train) {
    return null;
  }
  let total = 0;
  for (const leg of trainLegs(train)) {
    const fare = legFare(leg);
    if (fare === null) {
      return null;
    }
    total += fare;
  }
  return total;
}

/** 相邻两段之间的换乘等候（分钟），站名不同表示需要在城市内换站 */
export function transferWait(previous: TrainLeg, next: TrainLeg): number {
  const toAbsolute = (clock: string, offset: number) => {
    const [hours, minutes] = clock.split(":").map(Number);
    return offset * 1440 + hours * 60 + minutes;
  };
  return (
    toAbsolute(next.depart, next.departDayOffset) -
    toAbsolute(previous.arrive, previous.arriveDayOffset)
  );
}

/** 一句话描述整趟车，供提示词、长图与文本导出使用 */
export function describeTrain(train: Train): string {
  const legs = trainLegs(train);
  return legs
    .map(
      (leg) =>
        `${leg.trip} ${leg.from} ${leg.depart}${dayOffsetLabel(leg.departDayOffset)}→${leg.to} ${leg.arrive}${dayOffsetLabel(leg.arriveDayOffset)}`,
    )
    .join("，换乘 ");
}

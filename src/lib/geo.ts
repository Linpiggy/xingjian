import type { Coordinate } from "./schema";

/** 球面直线距离（米），只用于粗筛和排序，最终交通时间以高德路线为准 */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const radius = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

/**
 * 最近邻 + 2-opt 的开放路径排序，用于给 Agent 提供“顺路顺序”建议。
 * 起点固定为第一个点，地点数很少（≤8），复杂度可以忽略。
 */
export function orderByShortestPath<T extends { location: Coordinate }>(items: T[]): T[] {
  if (items.length <= 2) {
    return [...items];
  }
  const rest = items.slice(1);
  const route: T[] = [items[0]];
  while (rest.length) {
    const last = route[route.length - 1];
    let best = 0;
    for (let i = 1; i < rest.length; i += 1) {
      if (
        distanceMeters(last.location, rest[i].location) <
        distanceMeters(last.location, rest[best].location)
      ) {
        best = i;
      }
    }
    route.push(rest.splice(best, 1)[0]);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 1; i += 1) {
      for (let j = i + 1; j < route.length; j += 1) {
        const candidate = [
          ...route.slice(0, i),
          ...route.slice(i, j + 1).reverse(),
          ...route.slice(j + 1),
        ];
        if (pathLength(candidate) + 1 < pathLength(route)) {
          route.splice(0, route.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return route;
}

export function pathLength(items: { location: Coordinate }[]): number {
  let total = 0;
  for (let i = 1; i < items.length; i += 1) {
    total += distanceMeters(items[i - 1].location, items[i].location);
  }
  return total;
}

/**
 * 按地理位置把候选地点分成 k 组（简化 k-means，固定迭代次数），
 * 让每天的景点尽量集中在同一片区域，减少折返。
 */
export function clusterByArea<T extends { location: Coordinate }>(
  items: T[],
  k: number,
): T[][] {
  const groups = Math.max(1, Math.min(k, items.length));
  if (groups === 1) {
    return [items];
  }
  // 初始中心：按经度排序后均匀取点，结果稳定、可复现
  const sorted = [...items].sort((a, b) => a.location[0] - b.location[0]);
  let centers: Coordinate[] = Array.from(
    { length: groups },
    (_, i) => sorted[Math.floor(((i + 0.5) * sorted.length) / groups)].location,
  );
  let assignment: number[] = [];
  for (let round = 0; round < 12; round += 1) {
    assignment = items.map((item) => {
      let best = 0;
      for (let c = 1; c < centers.length; c += 1) {
        if (
          distanceMeters(item.location, centers[c]) <
          distanceMeters(item.location, centers[best])
        ) {
          best = c;
        }
      }
      return best;
    });
    centers = centers.map((center, c) => {
      const members = items.filter((_, i) => assignment[i] === c);
      if (!members.length) {
        return center;
      }
      return [
        members.reduce((sum, m) => sum + m.location[0], 0) / members.length,
        members.reduce((sum, m) => sum + m.location[1], 0) / members.length,
      ];
    });
  }
  return centers
    .map((_, c) => items.filter((__, i) => assignment[i] === c))
    .filter((group) => group.length > 0);
}

/**
 * Douglas–Peucker 折线简化（容差为经纬度度数，约 0.0002° ≈ 20 米）。
 * 只用于压缩分享数据：保留起终点与转折，路线形状基本不变。
 */
export function simplifyPath(points: Coordinate[], tolerance = 0.0002): Coordinate[] {
  if (points.length <= 2) {
    return points;
  }
  const [start, end] = [points[0], points[points.length - 1]];
  let maxDistance = 0;
  let index = 0;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1e-12;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [x, y] = points[i];
    const distance =
      Math.abs(dy * x - dx * y + end[0] * start[1] - end[1] * start[0]) / length;
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= tolerance) {
    return [start, end];
  }
  return [
    ...simplifyPath(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplifyPath(points.slice(index), tolerance),
  ];
}

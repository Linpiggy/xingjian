/**
 * 目的地封面：仅使用仓库 public 内的本地素材，按城市归一化后匹配。
 * 命不中就不出图，不用无关照片或生成图凑数。
 */
const covers: Record<string, string> = {
  杭州: "/images/destinations/hangzhou.jpg",
  苏州: "/images/destinations/suzhou.jpg",
  南京: "/images/destinations/nanjing.jpg",
  上海: "/images/destinations/shanghai.jpg",
  西安: "/images/destinations/xian.jpg",
  成都: "/images/destinations/chengdu.jpg",
};

export function destinationCover(city: string): string | null {
  const key = city.trim().replace(/(市|地区|自治州)$/u, "");
  for (const [name, src] of Object.entries(covers)) {
    if (key.includes(name)) {
      return src;
    }
  }
  return null;
}

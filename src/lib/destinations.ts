/**
 * 首页目的地与封面图。图片来自 Wikimedia Commons，按各自 CC 许可署名使用；
 * 未收录的城市不配“相似”照片，改用行程中第一处景点的高德实景图或纯排版封面。
 */
export interface Destination {
  city: string;
  tagline: string;
  photo: string;
  credit: { author: string; license: string; licenseUrl: string; sourceUrl: string };
}

export const DESTINATIONS: Destination[] = [
  {
    city: "杭州",
    tagline: "湖山之间，一城茶香",
    photo: "/images/destinations/hangzhou.jpg",
    credit: {
      author: "Wanderingchina",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Aerial_panorama_of_West_Lake_and_its_surrounding_mountains._December_2023.jpg",
    },
  },
  {
    city: "苏州",
    tagline: "园林里的移步换景",
    photo: "/images/destinations/suzhou.jpg",
    credit: {
      author: "King of Hearts",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Humble_Administrator%27s_Garden_Suzhou_November_2017_004.jpg",
    },
  },
  {
    city: "西安",
    tagline: "城墙之上看千年",
    photo: "/images/destinations/xian.jpg",
    credit: {
      author: "Ideophagous",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Xi%27an_city_walls_(16892).jpg",
    },
  },
  {
    city: "成都",
    tagline: "慢下来的烟火气",
    photo: "/images/destinations/chengdu.jpg",
    credit: {
      author: "Daniel Lu (User:dllu)",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Anshun_Bridge_Jin_River_Chengdu_night_2026_dllu.jpg",
    },
  },
  {
    city: "上海",
    tagline: "梧桐与天际线",
    photo: "/images/destinations/shanghai.jpg",
    credit: {
      author: "Dllu",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl:
        "https://commons.wikimedia.org/wiki/File:Blue_hour_view_of_the_Bund_from_the_Shanghai_World_Financial_Center_dllu.jpg",
    },
  },
  {
    city: "南京",
    tagline: "六朝烟水，梧桐满城",
    photo: "/images/destinations/nanjing.jpg",
    credit: {
      author: "Leiem",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Xuanwu_Hu_Jingse_2.JPG",
    },
  },
];

/** 知识库已覆盖、可作为快捷选项的城市 */
export const QUICK_CITIES = [
  "杭州",
  "北京",
  "上海",
  "西安",
  "成都",
  "苏州",
  "南京",
  "重庆",
  "广州",
  "厦门",
  "长沙",
];

export function destinationFor(city: string): Destination | null {
  const name = city.trim().replace(/(市|地区)$/u, "");
  return DESTINATIONS.find((item) => name.includes(item.city)) ?? null;
}

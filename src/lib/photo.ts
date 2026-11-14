/** 高德 POI 图片地址校验与同源代理地址 */
export function isAllowedPhoto(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)(autonavi|amap)\.com$/.test(url.hostname) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function proxiedPhoto(url: string): string {
  return `/api/photo?url=${encodeURIComponent(url)}`;
}

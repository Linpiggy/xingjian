/**
 * 高德地点实景图：先直连图片服务；失败时改走同源代理；再失败就隐藏，不显示裂图。
 */
"use client";

import { useState } from "react";
import { proxiedPhoto } from "@/lib/photo";

export function PlacePhoto({
  src,
  alt,
  className = "",
  onUnavailable,
}: {
  src: string;
  alt: string;
  className?: string;
  /** 两次都失败时通知父组件（用于收起图片区域） */
  onUnavailable?: () => void;
}) {
  const [attempt, setAttempt] = useState<0 | 1 | 2>(0);
  if (attempt === 2) {
    return null;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={attempt === 0 ? src : proxiedPhoto(src)}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => {
        if (attempt === 0) {
          setAttempt(1);
        } else {
          setAttempt(2);
          onUnavailable?.();
        }
      }}
    />
  );
}

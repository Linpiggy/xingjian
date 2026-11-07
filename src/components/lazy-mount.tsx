"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** 进入视口附近才挂载子组件（用于地图等重组件），挂载后不再卸载 */
export function LazyMount({
  children,
  placeholder,
  className = "",
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className={className}>
      {visible ? children : placeholder}
    </div>
  );
}

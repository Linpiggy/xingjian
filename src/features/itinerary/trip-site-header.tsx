"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Compass } from "lucide-react";
import type { MouseEvent } from "react";
import { ArcIcon } from "@/components/arc/icon/icon";

export function TripSiteHeader({
  beforeNavigate,
}: { beforeNavigate?: (href: string) => boolean | Promise<boolean> } = {}) {
  const router = useRouter();
  function protectDraft(event: MouseEvent<HTMLAnchorElement>) {
    if (event.currentTarget.href === window.location.href) {
      return;
    }
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      beforeNavigate
    ) {
      const href = event.currentTarget.getAttribute("href");
      const allowed = beforeNavigate(href ?? "");
      if (typeof allowed === "boolean") {
        if (!allowed) {
          event.preventDefault();
        }
      } else {
        event.preventDefault();
        void allowed.then((confirmed) => {
          if (confirmed && href) {
            router.push(href);
          }
        });
      }
    }
  }
  const pathname = usePathname();
  const links = [
    { href: "/", label: "首页" },
    { href: "/plan", label: "规划工作台" },
    { href: "/itinerary", label: "当前行程" },
  ];
  return (
    <header className="trip-site-header">
      <Link href="/" className="trip-brand" onClick={protectDraft}>
        <ArcIcon icon={Compass} size="lg" aria-hidden="true" />
        行间
      </Link>
      <span className="trip-header-divider" aria-hidden="true" />
      <span>旅行规划工作台</span>
      <nav className="trip-primary-nav" aria-label="主导航">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={protectDraft}
            aria-current={
              pathname === link.href || (pathname === "/explore" && link.href === "/")
                ? "page"
                : undefined
            }
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

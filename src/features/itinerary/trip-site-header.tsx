"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass } from "lucide-react";
import type { MouseEvent } from "react";

export function TripSiteHeader({
  beforeNavigate,
}: { beforeNavigate?: () => boolean } = {}) {
  function protectDraft(event: MouseEvent<HTMLAnchorElement>) {
    if (event.currentTarget.getAttribute("href") === pathname) {
      return;
    }
    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      beforeNavigate &&
      !beforeNavigate()
    ) {
      event.preventDefault();
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
        <Compass size={24} aria-hidden="true" />
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

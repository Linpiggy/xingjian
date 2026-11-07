import Link from "next/link";

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="no-print relative z-20">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="flex items-baseline gap-2" aria-label="行间首页">
          <span className="font-display text-2xl text-ink">行间</span>
          <span className="hidden text-xs tracking-wide text-ink-faint sm:inline">
            AI 旅行规划 Agent
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {children}
          <Link
            href="/trips"
            className="rounded-md px-3 py-2 text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
          >
            我的行程
          </Link>
        </nav>
      </div>
    </header>
  );
}

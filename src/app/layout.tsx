import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./workbench-theme.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "行间 | 旅行规划工作台",
  description: "用真实地点与路线建立可核实的旅行草稿。",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main">
          跳到主要内容
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "视笺",
  title: "视笺 · 把视频变成知识",
  description:
    "提取视频字幕，用 DeepSeek 整理结构化笔记与深度分析。支持 B站、抖音、YouTube 等视频平台及音视频文件。",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "视笺", statusBarStyle: "default" },
};
export const viewport: Viewport = { themeColor: "#f7f3f8" };
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

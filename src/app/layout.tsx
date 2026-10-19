import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "视笺 · 把视频变成知识",
  description:
    "提取视频字幕，用 DeepSeek 整理结构化笔记与深度分析。支持 B站、抖音、YouTube 等视频平台及音视频文件。",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "视笺 · 视频知识笔记",
    short_name: "视笺",
    description: "提取视频字幕，用 DeepSeek 整理结构化笔记与内容分析。",
    lang: "zh-CN",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f3f8",
    theme_color: "#f7f3f8",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

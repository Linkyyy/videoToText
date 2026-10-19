import type { Segment, Transcript } from "./types";

export const MAX_TRANSCRIPT_CHARS = 60_000;
export const PLATFORMS: Record<string, string> = {
  "bilibili.com": "哔哩哔哩",
  "b23.tv": "哔哩哔哩",
  "douyin.com": "抖音",
  "iesdouyin.com": "抖音",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "tiktok.com": "TikTok",
  "vimeo.com": "Vimeo",
  "xiaohongshu.com": "小红书",
  "xhslink.com": "小红书",
  "kuaishou.com": "快手",
};

export function validateVideoUrl(value: string): {
  url: string;
  platform: string;
} {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    throw new Error("请输入完整的视频链接（以 https:// 开头）。");
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  ) {
    throw new Error("仅支持没有账号信息的 HTTPS 视频链接。");
  }
  const host = u.hostname.toLowerCase();
  const match = Object.entries(PLATFORMS).find(
    ([domain]) => host === domain || host.endsWith(`.${domain}`),
  );
  if (!match)
    throw new Error(
      "暂不支持这个域名。请使用 B站、抖音、YouTube、TikTok、Vimeo、小红书或快手链接。",
    );
  if (u.href.length > 2048)
    throw new Error("视频链接过长，请粘贴视频页面地址。");
  u.hash = "";
  return { url: u.href, platform: match[1] };
}

export function formatTime(seconds: number | null): string {
  if (seconds === null) return "—";
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  return `${h ? `${h}:` : ""}${String(Math.floor(t / 60) % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function timestamp(value: string): number {
  const parts = value.replace(",", ".").split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (v) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
        })[v] ?? v,
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
      const code = n.toLowerCase().startsWith("x")
        ? parseInt(n.slice(1), 16)
        : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .trim();
}

export function importTranscript(
  value: string,
  title = "导入的字幕",
): Transcript {
  const input = value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!input) throw new Error("请先输入字幕或文本。");
  if (input.length > MAX_TRANSCRIPT_CHARS)
    throw new Error("单次最多处理 60,000 个字符，请按章节分段导入。");
  const timed = input.includes("-->");
  const segments: Segment[] = [];
  if (timed) {
    for (const block of input.split(/\n\s*\n/)) {
      if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue;
      const lines = block.split("\n");
      const index = lines.findIndex((line) => /-->/.test(line));
      if (index < 0) continue;
      const match = lines[index].match(
        /((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})/,
      );
      if (!match) continue;
      const text = cleanText(lines.slice(index + 1).join(" "));
      const start = timestamp(match[1]),
        end = timestamp(match[2]);
      if (!text || end <= start) continue;
      const prev = segments.at(-1);
      if (prev?.text === text) {
        prev.end = Math.max(prev.end ?? 0, end);
        continue;
      }
      segments.push({ start, end, text });
    }
    if (!segments.length)
      throw new Error("未能读取字幕时间轴，请检查 SRT / VTT 文件格式。");
  } else {
    for (const text of input
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      segments.push({ start: null, end: null, text });
    }
  }
  return {
    title: title.slice(0, 200),
    text: segments.map((s) => s.text).join("\n"),
    segments,
    source: "import",
  };
}

export function toSrt(transcript: Transcript): string {
  const stamp = (s: number) =>
    new Date(Math.max(0, s) * 1000)
      .toISOString()
      .slice(11, 23)
      .replace(".", ",");
  const segments = transcript.segments.filter(
    (s) => s.start !== null && s.end !== null,
  );
  if (!segments.length) throw new Error("这份文本没有时间轴，可导出 TXT。");
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${stamp(s.start!)} --> ${stamp(s.end!)}\n${s.text}\n`,
    )
    .join("\n");
}

export function splitText(text: string, limit = 12_000): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let index = rest.lastIndexOf("\n", limit);
    if (index < limit / 2) index = limit;
    chunks.push(rest.slice(0, index));
    rest = rest.slice(index).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

import { describe, expect, it } from "vitest";
import {
  importTranscript,
  validateVideoUrl,
  formatTime,
  toSrt,
  splitText,
} from "../src/lib/transcript";

describe("字幕导入与导出", () => {
  it("解析 SRT 时间轴并可重新导出", () => {
    const t = importTranscript(
      "1\r\n00:00:01,500 --> 00:00:04,250\r\n你好 &amp; 世界\r\n\r\n2\r\n00:01:00,000 --> 00:01:03,000\r\n<b>第二段</b>",
    );
    expect(t.segments).toEqual([
      { start: 1.5, end: 4.25, text: "你好 & 世界" },
      { start: 60, end: 63, text: "第二段" },
    ]);
    expect(importTranscript(toSrt(t)).segments).toEqual(t.segments);
  });
  it("读取 WebVTT cue 标识，忽略注释并合并连续重复字幕", () => {
    const t = importTranscript(
      "WEBVTT\n\nNOTE 备注\n不应出现\n\ncue-1\n00:01.000 --> 00:02.000 align:start\n你好\n\n00:02.000 --> 00:03.000\n你好",
    );
    expect(t.segments).toEqual([{ start: 1, end: 3, text: "你好" }]);
  });
  it("普通文本不编造时间轴", () => {
    const t = importTranscript("原文段落\n\n第二段");
    expect(t.segments.every((s) => s.start === null && s.end === null)).toBe(
      true,
    );
    expect(() => toSrt(t)).toThrow("没有时间轴");
  });
  it("拒绝空内容、损坏字幕与超限文本", () => {
    expect(() => importTranscript(" ")).toThrow();
    expect(() => importTranscript("invalid --> timestamp")).toThrow("时间轴");
    expect(() => importTranscript("字".repeat(60001))).toThrow("60,000");
  });
  it("正确处理小时与文本分段", () => {
    expect(formatTime(3723)).toBe("1:02:03");
    expect(splitText("a".repeat(25001)).map((s) => s.length)).toEqual([
      12000, 12000, 1001,
    ]);
  });
});
describe("视频网址校验", () => {
  it.each([
    "https://www.bilibili.com/video/BV1xx",
    "https://b23.tv/abc",
    "https://v.douyin.com/abc",
    "https://youtu.be/abc",
  ])("接受已支持平台 %s", (url) => expect(validateVideoUrl(url).url).toBe(url));
  it.each([
    "http://www.bilibili.com/a",
    "https://bilibili.com.evil.test/a",
    "https://bilibili.com@127.0.0.1/a",
    "https://127.0.0.1/",
    "file:///etc/passwd",
    "https://youtube.com:8080/a",
  ])("拒绝不安全或伪造域名 %s", (url) =>
    expect(() => validateVideoUrl(url)).toThrow(),
  );
});

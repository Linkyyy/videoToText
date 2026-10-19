import { assertSameOrigin, readJson, ApiError, errorResponse } from "@/lib/server";
import { MAX_TRANSCRIPT_CHARS } from "@/lib/transcript";
import { summarize } from "@/lib/deepseek";
import type { SummaryLength, SummaryStyle } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request);
    const { text, style = "analysis", length = "normal" } = body;
    if (typeof text !== "string" || !text.trim())
      throw new ApiError("请先提取或导入字幕。");
    // Timestamp annotations add a little overhead; raw imported text is limited to 60k.
    if (text.length > MAX_TRANSCRIPT_CHARS + 20_000)
      throw new ApiError("字幕内容过长，请按章节分别总结。");
    if (
      !["analysis", "study", "meeting"].includes(style as string) ||
      !["short", "normal", "long"].includes(length as string)
    )
      throw new ApiError("总结选项无效。");
    if (!process.env.DEEPSEEK_API_KEY)
      throw new ApiError(
        "尚未配置 DeepSeek API 密钥。你可以先提取、编辑或导出字幕。",
        503,
      );
    const abort = new AbortController();
    const signal = AbortSignal.any([
      request.signal,
      abort.signal,
      AbortSignal.timeout(285_000),
    ]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: Record<string, unknown>) => {
          if (!abort.signal.aborted)
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        try {
          await summarize(
            text,
            style as SummaryStyle,
            length as SummaryLength,
            signal,
            emit,
          );
        } catch (error) {
          emit({
            type: "error",
            message:
              error instanceof ApiError ? error.message : "总结中断，请重试。",
          });
        } finally {
          if (!abort.signal.aborted) controller.close();
        }
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

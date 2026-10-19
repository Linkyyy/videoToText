import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertSameOrigin,
  readJson,
  signTicket,
  verifyTicket,
} from "../src/lib/server";
import { POST } from "../src/app/api/summarize/route";
import { POST as createJob } from "../src/app/api/jobs/route";
import { GET as getJob } from "../src/app/api/jobs/[id]/route";
import { readDeepseekStream } from "../src/lib/deepseek";

const request = (body: unknown, headers = {}) =>
  new Request("http://localhost:3000/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DEEPSEEK_API_KEY", "");
  vi.stubEnv("WORKER_URL", "");
  vi.stubEnv("WORKER_API_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("凭证、请求边界", () => {
  it("任务凭证不可篡改、错用或过期", () => {
    const secret = "a".repeat(32);
    const token = signTicket(
      { kind: "job", id: "job-one", exp: Date.now() / 1000 + 60 },
      secret,
    );
    expect(verifyTicket(token, secret, "job").id).toBe("job-one");
    expect(() => verifyTicket(token + "x", secret, "job")).toThrow();
    expect(() => verifyTicket(token, secret, "upload")).toThrow();
    expect(() =>
      verifyTicket(signTicket({ kind: "job", exp: 1 }, secret), secret, "job"),
    ).toThrow("过期");
  });
  it("生产环境允许无密码访问，仍拒绝跨站请求", () => {
    vi.stubEnv("VERCEL", "1");
    expect(() => assertSameOrigin(request({}))).not.toThrow();
    vi.stubEnv("APP_PASSWORD", "example-site-password");
    expect(() => assertSameOrigin(request({}))).not.toThrow();
    expect(() =>
      assertSameOrigin(
        request(
          {},
          { Origin: "https://untrusted.example", Host: "localhost:3000" },
        ),
      ),
    ).toThrow("跨站");
    expect(() =>
      assertSameOrigin(request({}, { "Sec-Fetch-Site": "cross-site" })),
    ).toThrow("跨站");
  });
  it("实际读取的 JSON 超限时拒绝，不依赖 Content-Length", async () => {
    await expect(readJson(request({ text: "abcde" }), 5)).rejects.toThrow(
      "过大",
    );
    await expect(readJson(request([1]))).rejects.toThrow("JSON");
  });
});

describe("真实路由与 DeepSeek 协议", () => {
  it("缺少 DeepSeek 配置时返回可诊断错误", async () => {
    const response = await POST(request({ text: "有效字幕" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("DeepSeek");
  });
  it("API 密钥只用于服务端请求，流式结果到达浏览器", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-provider-key");
    const upstream = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":"## 知识笔记\\n"}}]}\n\ndata: {"choices":[{"delta":{"content":"核心观点。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        ),
      );
    vi.stubGlobal("fetch", upstream);
    const response = await POST(
      request({ text: "[00:10] 核心论点。", style: "study", length: "short" }),
    );
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('"type":"done"');
    expect(body).toContain("核心观点");
    expect(body).not.toContain("test-provider-key");
    expect(upstream.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    expect(
      JSON.parse(upstream.mock.calls[0][1].body).messages[1].content,
    ).toContain("学习目标");
  });
  it("处理 DeepSeek 余额错误，不泄露上游响应或密钥", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-provider-key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("private provider details", { status: 402 }),
        ),
    );
    const body = await (await POST(request({ text: "字幕" }))).text();
    expect(body).toContain("余额不足");
    expect(body).not.toContain('"type":"done"');
    expect(body).not.toContain("private provider details");
  });
  it("超长素材先分段再合并，避免丢掉尾部内容", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-provider-key");
    const upstream = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      return body.stream
        ? new Response(
            'data: {"choices":[{"delta":{"content":"合并结果"}}]}\n\ndata: [DONE]\n',
          )
        : Response.json({
            choices: [
              { message: { content: "分段笔记" }, finish_reason: "stop" },
            ],
          });
    });
    vi.stubGlobal("fetch", upstream);
    const body = await (
      await POST(request({ text: "字".repeat(24000) + "尾部证据" }))
    ).text();
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(
      upstream.mock.calls.some((call) => call[1].body.includes("尾部证据")),
    ).toBe(true);
    expect(body).toContain('"type":"done"');
  });
  it("逐字节碎片与多字节字符不会破坏 SSE", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"中文"}}]}\n\ndata: [DONE]\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    });
    let output = "";
    for await (const s of readDeepseekStream(stream)) output += s;
    expect(output).toBe("中文");
  });
  it("不把断流的半份总结标记为成功", async () => {
    const body = new Response(
      'data: {"choices":[{"delta":{"content":"未完成"}}]}\n',
    ).body!;
    await expect(
      (async () => {
        for await (const _ of readDeepseekStream(body)) {
          /* drain */
        }
      })(),
    ).rejects.toThrow("中断");
  });
  it("不允许无凭证查询别人的任务", async () => {
    vi.stubEnv("WORKER_URL", "http://127.0.0.1:8000");
    vi.stubEnv("WORKER_API_TOKEN", "w".repeat(32));
    const response = await getJob(
      new Request("http://localhost/api/jobs/" + "a".repeat(32)),
      { params: Promise.resolve({ id: "a".repeat(32) }) },
    );
    expect(response.status).toBe(403);
  });
  it("不把不受支持的网址发送到 worker", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    expect(
      (await createJob(request({ url: "https://127.0.0.1/internal" }))).status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});

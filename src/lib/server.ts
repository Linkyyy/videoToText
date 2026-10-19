import { createHmac, timingSafeEqual } from "node:crypto";

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && new URL(origin).host !== host)
    throw new ApiError("不允许跨站请求。", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new ApiError("不允许跨站请求。", 403);
}

export async function readJson(
  request: Request,
  limit = 400_000,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError("请求格式必须为 JSON。", 415);
  if (Number(request.headers.get("content-length")) > limit)
    throw new ApiError("请求内容过大。", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("请求内容为空。");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApiError("请求内容过大。", 413);
      }
      parts.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("无法读取请求中的 JSON。");
  }
}

export function workerConfig() {
  const url = process.env.WORKER_URL?.replace(/\/$/, "");
  const token = process.env.WORKER_API_TOKEN;
  if (!url || !token || token.length < 32)
    throw new ApiError("尚未配置视频处理服务。你仍可导入字幕或文本。", 503);
  const u = new URL(url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && !process.env.VERCEL))
    throw new ApiError("视频处理服务必须使用 HTTPS。", 503);
  return { url, token };
}

export function signTicket(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}

export function verifyTicket(
  ticket: string,
  secret: string,
  kind: string,
): Record<string, unknown> {
  const [data, signature, extra] = ticket.split(".");
  if (!data || !signature || extra)
    throw new ApiError("任务凭证无效，请重新提交。", 403);
  const expected = createHmac("sha256", secret).update(data).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    throw new ApiError("任务凭证无效。", 403);
  let value;
  try {
    value = JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    throw new ApiError("任务凭证无效。", 403);
  }
  if (
    value.kind !== kind ||
    typeof value.exp !== "number" ||
    value.exp < Date.now() / 1000
  )
    throw new ApiError("任务凭证已过期，请重新提交。", 403);
  return value;
}

export function jobTicket(id: string, secret: string) {
  return signTicket(
    { kind: "job", id, exp: Math.floor(Date.now() / 1000) + 86400 },
    secret,
  );
}

export async function workerFetch(path: string, init?: RequestInit) {
  const { url, token } = workerConfig();
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("暂时无法连接视频处理服务，请稍后重试。", 502);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      typeof body?.detail === "string" ? body.detail : "视频处理服务请求失败。",
      response.status >= 500 ? 502 : response.status,
    );
  return body;
}

export function errorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof ApiError
          ? error.message
          : "服务暂时不可用，请稍后再试。",
    },
    { status: error instanceof ApiError ? error.status : 500 },
  );
}

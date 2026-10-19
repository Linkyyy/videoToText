import { randomUUID } from "node:crypto";
import {
  assertSameOrigin,
  readJson,
  ApiError,
  errorResponse,
  workerConfig,
  signTicket,
  jobTicket,
} from "@/lib/server";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { size } = await readJson(request, 4096);
    if (
      typeof size !== "number" ||
      !Number.isInteger(size) ||
      size <= 0 ||
      size > 200 * 1024 * 1024
    )
      throw new ApiError("音视频文件最大支持 200 MB。");
    const { url, token } = workerConfig();
    const id = randomUUID().replaceAll("-", "");
    return Response.json({
      url: `${url}/uploads`,
      token: signTicket(
        { kind: "upload", id, size, exp: Math.floor(Date.now() / 1000) + 900 },
        token,
      ),
      id,
      ticket: jobTicket(id, token),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

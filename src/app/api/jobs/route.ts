import {
  assertSameOrigin,
  readJson,
  workerConfig,
  workerFetch,
  jobTicket,
  errorResponse,
  ApiError,
} from "@/lib/server";
import { validateVideoUrl } from "@/lib/transcript";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request, 4096);
    if (typeof body.url !== "string") throw new ApiError("请填写视频链接。");
    let input;
    try {
      input = validateVideoUrl(body.url);
    } catch (e) {
      throw new ApiError((e as Error).message);
    }
    const job = await workerFetch("/jobs", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return Response.json({
      ...job,
      ticket: jobTicket(job.id, workerConfig().token),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

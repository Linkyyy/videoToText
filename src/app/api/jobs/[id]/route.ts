import {
  assertSameOrigin,
  ApiError,
  errorResponse,
  verifyTicket,
  workerConfig,
  workerFetch,
} from "@/lib/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(id)) throw new ApiError("任务编号无效。");
    const ticket = verifyTicket(
      request.headers.get("x-job-ticket") ?? "",
      workerConfig().token,
      "job",
    );
    if (ticket.id !== id) throw new ApiError("任务凭证与任务不匹配。", 403);
    const job = await workerFetch(`/jobs/${id}`);
    return Response.json(job, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

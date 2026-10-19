export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    {
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      worker: Boolean(
        process.env.WORKER_URL &&
        (process.env.WORKER_API_TOKEN?.length ?? 0) >= 32,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { JOBS, runJob, type JobName } from "@/lib/jobs";

/** For external schedulers (e.g. Render cron): POST /api/cron/<job> with "Authorization: Bearer $CRON_SECRET". */
export async function POST(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  if (!(job in JOBS)) return new Response("Unknown job", { status: 404 });
  const result = await runJob(job as JobName);
  return Response.json({ job, result });
}

import { planRoute } from "@/lib/campuspath/client";
import { campusError, withCampus } from "@/lib/campuspath/http";
import { isClassroomId } from "@/lib/campuspath/links";
import type { PlanRequest } from "@/lib/campuspath/types";

/** A choice from a list (a checkpoint number or a classroom id), or "auto" for the nearest entrance. */
function choice(value: unknown): number | string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 100_000) return value;
  if (isClassroomId(value) || value === "auto") return value;
  return null;
}

function text(value: unknown, longest: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" && value.length <= longest ? value : null;
}

/**
 * Plans a walk, in the app's language unless the body names one. Answers `{ route }`, or
 * `{ question }` (`field`, `message`, `options`, `needsChoice`) when the service needs a choice
 * (its HTTP 422). Both with status 200: a question is a normal answer, not a failed request.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  return withCampus(typeof body?.lang === "string" ? body.lang : null, async ({ t, lang }) => {
    if (!body || typeof body !== "object") return campusError(400, t.campus.api.badRequest);
    const prompt = text(body.prompt, 1000);
    const from = text(body.from, 200);
    const hint = text(body.hint, 300);
    const start = choice(body.start);
    const destination = choice(body.destination);
    if ([prompt, from, hint, start, destination].includes(null)) return campusError(400, t.campus.api.badRequest);
    const req: PlanRequest & { hint?: string } = { prompt: prompt ?? "", lang };
    if (from?.trim()) req.from = from.trim();
    if (start !== undefined && start !== null) req.start = start;
    if (destination !== undefined && destination !== null) req.destination = destination;
    if (hint?.trim()) req.hint = hint.trim();
    const outcome = await planRoute(req);
    return Response.json(outcome.kind === "question" ? { question: outcome.question } : { route: outcome.route });
  });
}

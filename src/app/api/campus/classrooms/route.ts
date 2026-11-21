import { listClassrooms } from "@/lib/campuspath/client";
import { campusError, withCampus } from "@/lib/campuspath/http";
import type { Coverage } from "@/lib/campuspath/types";

const COVERAGE: Coverage[] = ["exact", "checkpoint", "unmapped"];

/** The classroom directory: `q`, `coverage`, `offset`, `limit` (at most 100). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return withCampus(params.get("lang"), async ({ t, lang }) => {
    const coverage = params.get("coverage") || undefined;
    if (coverage && !COVERAGE.includes(coverage as Coverage)) return campusError(400, t.campus.api.badRequest);
    const offset = Math.max(0, Math.floor(Number(params.get("offset") ?? 0)) || 0);
    const limit = Math.min(100, Math.max(1, Math.floor(Number(params.get("limit") ?? 20)) || 20));
    const page = await listClassrooms({ q: params.get("q") ?? "", coverage: coverage as Coverage | undefined, offset, limit, lang });
    return Response.json(page);
  });
}

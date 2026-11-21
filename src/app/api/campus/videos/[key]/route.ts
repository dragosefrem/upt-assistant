import { videoStatus } from "@/lib/campuspath/client";
import { campusError, withCampus } from "@/lib/campuspath/http";
import { isVideoKey } from "@/lib/campuspath/links";

/** The render state of a walkthrough: queued, rendering (with progress), ready or error. */
export async function GET(_request: Request, ctx: RouteContext<"/api/campus/videos/[key]">) {
  const { key } = await ctx.params;
  return withCampus(null, async ({ t }) => {
    if (!isVideoKey(key)) return campusError(404, t.campus.api.notFound);
    const state = await videoStatus(key);
    if (!state) return campusError(404, t.campus.api.notFound);
    return Response.json(state, { headers: { "Cache-Control": "no-store" } });
  });
}

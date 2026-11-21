import { mediaFile } from "@/lib/campuspath/client";
import { campusError, withCampus } from "@/lib/campuspath/http";
import { parseMediaName } from "@/lib/campuspath/links";

/**
 * A walkthrough's MP4 or cover JPG, streamed from the service. `Range` requests are passed on,
 * so the video can seek (206 with `Content-Range`). Only `<24 hex>.mp4|jpg` names are accepted.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/campus/media/[file]">) {
  const { file } = await ctx.params;
  return withCampus(null, async ({ t }) => {
    const media = parseMediaName(file);
    if (!media) return campusError(404, t.campus.api.notFound);
    return mediaFile(media.key, media.kind, request.headers);
  });
}

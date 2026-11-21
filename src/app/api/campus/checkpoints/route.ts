import { buildingPins, searchCheckpoints } from "@/lib/campuspath/client";
import { withCampus } from "@/lib/campuspath/http";

/** Starting points: `q` (name, `#389` or a tour link), `rooms=1` to include classrooms, or `pins=1` for building pins. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return withCampus(params.get("lang"), async ({ lang }) => {
    if (params.get("pins") === "1") {
      return Response.json(await buildingPins(lang), { headers: { "Cache-Control": "private, max-age=3600" } });
    }
    return Response.json(await searchCheckpoints({ q: params.get("q") ?? "", rooms: params.get("rooms") === "1", lang }));
  });
}

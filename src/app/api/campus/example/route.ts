import { exampleRoute } from "@/lib/campuspath/client";
import { withCampus } from "@/lib/campuspath/http";

/** The bundled example walkthrough (AC entrance → B419), ready at once. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return withCampus(params.get("lang"), async ({ lang }) => Response.json(await exampleRoute(lang)));
}

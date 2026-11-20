import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { exportItems, toICS } from "@/lib/export";

/**
 * The student's timetable as an iCalendar feed. The secret token in the URL is the
 * only credential, so calendar apps (Google "From URL", Apple, Outlook) can subscribe.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/ics/[token]">) {
  const { token } = await ctx.params;
  const user = getDb().select().from(users).where(eq(users.feedToken, token.replace(/\.ics$/, ""))).get();
  if (!user) return new Response("Not found", { status: 404 });
  const download = new URL(request.url).searchParams.has("download");
  return new Response(toICS(exportItems(user)), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=900",
      ...(download ? { "content-disposition": 'attachment; filename="upt-orar.ics"' } : {}),
    },
  });
}

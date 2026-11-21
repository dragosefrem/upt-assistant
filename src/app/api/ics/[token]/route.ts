import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { getT } from "@/i18n/server";
import { exportItems, toICS } from "@/lib/export";

/**
 * The student's timetable as an iCalendar feed. The secret token in the URL is the
 * only credential, so calendar apps (Google "From URL", Apple, Outlook) can subscribe.
 * Those apps send no language of their own, so the feed uses the account's language.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/ics/[token]">) {
  const { token } = await ctx.params;
  const user = getDb().select().from(users).where(eq(users.feedToken, token.replace(/\.ics$/, ""))).get();
  if (!user) return new Response((await getT()).settings.export.errors.notFound, { status: 404 });
  const download = new URL(request.url).searchParams.has("download");
  return new Response(toICS(exportItems(user, user.locale ?? DEFAULT_LOCALE)), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, no-store",
      ...(download ? { "content-disposition": 'attachment; filename="poli.ics"' } : {}),
    },
  });
}

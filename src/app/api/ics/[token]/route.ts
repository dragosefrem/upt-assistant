import { getT } from "@/i18n/server";
import { subscriptionCalendar } from "@/lib/export";

/**
 * The student's timetable as an iCalendar feed. The secret token in the URL is the
 * only credential, so calendar apps (Google "From URL", Apple, Outlook) can subscribe.
 * Those apps send no language of their own, so the feed uses the account's language.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/ics/[token]">) {
  const { token } = await ctx.params;
  const calendar = subscriptionCalendar(token.replace(/\.ics$/, ""));
  if (calendar === null) return new Response((await getT()).settings.export.errors.notFound, { status: 404 });
  const download = new URL(request.url).searchParams.has("download");
  return new Response(calendar, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, no-store",
      ...(download ? { "content-disposition": 'attachment; filename="poli.ics"' } : {}),
    },
  });
}

import { NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE, pickLocale, type Locale } from "@/i18n/config";
import { contacts } from "@/i18n/messages/contacts";
import { publicEvent } from "@/lib/group-events";
import { guestCookie } from "../../guest-cookie";

/** The visitor's language from this request alone (also works where no request scope exists, as in tests). */
function requestLocale(request: Request): Locale {
  const chosen = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`))?.[1];
  return isLocale(chosen) ? chosen : pickLocale(request.headers.get("accept-language"));
}

/** Restore only this guest's RSVP, then return to the ordinary shareable URL. */
export async function GET(request: Request, context: RouteContext<"/join/[token]/manage/[key]">) {
  const { token, key } = await context.params;
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  if (!/^[A-Za-z0-9_-]{43}$/.test(key) || !publicEvent(token, undefined, key)?.response) {
    return new Response(contacts[requestLocale(request)].guest.linkUnavailable, {
      status: 404, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const response = new NextResponse(null, { status: 303, headers: { ...headers, Location: `/join/${token}` } });
  response.cookies.set(guestCookie(token, key));
  return response;
}

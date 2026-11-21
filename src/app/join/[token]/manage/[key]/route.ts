import { NextResponse } from "next/server";
import { publicEvent } from "@/lib/group-events";
import { guestCookie } from "../../guest-cookie";

/** Restore only this guest's RSVP, then return to the ordinary shareable URL. */
export async function GET(_request: Request, context: RouteContext<"/join/[token]/manage/[key]">) {
  const { token, key } = await context.params;
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  if (!/^[A-Za-z0-9_-]{43}$/.test(key) || !publicEvent(token, undefined, key)?.response) {
    return new Response("This private RSVP link is unavailable.", { status: 404, headers });
  }
  const response = new NextResponse(null, { status: 303, headers: { ...headers, Location: `/join/${token}` } });
  response.cookies.set(guestCookie(token, key));
  return response;
}

import { NextResponse, type NextRequest } from "next/server";

/**
 * The home address serves two audiences: signed-in students get their calendar, and
 * everyone else the public welcome page. Only the presence of the session cookie is
 * checked here; the pages themselves verify it.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("upt_session")) return NextResponse.next();
  return NextResponse.rewrite(new URL("/welcome", request.url));
}

export const config = { matcher: "/" };

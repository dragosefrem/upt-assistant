import "server-only";
import { isLocale, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { getUser, type User } from "@/lib/auth";
import { CampuspathError } from "./client";
import { CampuspathUnavailable } from "./service";

/**
 * Shared frame of the /api/campus/… route handlers: signed-in users only, the language for the
 * service, and translated errors when the service is down or refuses a request.
 */
export interface CampusContext {
  user: User;
  t: Messages;
  /** The language for the service: the request's own choice, else the app's. */
  lang: Locale;
}

export function campusError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function withCampus(
  requested: string | null | undefined,
  handler: (ctx: CampusContext) => Promise<Response>,
): Promise<Response> {
  const t = await getT();
  const user = await getUser();
  if (!user) return campusError(401, t.common.status.notSignedIn);
  const lang = isLocale(requested) ? requested : await getLocale();
  try {
    return await handler({ user, t, lang });
  } catch (error) {
    if (error instanceof CampuspathUnavailable) return campusError(503, t.campus.api.unavailable, { unavailable: true });
    if (error instanceof CampuspathError) {
      // The service's own texts are English and meant for developers.
      return campusError(error.status >= 500 ? 502 : error.status, error.status === 404 ? t.campus.api.notFound : t.campus.api.failed);
    }
    console.error("[campuspath] request failed", error);
    return campusError(502, t.campus.api.failed);
  }
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getLocale } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { appUrl, connectGoogle, exchangeCode, syncToGoogle } from "@/lib/google";

/** Google redirects here after consent; store the grant and run the first sync. */
export async function GET(request: Request) {
  const base = appUrl(request);
  const back = (result: string) => NextResponse.redirect(`${base}/timetable-settings?google=${result}#export`);
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${base}/login`);

  const url = new URL(request.url);
  const jar = await cookies();
  const expected = jar.get("upt_google_state")?.value;
  jar.delete("upt_google_state");
  // The state cookie ties the callback to the browser that started the flow.
  if (!expected || url.searchParams.get("state") !== expected) return back("failed");
  const code = url.searchParams.get("code");
  if (!code) return back(url.searchParams.get("error") === "access_denied" ? "denied" : "failed");

  try {
    const refreshToken = await exchangeCode(code, request);
    connectGoogle(user.id, refreshToken);
    await syncToGoogle(user, user.locale ?? (await getLocale()));
    return back("synced");
  } catch (err) {
    console.error("Google Calendar connect failed", err);
    return back("failed");
  }
}

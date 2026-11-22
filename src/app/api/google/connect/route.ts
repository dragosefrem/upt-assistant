import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { appUrl, consentUrl, googleConfigured } from "@/lib/google";

/** Starts the Google consent flow. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(`${appUrl(request)}/login`);
  if (!googleConfigured()) return NextResponse.redirect(`${appUrl(request)}/timetable-settings?google=unconfigured#export`);
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("upt_google_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return NextResponse.redirect(consentUrl(state, request));
}

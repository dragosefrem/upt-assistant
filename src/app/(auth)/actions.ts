"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { LOCALE_COOKIE } from "@/i18n/config";
import { getLocale, getT } from "@/i18n/server";
import { createUser, endSession, normalizeEmail, startSession, verifyPassword } from "@/lib/auth";
import { requestPasswordReset, resetPassword } from "@/lib/password-reset";

export interface AuthState {
  error?: string;
  /** A neutral or good-news message (for example "the link is on its way"). */
  notice?: string;
  email?: string;
  name?: string;
}

function destination(form: FormData, fallback: string) {
  const invite = form.get("invite");
  return typeof invite === "string" && /^[A-Za-z0-9_-]{32}$/.test(invite) ? `/join/${invite}` : fallback;
}

export async function loginAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = (await getT()).auth;
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  const user = getDb().select().from(users).where(eq(users.email, email)).get();
  // One message for both cases, so the form does not reveal which addresses exist.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: t.login.wrong, email };
  }
  await startSession(user.id);
  // The account remembers its language, so it follows the student to a new device.
  if (user.locale) (await cookies()).set(LOCALE_COOKIE, user.locale, { path: "/", maxAge: 365 * 86_400, sameSite: "lax" });
  redirect(destination(form, user.onboardedAt ? "/" : "/onboarding"));
}

export async function registerAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = (await getT()).auth.register;
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const name = String(form.get("name") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const keep = { email, name };
  if (name.length < 2) return { ...keep, error: t.needName };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ...keep, error: t.badEmail };
  if (password.length < 8) return { ...keep, error: t.shortPassword };
  if (getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    return { ...keep, error: t.exists };
  }
  const user = createUser({ email, name, password, locale: await getLocale() });
  await startSession(user.id);
  redirect(destination(form, "/onboarding"));
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}

/** The app's own address, for links in e-mails: APP_URL when set, else where this request came in. */
async function baseUrl(): Promise<string> {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
}

/** "Forgot your password?": always answers the same way for known and unknown addresses. */
export async function forgotPasswordAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = (await getT()).auth;
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { email, error: t.register.badEmail };
  const result = await requestPasswordReset(email, await baseUrl(), await getLocale());
  if (result === "not-configured") return { email, error: t.forgot.notConfigured };
  if (result === "too-many") return { email, error: t.forgot.tooMany };
  if (result === "failed") return { email, error: t.forgot.failed };
  return { notice: t.forgot.sent };
}

export async function resetPasswordAction(token: string, _prev: AuthState, form: FormData): Promise<AuthState> {
  const t = (await getT()).auth;
  const password = String(form.get("password") ?? "");
  const repeat = String(form.get("repeat") ?? "");
  if (password.length < 8) return { error: t.register.shortPassword };
  if (password !== repeat) return { error: t.reset.mismatch };
  if (!resetPassword(token, password)) return { error: t.reset.invalid };
  redirect("/login?reset=done");
}

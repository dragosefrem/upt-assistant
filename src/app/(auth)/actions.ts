"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { LOCALE_COOKIE } from "@/i18n/config";
import { getLocale, getT } from "@/i18n/server";
import { authenticate, createUser, endSession, isEmail, loginClientAddress, normalizeEmail, registrationName, startSession } from "@/lib/auth";
import { requestPasswordReset, resetBaseUrl, resetPassword } from "@/lib/password-reset";

export interface AuthState {
  error?: string;
  field?: "name" | "email" | "password" | "repeat";
  signInLink?: boolean;
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
  if (!isEmail(email)) return { error: t.register.badEmail, field: "email", email };
  if (!password) return { error: t.login.needPassword, field: "password", email };
  const result = authenticate(email, password, loginClientAddress(await headers()));
  if (result.status === "limited") return { error: t.login.tooMany(result.minutes), email };
  if (result.status === "invalid") return { error: t.login.wrong, field: "password", email };
  const { user } = result;
  await startSession(user.id);
  // The account remembers its language, so it follows the student to a new device.
  if (user.locale) (await cookies()).set(LOCALE_COOKIE, user.locale, { path: "/", maxAge: 365 * 86_400, sameSite: "lax" });
  redirect(destination(form, user.onboardedAt ? "/" : "/onboarding"));
}

export async function registerAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = (await getT()).auth.register;
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const { name, error } = registrationName(String(form.get("name") ?? ""));
  const password = String(form.get("password") ?? "");
  const keep = { email, name };
  if (error) return { ...keep, error: t[error], field: "name" };
  if (!isEmail(email)) return { ...keep, error: t.badEmail, field: "email" };
  if (password.length < 8) return { ...keep, error: t.shortPassword, field: "password" };
  const locale = await getLocale();
  if (getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    return { ...keep, error: t.exists, field: "email", signInLink: true };
  }
  const user = createUser({ email, name, password, locale });
  await startSession(user.id);
  redirect(destination(form, "/onboarding"));
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}

/** "Forgot your password?": always answers the same way for known and unknown addresses. */
export async function forgotPasswordAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const t = (await getT()).auth;
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!isEmail(email)) return { email, error: t.register.badEmail, field: "email" };
  const result = requestPasswordReset(email, resetBaseUrl(await headers()), await getLocale(), after);
  if (result === "not-configured") return { email, error: t.forgot.notConfigured };
  return { notice: t.forgot.sent };
}

export async function resetPasswordAction(token: string, _prev: AuthState, form: FormData): Promise<AuthState> {
  const t = (await getT()).auth;
  const password = String(form.get("password") ?? "");
  const repeat = String(form.get("repeat") ?? "");
  if (password.length < 8) return { error: t.register.shortPassword, field: "password" };
  if (password !== repeat) return { error: t.reset.mismatch, field: "repeat" };
  if (!resetPassword(token, password)) return { error: t.reset.invalid };
  redirect("/login?reset=done");
}

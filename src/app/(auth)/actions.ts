"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { LOCALE_COOKIE } from "@/i18n/config";
import type { auth } from "@/i18n/messages/auth";
import { getLocale } from "@/i18n/server";
import { authenticate, createUser, endSession, hasEmailFormat, loginClientAddress, normalizeEmail, registrationName, startSession } from "@/lib/auth";
import { requestPasswordReset, resetBaseUrl, resetPassword } from "@/lib/password-reset";

export interface AuthState {
  error?: keyof typeof auth.en.errors;
  retryMinutes?: number;
  field?: "name" | "email" | "password" | "repeat";
  sent?: boolean;
  email?: string;
  name?: string;
}

function destination(form: FormData, fallback: string) {
  const invite = form.get("invite");
  return typeof invite === "string" && /^[A-Za-z0-9_-]{32}$/.test(invite) ? `/join/${invite}` : fallback;
}

export async function loginAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  if (!hasEmailFormat(email)) return { error: "badEmail", field: "email", email };
  if (!password) return { error: "needPassword", field: "password", email };
  const result = authenticate(email, password, loginClientAddress(await headers()));
  if (result.status === "limited") return { error: "tooMany", retryMinutes: result.minutes, email };
  if (result.status === "invalid") return { error: "wrong", field: "password", email };
  const { user } = result;
  await startSession(user.id);
  // The account remembers its language, so it follows the student to a new device.
  if (user.locale) (await cookies()).set(LOCALE_COOKIE, user.locale, { path: "/", maxAge: 365 * 86_400, sameSite: "lax" });
  redirect(destination(form, user.onboardedAt ? "/" : "/onboarding"));
}

export async function registerAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const { name, error } = registrationName(String(form.get("name") ?? ""));
  const password = String(form.get("password") ?? "");
  const keep = { email, name };
  if (error) return { ...keep, error, field: "name" };
  if (!hasEmailFormat(email)) return { ...keep, error: "badEmail", field: "email" };
  if (password.length < 8) return { ...keep, error: "shortPassword", field: "password" };
  const locale = await getLocale();
  if (getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    return { ...keep, error: "exists", field: "email" };
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
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!hasEmailFormat(email)) return { email, error: "badEmail", field: "email" };
  const result = requestPasswordReset(email, resetBaseUrl(await headers()), await getLocale(), after);
  if (result === "not-configured") return { email, error: "notConfigured" };
  return { sent: true };
}

export async function resetPasswordAction(token: string, _prev: AuthState, form: FormData): Promise<AuthState> {
  const password = String(form.get("password") ?? "");
  const repeat = String(form.get("repeat") ?? "");
  if (password.length < 8) return { error: "shortPassword", field: "password" };
  if (password !== repeat) return { error: "mismatch", field: "repeat" };
  if (!resetPassword(token, password)) return { error: "invalid" };
  redirect("/login?reset=done");
}

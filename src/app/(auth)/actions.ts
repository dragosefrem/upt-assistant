"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { LOCALE_COOKIE } from "@/i18n/config";
import type { auth } from "@/i18n/messages/auth";
import { getLocale } from "@/i18n/server";
import { completeRegistration, requestRegistrationLink } from "@/lib/account-verification";
import { authenticate, endSession, hasEmailFormat, loginClientAddress, normalizeEmail, registrationName, startSession } from "@/lib/auth";
import { accountEmailBaseUrl } from "@/lib/mail";
import { requestPasswordReset, resetPassword } from "@/lib/password-reset";

export interface AuthState {
  error?: keyof typeof auth.en.errors;
  retryMinutes?: number;
  field?: "name" | "email" | "password" | "repeat";
  sent?: boolean;
  email?: string;
  name?: string;
}

function inviteCode(form: FormData) {
  const invite = form.get("invite");
  return typeof invite === "string" && /^[A-Za-z0-9_-]{32}$/.test(invite) ? invite : null;
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
  const invite = inviteCode(form);
  redirect(invite ? `/join/${invite}` : user.onboardedAt ? "/" : "/onboarding");
}

export async function registerAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const incoming = await headers();
  const result = await requestRegistrationLink({
    email, baseUrl: accountEmailBaseUrl(incoming), invite: inviteCode(form),
    locale: await getLocale(), client: loginClientAddress(incoming),
  });
  if (result === "sent") return { email, sent: true };
  return { email, error: result, field: result === "badEmail" || result === "exists" ? "email" : undefined };
}

export async function completeRegistrationAction(token: string, _prev: AuthState, form: FormData): Promise<AuthState> {
  const { name, error } = registrationName(String(form.get("name") ?? ""));
  const password = String(form.get("password") ?? "");
  if (error) return { name, error, field: "name" };
  if (password.length < 8) return { name, error: "shortPassword", field: "password" };
  const registration = completeRegistration(token, { name, password, locale: await getLocale() });
  if (!registration) return { name, error: "invalidVerification" };
  await startSession(registration.user.id);
  redirect(registration.invite ? `/join/${registration.invite}` : "/onboarding");
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}

/** "Forgot your password?": always answers the same way for known and unknown addresses. */
export async function forgotPasswordAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  if (!hasEmailFormat(email)) return { email, error: "badEmail", field: "email" };
  const result = requestPasswordReset(email, accountEmailBaseUrl(await headers()), await getLocale(), after);
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

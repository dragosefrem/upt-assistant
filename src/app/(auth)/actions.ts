"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createUser, endSession, normalizeEmail, startSession, verifyPassword } from "@/lib/auth";

export interface AuthState {
  error?: string;
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
  const user = getDb().select().from(users).where(eq(users.email, email)).get();
  // One message for both cases, so the form does not reveal which addresses exist.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: "Wrong e-mail or password.", email };
  }
  await startSession(user.id);
  redirect(destination(form, user.onboardedAt ? "/" : "/onboarding"));
}

export async function registerAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const name = String(form.get("name") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const keep = { email, name };
  if (name.length < 2) return { ...keep, error: "Please enter your name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ...keep, error: "Please enter a valid e-mail address." };
  if (password.length < 8) return { ...keep, error: "Choose a password of at least 8 characters." };
  if (getDb().select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    return { ...keep, error: "An account with this e-mail already exists. Sign in instead." };
  }
  const user = createUser({ email, name, password });
  await startSession(user.id);
  redirect(destination(form, "/onboarding"));
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

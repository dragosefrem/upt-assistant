"use server";

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { getUser } from "@/lib/auth";

/** Switches the interface language: remembered in a cookie and, when signed in, on the account. */
export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 86_400, sameSite: "lax" });
  const user = await getUser();
  if (user && user.locale !== locale) getDb().update(users).set({ locale }).where(eq(users.id, user.id)).run();
}

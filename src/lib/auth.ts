import "server-only";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";

const COOKIE = "upt_session";
const SESSION_DAYS = 30;

export type User = typeof users.$inferSelect;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Creates an account. The very first account, and any address listed in ADMIN_EMAILS,
 * becomes an administrator; everyone else is a student.
 */
export function createUser(input: { email: string; name: string; password: string; locale?: "ro" | "en" }): User {
  const db = getDb();
  const email = normalizeEmail(input.email);
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean);
  const [{ n }] = db.select({ n: count() }).from(users).all();
  return db
    .insert(users)
    .values({
      id: randomUUID(),
      email,
      name: input.name.trim(),
      passwordHash: hashPassword(input.password),
      role: n === 0 || admins.includes(email) ? "admin" : "student",
      feedToken: randomBytes(24).toString("base64url"),
      locale: input.locale ?? null,
    })
    .returning()
    .get();
}

export async function startSession(userId: string) {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run();
  db.insert(sessions).values({ id: sha256(token), userId, expiresAt: expires.toISOString() }).run();
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) getDb().delete(sessions).where(eq(sessions.id, sha256(token))).run();
  jar.delete(COOKIE);
}

/** The signed-in user for this request, or null. Deduplicated per render. */
export const getUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const row = getDb()
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date().toISOString())))
    .get();
  return row?.user ?? null;
});

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/** A signed-in student who has finished choosing faculty, year and group. */
export async function requireOnboardedUser(): Promise<User> {
  const user = await requireUser();
  if (!user.onboardedAt) redirect("/onboarding");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

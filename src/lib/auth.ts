import "server-only";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";

const COOKIE = "upt_session";
const SESSION_DAYS = 30;

export type User = typeof users.$inferSelect;

const DUMMY_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const valid = /^scrypt\$[\da-f]{32}\$[\da-f]{128}$/i.test(stored);
  const [, saltHex, hashHex] = (valid ? stored : DUMMY_HASH).split("$");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual) && valid;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hasEmailFormat(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function registrationName(raw: string) {
  const name = raw.normalize("NFC").replace(/\p{Cf}/gu, "").replace(/[\s\p{Cc}]+/gu, " ").trim();
  const length = Array.from(name).length;
  const error = length < 2 ? "needName" : length > 80 ? "longName" : null;
  return { name, error } as const;
}

export function newFeedToken() {
  return randomBytes(24).toString("base64url");
}

/** Invalidate every subscription URL previously issued for this account. */
export function rotateCalendarFeed(userId: string) {
  getDb().update(users).set({ feedToken: newFeedToken() }).where(eq(users.id, userId)).run();
}

/** Railway sets X-Real-IP at ingress. Other trusted proxies can explicitly name the header they overwrite. */
export function loginClientAddress(headers: Pick<Headers, "get">) {
  const header = process.env.TRUSTED_CLIENT_IP_HEADER || (process.env.RAILWAY_ENVIRONMENT_ID && "x-real-ip")
    || (process.env.NODE_ENV === "development" && "x-forwarded-for");
  const address = header && headers.get(header)?.split(",").at(-1)?.trim();
  return address && isIP(address) ? address : "unidentified";
}

// Single-process limits reset on restart. Several replicas would need a shared store.
type FailureWindow = { count: number; until: number };
const authProcess = globalThis as typeof globalThis & { __uptLoginFailures?: Map<string, FailureWindow> };
const failures = authProcess.__uptLoginFailures ??= new Map<string, FailureWindow>();
const WINDOW_MS = 15 * 60_000;
const EMAIL_LIMIT = 5;
const CLIENT_LIMIT = 30;

export function authenticate(email: string, password: string, client: string) {
  const now = Date.now();
  // Fixed windows expire in insertion order.
  for (const [key, entry] of failures) {
    if (entry.until > now) break;
    failures.delete(key);
  }
  const address = normalizeEmail(email);
  const emailKey = `email:${sha256(address)}`;
  const keys = [[emailKey, EMAIL_LIMIT], [`client:${client}`, CLIENT_LIMIT]] as const;
  let until = 0;
  for (const [key, limit] of keys) {
    const entry = failures.get(key);
    if (entry && entry.count >= limit) until = Math.max(until, entry.until);
  }
  if (until) return { status: "limited", minutes: Math.ceil((until - now) / 60_000) } as const;

  const user = getDb().select().from(users).where(eq(users.email, address)).get();
  const matches = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (matches && user) {
    failures.delete(emailKey);
    return { status: "signed-in", user } as const;
  }
  for (const [key] of keys) {
    const entry = failures.get(key) ?? { count: 0, until: now + WINDOW_MS };
    entry.count++;
    failures.set(key, entry);
  }
  return { status: "invalid" } as const;
}

/**
 * Creates an account. The very first account, and any address listed in ADMIN_EMAILS,
 * becomes an administrator; everyone else is a student.
 */
export function createUser(input: { email: string; name: string; password: string; locale?: "ro" | "en" }): User {
  const db = getDb();
  const email = normalizeEmail(input.email);
  const { name, error } = registrationName(input.name);
  if (error) throw new RangeError("A registration name must contain 2 to 80 characters");
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean);
  const [{ n }] = db.select({ n: count() }).from(users).all();
  return db
    .insert(users)
    .values({
      id: randomUUID(),
      email,
      name,
      passwordHash: hashPassword(input.password),
      role: n === 0 || admins.includes(email) ? "admin" : "student",
      feedToken: newFeedToken(),
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

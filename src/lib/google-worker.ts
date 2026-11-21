import "server-only";
import { and, asc, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import { googleSyncState, users } from "@/db/schema";
import { GoogleError, syncToGoogle } from "./google";

/** Pick up a just-saved Poli edit on the next worker tick, while respecting error backoff. */
export function queueGoogleSync(userId: string) {
  getDb().update(googleSyncState).set({ nextAttempt: 0 })
    .where(and(eq(googleSyncState.userId, userId), eq(googleSyncState.failures, 0))).run();
}

/** Runs on the persistent Node server, including while every student's browser is closed. */
export async function syncDueCalendars() {
  const now = Date.now();
  const due = getDb().select({ id: users.id }).from(users).leftJoin(googleSyncState, eq(googleSyncState.userId, users.id))
    .where(and(isNotNull(users.googleRefreshToken), or(isNull(googleSyncState.userId),
      and(lte(googleSyncState.nextAttempt, now), lte(googleSyncState.leaseUntil, now)))))
    .orderBy(asc(googleSyncState.nextAttempt)).limit(8).all();
  await Promise.all(due.map(async user => {
    try { await syncToGoogle(user); }
    catch (error) { console.warn("Google Calendar sync will retry", error instanceof GoogleError ? error.status : "network or storage"); }
  }));
  return due.length;
}

export function startGoogleCalendarWorker() {
  const runtime = globalThis as typeof globalThis & { poliGoogleWorker?: NodeJS.Timeout };
  if (runtime.poliGoogleWorker) return;
  const tick = async () => {
    let delay = 10_000;
    try { if (await syncDueCalendars() === 8) delay = 500; }
    catch { console.warn("Google Calendar worker could not read its queue"); }
    finally { runtime.poliGoogleWorker = setTimeout(tick, delay); runtime.poliGoogleWorker.unref(); }
  };
  runtime.poliGoogleWorker = setTimeout(tick, 2_000);
  runtime.poliGoogleWorker.unref();
}

import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { settings } from "@/db/schema";

/** Small key/value store for app-level state (assistant ids, sync markers). */
export function getSetting(key: string): string | null {
  return getDb().select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  const db = getDb();
  if (value === null) db.delete(settings).where(eq(settings.key, key)).run();
  else db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

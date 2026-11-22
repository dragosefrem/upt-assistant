import "server-only";
import { getDb } from "@/db";
import { uptEventOccurrences } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/settings";
import { fetchUptEventOccurrences } from "./upt-events";

const nextRun = "upt-events:next-run";
const minute = 60_000;
const interval = 30 * minute;
const retry = 5 * minute;

/** The SQLite lease survives restarts and prevents a slower worker overwriting a newer refresh. */
export async function refreshUptEventsIfDue() {
  const db = getDb();
  const now = Date.now();
  const lease = String(now + retry);
  const acquired = db.transaction(() => {
    if (Number(getSetting(nextRun)) > now) return false;
    setSetting(nextRun, lease);
    return true;
  }, { behavior: "immediate" });
  if (!acquired) return;

  const rows = await fetchUptEventOccurrences();
  db.transaction((tx) => {
    if (getSetting(nextRun) !== lease) return;
    tx.delete(uptEventOccurrences).run();
    for (let i = 0; i < rows.length; i += 60) tx.insert(uptEventOccurrences).values(rows.slice(i, i + 60)).run();
    setSetting(nextRun, String(Date.now() + interval));
  }, { behavior: "immediate" });
}

const processState = globalThis as typeof globalThis & { __uptEventsTimer?: NodeJS.Timeout };

export function startUptEventSync() {
  if (processState.__uptEventsTimer) return;
  const tick = () => { void refreshUptEventsIfDue().catch((error) => console.error("UPT event calendar refresh failed", error)); };
  processState.__uptEventsTimer = setInterval(tick, minute);
  processState.__uptEventsTimer.unref();
  tick();
}

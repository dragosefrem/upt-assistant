import { z } from "zod";
import type { uptEventOccurrences } from "@/db/schema";
import { addDays, formatMinutes, localInstant, nowLocal } from "@/lib/time";
import { fetchUrl } from "./http";

const origin = "https://www.upt.ro";
// The public CMS serves several sites. Site 3 owns the list at www.upt.ro/evenimente.
const universitySite = "3";
const instant = z.iso.datetime({ offset: true });
const calendarPage = z.object({
  page: z.int().positive(),
  totalDocs: z.int().nonnegative(),
  hasNextPage: z.boolean(),
  docs: z.array(z.object({
    id: z.int().positive(),
    slug: z.string().trim().min(1),
    title: z.string().trim().min(1),
    location: z.object({ name: z.string().nullish(), address: z.string().nullish() }).nullish(),
    accessType: z.string().nullish(),
    dates: z.array(z.object({
      id: z.string().min(1),
      date: instant.nullish(),
      startTime: instant.nullish(),
      endTime: instant.nullish(),
    })).nullable(),
  })),
});

type Occurrence = typeof uptEventOccurrences.$inferInsert;

/** UPT stores each wall clock on its editing date. Read its Bucharest hour before pairing it with the event day. */
function occurrences(event: z.infer<typeof calendarPage>["docs"][number]): Occurrence[] {
  const sourceUrl = `${origin}/evenimente/${encodeURIComponent(event.slug)}`;
  const location = [...new Set([event.location?.name?.trim(), event.location?.address?.trim()].filter(Boolean))].join(" · ");
  const result: Occurrence[] = [];
  for (const slot of event.dates ?? []) {
    if (!slot.date || !slot.startTime || !slot.endTime) continue;
    const date = nowLocal(new Date(slot.date)).date;
    const startMin = nowLocal(new Date(slot.startTime)).minutes;
    const endClock = nowLocal(new Date(slot.endTime)).minutes;
    const endMin = endClock === 0 && startMin > 0 ? 1440 : endClock;
    // Independent clock fields do not establish a next-day finish.
    if (endMin <= startMin) continue;
    const endDate = endMin === 1440 ? addDays(date, 1) : date;
    if (localInstant(`${date}T${formatMinutes(startMin)}`) === null ||
        localInstant(`${endDate}T${formatMinutes(endClock)}`) === null) continue;
    result.push({ id: `${event.id}:${slot.id}`, title: event.title, date, startMin, endMin,
      sourceUrl, location: location || null, access: event.accessType?.trim() || null });
  }
  return result;
}

/** Read the published collection behind upt.ro/evenimente. Only a complete snapshot can replace the previous one. */
export async function fetchUptEventOccurrences(): Promise<Occurrence[]> {
  const url = new URL("/api/events", origin);
  url.search = new URLSearchParams({
    locale: "ro", depth: "0", limit: "100", sort: "id",
    "where[site][equals]": universitySite, "where[_status][equals]": "published",
  }).toString();
  for (const field of ["title", "slug", "dates", "location", "accessType"]) url.searchParams.set(`select[${field}]`, "true");
  const seen = new Set<number>();
  const slots = new Map<string, Occurrence>();
  for (let page = 1; ; page++) {
    url.searchParams.set("page", String(page));
    const response = await fetchUrl(url.href, { timeoutMs: 15_000, cache: "no-store" });
    const data = calendarPage.parse(JSON.parse(response.body.toString("utf8")));
    if (data.page !== page || (data.hasNextPage && !data.docs.length)) throw new Error("Unexpected UPT events page");
    for (const event of data.docs) {
      if (seen.has(event.id)) throw new Error("UPT events changed during pagination");
      seen.add(event.id);
      for (const slot of occurrences(event)) slots.set(slot.id, slot);
    }
    if (!data.hasNextPage) {
      if (seen.size !== data.totalDocs) throw new Error("Incomplete UPT events collection");
      return [...slots.values()];
    }
  }
}

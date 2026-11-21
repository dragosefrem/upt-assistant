"use server";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { sponsoredEvents } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { readSponsoredSlot, sponsoredReach } from "@/lib/sponsored-events";

const details = z.object({
  draftId: z.uuid(), title: z.string().trim().min(1).max(120), sponsor: z.string().trim().min(1).max(100),
  location: z.string().trim().max(200).default(""), description: z.string().trim().max(600).default(""),
});

export async function checkSponsoredAvailability(form: FormData) {
  await requireAdmin();
  const result = readSponsoredSlot(form);
  return "error" in result ? result : sponsoredReach(result.slot);
}

export async function publishSponsoredEvent(_previous: { error: "details" | "time" | "audience" } | null, form: FormData) {
  const admin = await requireAdmin();
  const event = details.safeParse(Object.fromEntries(form));
  if (!event.success) return { error: "details" as const };
  const result = readSponsoredSlot(form);
  if ("error" in result) return result;
  // Retrying the same form is idempotent. Editing a restored form can publish a different event.
  const { draftId, ...fields } = event.data;
  const id = createHash("sha256").update(JSON.stringify([admin.id, draftId, fields, result.slot])).digest("hex");
  getDb().insert(sponsoredEvents).values({ id, ...fields, ...result.slot, creatorId: admin.id })
    .onConflictDoNothing({ target: sponsoredEvents.id }).run();
  revalidatePath("/admin/sponsored-events");
  revalidatePath("/");
  redirect(`/admin/sponsored-events?published=${id}`);
}

export async function cancelSponsoredEvent(id: string) {
  await requireAdmin();
  getDb().update(sponsoredEvents).set({ cancelled: true }).where(eq(sponsoredEvents.id, id)).run();
  revalidatePath("/admin/sponsored-events");
  revalidatePath("/");
}

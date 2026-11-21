"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { FormResult } from "@/components/InvitationForm";
import { getLocale, getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";
import { invitationFailure } from "@/lib/contacts";
import { respondToEvent } from "@/lib/group-events";
import { GUEST_COOKIE, guestCookie } from "./guest-cookie";

export async function publicRsvp(token: string, firstGuestKey: string, _previous: FormResult, form: FormData): Promise<FormResult> {
  const user = await getUser();
  const jar = await cookies();
  const previousKey = jar.get(GUEST_COOKIE)?.value;
  const key = previousKey ?? firstGuestKey;
  const response = form.get("response");
  if (response !== "accepted" && response !== "declined") return { error: (await getT()).contacts.errors.chooseResponse };
  if (!user && !/^[A-Za-z0-9_-]{43}$/.test(key)) return { error: (await getT()).contacts.errors.reopen };
  try {
    respondToEvent({ shareToken: token }, user ? { userId: user.id, guestKey: previousKey }
      : { guestKey: key, name: String(form.get("name") ?? "") }, response);
  } catch (error) { return invitationFailure(error, await getLocale()); }
  if (!user && !previousKey) jar.set(guestCookie(token, key));
  revalidatePath(`/join/${token}`);
  revalidatePath("/contacts");
  revalidatePath("/");
  return {};
}

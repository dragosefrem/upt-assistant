"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormResult } from "@/components/InvitationForm";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { answerContact, cancelContactRequest, invitationFailure, inviteContactById, removeContact } from "@/lib/contacts";
import { respondToEvent } from "@/lib/group-events";
import { createGroupEvent } from "@/lib/group-planning";
import { matchGroups, removeSavedContact, saveContact, SavedContactError, SAVED_NAME_MAX, type GroupChoice } from "@/lib/saved-contacts";

export async function inviteAction(recipientId: string): Promise<FormResult> {
  const user = await requireOnboardedUser();
  try {
    inviteContactById(user.id, recipientId);
  } catch (error) { return invitationFailure(error, await getLocale()); }
  revalidatePath("/contacts");
  return {};
}

export async function contactAction(otherId: string, _previous: FormResult, form: FormData): Promise<FormResult> {
  const user = await requireOnboardedUser();
  switch (form.get("action")) {
    case "accept": answerContact(user.id, otherId, true); break;
    case "decline": answerContact(user.id, otherId, false); break;
    case "cancel": cancelContactRequest(user.id, otherId); break;
    case "remove": removeContact(user.id, otherId); break;
    default: return { error: (await getT()).contacts.errors.chooseAction };
  }
  revalidatePath("/contacts");
  return {};
}

export async function bookAction(_previous: FormResult, form: FormData): Promise<FormResult> {
  const user = await requireOnboardedUser();
  const text = (key: string) => String(form.get(key) ?? "");
  const clock = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text("start"));
  if (!clock) return { error: (await getT()).contacts.errors.startTime };
  let id: string;
  try {
    id = createGroupEvent(user, {
      contactIds: form.getAll("person").map(String), title: text("title"), location: text("location"),
      date: text("date"), startMin: Number(clock[1]) * 60 + Number(clock[2]), duration: Number(text("duration")),
      deadline: text("deadline"), share: form.get("share") === "on",
    });
  } catch (error) { return invitationFailure(error, await getLocale()); }
  revalidatePath("/contacts");
  redirect(`/contacts/events/${id}`);
}

export async function rsvpAction(eventId: string, _previous: FormResult, form: FormData): Promise<FormResult> {
  const user = await requireOnboardedUser();
  const response = form.get("response");
  if (response !== "accepted" && response !== "declined") return { error: (await getT()).contacts.errors.chooseResponse };
  try {
    respondToEvent({ eventId }, { userId: user.id }, response);
  } catch (error) { return invitationFailure(error, await getLocale()); }
  revalidatePath(`/contacts/events/${eventId}`);
  revalidatePath("/contacts");
  revalidatePath("/");
  return {};
}

/** Result of saving a person without an account: an error, groups to pick from, or the saved name. */
export type SavedContactResult = { error?: string; choices?: GroupChoice[]; query?: string; saved?: string };

export async function saveContactAction(_previous: SavedContactResult, form: FormData): Promise<SavedContactResult> {
  const user = await requireOnboardedUser();
  const locale = await getLocale();
  const t = (await getT()).contacts.saved.errors;
  const name = String(form.get("name") ?? "").trim();
  const query = String(form.get("group") ?? "").trim();
  const chosen = Number(form.get("groupId"));
  if (!name) return { error: t.name };
  if (name.length > SAVED_NAME_MAX) return { error: t.nameTooLong };
  let groupId: number;
  if (Number.isInteger(chosen) && chosen > 0) {
    groupId = chosen;
  } else {
    if (!query) return { error: t.group };
    const matches = matchGroups(query, user.facultyId, user.year, locale);
    if (!matches.length) return { error: t.noMatch(query) };
    if (matches.length > 1) return { choices: matches, query };
    groupId = matches[0].groupId;
  }
  let saved: string;
  try {
    saved = saveContact(user.id, name, groupId).name;
  } catch (error) {
    if (error instanceof SavedContactError) return { error: t[error.code] };
    throw error;
  }
  revalidatePath("/contacts");
  return { saved };
}

export async function removeSavedContactAction(id: number): Promise<void> {
  const user = await requireOnboardedUser();
  removeSavedContact(user.id, id);
  revalidatePath("/contacts");
}

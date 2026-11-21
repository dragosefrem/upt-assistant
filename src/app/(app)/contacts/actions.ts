"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormResult } from "@/components/InvitationForm";
import { requireOnboardedUser } from "@/lib/auth";
import { answerContact, cancelContactRequest, invitationFailure, inviteContact, removeContact } from "@/lib/contacts";
import { respondToEvent } from "@/lib/group-events";
import { createGroupEvent } from "@/lib/group-planning";

export async function inviteAction(email: string): Promise<FormResult> {
  const user = await requireOnboardedUser();
  try {
    inviteContact(user.id, email);
  } catch (error) { return invitationFailure(error); }
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
    default: return { error: "Choose a contact action." };
  }
  revalidatePath("/contacts");
  return {};
}

export async function bookAction(_previous: FormResult, form: FormData): Promise<FormResult> {
  const user = await requireOnboardedUser();
  const text = (key: string) => String(form.get(key) ?? "");
  const clock = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text("start"));
  if (!clock) return { error: "Enter a valid start time." };
  let id: string;
  try {
    id = createGroupEvent(user, {
      contactIds: form.getAll("person").map(String), title: text("title"), location: text("location"),
      date: text("date"), startMin: Number(clock[1]) * 60 + Number(clock[2]), duration: Number(text("duration")),
      deadline: text("deadline"), share: form.get("share") === "on",
    });
  } catch (error) { return invitationFailure(error); }
  revalidatePath("/contacts");
  redirect(`/contacts/events/${id}`);
}

export async function rsvpAction(eventId: string, _previous: FormResult, form: FormData): Promise<FormResult> {
  const user = await requireOnboardedUser();
  const response = form.get("response");
  if (response !== "accepted" && response !== "declined") return { error: "Choose a response." };
  try {
    respondToEvent({ eventId }, { userId: user.id }, response);
  } catch (error) { return invitationFailure(error); }
  revalidatePath(`/contacts/events/${eventId}`);
  revalidatePath("/contacts");
  revalidatePath("/");
  return {};
}

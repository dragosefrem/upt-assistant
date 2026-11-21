import { randomBytes } from "node:crypto";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { GroupEventSummary, RsvpButtons } from "@/components/GroupEventSummary";
import { InvitationForm } from "@/components/InvitationForm";
import { InvitationRefresh } from "@/components/InvitationRefresh";
import { ShareInvitation } from "@/components/ShareInvitation";
import { getUser } from "@/lib/auth";
import { publicEvent } from "@/lib/group-events";
import { publicRsvp } from "./actions";
import { GUEST_COOKIE } from "./guest-cookie";

export const metadata = { title: "Event invitation", robots: { index: false, follow: false }, referrer: "no-referrer" } as const;

export default async function GuestPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const user = await getUser();
  const guestKey = (await cookies()).get(GUEST_COOKIE)?.value;
  const event = publicEvent(token, user?.id, guestKey);
  if (!event) notFound();
  // Bind one fresh key to this form so a retried first submission keeps the same seat.
  const firstGuestKey = !user && !guestKey ? randomBytes(32).toString("base64url") : "";
  return (
    <main className="mx-auto w-full max-w-xl space-y-4 px-4 py-8 sm:py-14">
      <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">U</span>UPT Orar</div>
      <article className="card space-y-5 p-5 sm:p-7">
        <GroupEventSummary event={event} />
        <InvitationRefresh deadline={event.status === "pending" ? event.deadline : undefined} />
        {event.status !== "expired" && <>
          <InvitationForm action={publicRsvp.bind(null, token, firstGuestKey)} className="flex flex-wrap items-center gap-3">
            {!user && event.response === null && <label className="w-full">
              <span className="label">Your name</span><input name="name" className="field" autoComplete="name" maxLength={100} required />
            </label>}
            <RsvpButtons response={event.response} />
            {user && !event.accountParticipant && event.response === "accepted" &&
              <button className="btn-primary" name="response" value="accepted">Add to my account</button>}
          </InvitationForm>
          {!user && <p className="text-sm text-slate-600">
            {event.response ? "Your RSVP is saved in this browser." : "You can join as a guest with just your name."}{" "}
            <Link className="font-medium text-brand-700 underline" href={`/login?invite=${token}`}>Sign in to use your account</Link>
          </p>}
          {!user && guestKey && event.response && <ShareInvitation path={`/join/${token}/manage/${guestKey}`} personal />}
        </>}
        {user && event.accountParticipant && <Link className="btn-secondary" href={`/contacts/events/${event.id}`}>View invitation in Contacts</Link>}
      </article>
    </main>
  );
}

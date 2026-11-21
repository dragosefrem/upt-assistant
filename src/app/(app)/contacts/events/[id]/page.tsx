import Link from "next/link";
import { notFound } from "next/navigation";
import { GroupEventSummary, responseLabel, RsvpButtons } from "@/components/GroupEventSummary";
import { InvitationForm } from "@/components/InvitationForm";
import { InvitationRefresh } from "@/components/InvitationRefresh";
import { ShareInvitation } from "@/components/ShareInvitation";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { memberEvent } from "@/lib/group-events";
import { rsvpAction } from "../../actions";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.contacts.event.pageTitle };
}

export default async function GroupEventPage({ params }: PageProps<"/contacts/events/[id]">) {
  const user = await requireOnboardedUser();
  const event = memberEvent(user.id, (await params).id);
  if (!event) notFound();
  const t = (await getT()).contacts.event;
  const locale = await getLocale();
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Link href="/contacts" className="text-sm font-medium text-brand-700 hover:underline">{t.back}</Link>
      <article className="card space-y-5 p-5 sm:p-7">
        <GroupEventSummary event={event} />
        <InvitationRefresh deadline={event.status === "pending" ? event.deadline : undefined} />
        {event.status !== "expired" && <InvitationForm action={rsvpAction.bind(null, event.id)} className="flex flex-wrap gap-2">
          <RsvpButtons response={event.response} />
        </InvitationForm>}
        <section className="border-t border-slate-200 pt-4">
          <h2 className="font-semibold">{t.participants}</h2>
          <ul className="mt-1 divide-y divide-slate-100">
            {event.roster.map((p) => <li key={p.id} className="flex justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 break-words">{p.name}</span><span className="shrink-0 text-slate-600">{responseLabel(p.response, locale)}</span>
            </li>)}
          </ul>
        </section>
        {event.shareToken && event.status !== "expired" && <ShareInvitation path={`/join/${event.shareToken}`} />}
      </article>
    </div>
  );
}

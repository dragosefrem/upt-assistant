import Link from "next/link";
import { BookingForm } from "@/components/BookingForm";
import { requireOnboardedUser } from "@/lib/auth";
import { contactList } from "@/lib/contacts";
import { weeklyAvailability } from "@/lib/group-planning";
import { localDateTime } from "@/lib/time";

export const metadata = { title: "Plan a group event" };

export default async function PlanPage({ searchParams }: PageProps<"/contacts/plan">) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const ids = [...new Set([params.person ?? []].flat())];
  const contacts = contactList(user.id).filter((p) => p.accepted);
  const selected = contacts.filter((p) => ids.includes(p.id));
  const stale = selected.length !== ids.length;
  const showTimes = params.find === "1" && !stale;
  const edit = new URLSearchParams(selected.map((p) => ["person", p.id]));
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link href="/contacts" className="text-sm font-medium text-brand-700 hover:underline">← Contacts</Link>
      <h1 className="text-2xl font-semibold tracking-tight">Plan a group event</h1>
      {showTimes ? <>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-slate-700"><strong>Checking calendars for</strong> {[ "you", ...selected.map((p) => p.name)].join(", ")}</p>
          <Link className="text-sm text-brand-700 underline" href={`/contacts/plan?${edit}`}>Change group</Link>
        </div>
        <BookingForm slots={weeklyAvailability(user, ids)} contactIds={ids} earliestReply={localDateTime()} />
      </> : <form action="/contacts/plan" className="card space-y-4 p-5">
        <input name="find" value="1" type="hidden" />
        <fieldset>
          <legend className="text-lg font-semibold">Who’s coming?</legend>
          <p className="my-2 text-sm text-slate-600">Your calendar is included. Select contacts to check together, or continue on your own to invite guests by link.</p>
          {stale && <p role="alert" className="my-2 text-sm text-red-700">Someone in this selection is no longer a contact. Choose your group again.</p>}
          <div className="divide-y divide-slate-100">
            {contacts.map((p) => <label key={p.id} className="flex cursor-pointer items-center gap-3 py-2.5 text-sm">
              <input type="checkbox" name="person" value={p.id} defaultChecked={ids.includes(p.id)} className="h-4 w-4 accent-brand-600" />
              <span><strong>{p.name}</strong><span className="ml-2 break-all text-slate-500">{p.email}</span></span>
            </label>)}
          </div>
        </fieldset>
        <button className="btn-primary">Find free time this week</button>
      </form>}
    </div>
  );
}

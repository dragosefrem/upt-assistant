import Form from "next/form";
import Link from "next/link";
import { BookingForm } from "@/components/BookingForm";
import type { Messages } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { requireOnboardedUser } from "@/lib/auth";
import { contactList } from "@/lib/contacts";
import { groupAvailability } from "@/lib/group-planning";
import { nextDays, PLANNING_PRESETS, planningRange, type DateRange } from "@/lib/planning-range";
import { formatDateRange, nowLocal } from "@/lib/time";

export async function generateMetadata() {
  const t = await getT();
  return { title: t.contacts.plan.title };
}

const planner = "/contacts/plan";

function plannerLink(ids: string[], dates: DateRange, find = true, page = 1) {
  const query = new URLSearchParams({ from: dates.from, to: dates.to });
  for (const id of ids) query.append("person", id);
  if (find) query.set("find", "1");
  if (page > 1) query.set("page", String(page));
  return `${planner}?${query}`;
}

function DateFields({ range, today, t }: { range: DateRange; today: string; t: Messages["contacts"]["plan"] }) {
  return <>
    <label className="min-w-0"><span className="label">{t.from}</span>
      <input type="date" name="from" className="field" defaultValue={range.from} min={today} required />
    </label>
    <label className="min-w-0"><span className="label">{t.through}</span>
      <input type="date" name="to" className="field" defaultValue={range.to} min={today} required />
    </label>
  </>;
}

export default async function PlanPage({ searchParams }: PageProps<"/contacts/plan">) {
  const user = await requireOnboardedUser();
  const params = await searchParams;
  const messages = (await getT()).contacts;
  const t = messages.plan;
  const locale = await getLocale();
  const ids = [...new Set([params.person ?? []].flat())];
  const contacts = contactList(user.id).filter((p) => p.accepted);
  const selected = contacts.filter((p) => ids.includes(p.id));
  const stale = selected.length !== ids.length;
  const showTimes = params.find === "1" && !stale;
  const asOf = nowLocal();
  const { date: today } = asOf;
  const { range, visible, page, pageCount, totalDays, error } = planningRange(today, params);
  const inputRange = error ? {
    from: typeof params.from === "string" ? params.from : "",
    to: typeof params.to === "string" ? params.to : "",
  } : range;
  const dateFields = <DateFields key={`${inputRange.from}/${inputRange.to}`} range={inputRange} today={today} t={t} />;
  return (
    <div className={`mx-auto w-full space-y-5 ${showTimes ? "max-w-6xl" : "max-w-3xl"}`}>
      <Link href="/contacts" className="text-sm font-medium text-brand-700 hover:underline">{messages.event.back}</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
        {showTimes && <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 text-sm">
          {selected.length ? <details className="relative">
            <summary className="cursor-pointer font-medium text-slate-700">{t.you(selected.length)}</summary>
            <ul className="absolute z-20 mt-2 max-h-64 w-48 overflow-auto rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              {selected.map((person) => <li className="py-0.5" key={person.id}>{person.name}</li>)}
            </ul>
          </details> : <span className="text-slate-600">{t.yourCalendar}</span>}
          <Link className="font-medium text-brand-700 underline" href={plannerLink(ids, range, false)}>{t.changeGroup}</Link>
        </div>}
      </header>
      {showTimes ? <>
        <section className="card flex flex-wrap items-end justify-between gap-x-6 gap-y-4 p-4 sm:p-5" aria-label={t.rangeLabel}>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">{t.lookAhead}</h2>
            <nav aria-label={t.quickRanges} className="inline-flex gap-0.5 rounded-xl bg-slate-100 p-1">
              {PLANNING_PRESETS.map((count) => {
                const dates = nextDays(today, count);
                const active = !error && dates.from === range.from && dates.to === range.to;
                return <Link key={count} href={plannerLink(ids, dates)} scroll={false} prefetch={false}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-brand-500 ${active ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-brand-700"}`}>
                  {t.days(count)}
                </Link>;
              })}
            </nav>
          </div>
          <Form action={planner} scroll={false} className="grid w-full grid-cols-2 items-end gap-2 sm:flex sm:w-auto sm:flex-wrap">
            <input type="hidden" name="find" value="1" />
            {ids.map((id) => <input key={id} type="hidden" name="person" value={id} />)}
            {dateFields}
            <button className="btn-secondary col-span-2">{t.applyDates}</button>
          </Form>
        </section>
        {error ? <p role="alert" className="card p-4 text-sm text-red-700">{messages.errors[error]}</p> : <>
          {pageCount > 1 && <nav aria-label={t.pages} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span><strong>{formatDateRange(visible.from, visible.to, locale)}</strong><span className="ml-2 text-slate-600">{t.pageOf(page, pageCount, totalDays)}</span></span>
            <div className="flex gap-1">
              {page > 1 && <Link className="btn-secondary" scroll={false} prefetch={false} href={plannerLink(ids, range, true, page - 1)}>{t.earlier}</Link>}
              {page < pageCount && <Link className="btn-secondary" scroll={false} prefetch={false} href={plannerLink(ids, range, true, page + 1)}>{t.later}</Link>}
            </div>
          </nav>}
          <BookingForm slots={groupAvailability(user, ids, visible, asOf)} range={visible} contactIds={ids} asOf={asOf} />
        </>}
      </> : <Form action={planner} className="card space-y-5 p-5">
        <input name="find" value="1" type="hidden" />
        <fieldset>
          <legend className="text-lg font-semibold">{t.whoHeading}</legend>
          <p className="my-2 text-sm text-slate-600">{contacts.length ? t.whoHint : t.noContacts}</p>
          {stale && <p role="alert" className="my-2 text-sm text-red-700">{t.stale}</p>}
          <div className="divide-y divide-slate-100">
            {contacts.map((p) => <label key={p.id} className="flex cursor-pointer items-center gap-3 py-2.5 text-sm">
              <input type="checkbox" name="person" value={p.id} defaultChecked={ids.includes(p.id)} className="h-4 w-4 accent-brand-600" />
              <span><strong>{p.name}</strong><span className="ml-2 break-all text-slate-500">{p.email}</span></span>
            </label>)}
          </div>
        </fieldset>
        <fieldset className="grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2">
          <legend className="pr-3 font-semibold">{t.dateRange}</legend>
          {dateFields}
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-700">{messages.errors[error]}</p>}
        <button className="btn-primary">{t.findFree}</button>
      </Form>}
    </div>
  );
}

"use client";

import { CalendarCheck2, CalendarDays, CalendarPlus, Check, Eye, Ticket, Users } from "lucide-react";
import { useActionState, useRef, useState, useTransition } from "react";
import { checkSponsoredAvailability, publishSponsoredEvent } from "@/app/admin/sponsored-events/actions";
import { useT } from "@/i18n/client";
import { addDays } from "@/lib/time";
import { SponsoredCard } from "./SponsoredCard";

type Option = { id: number; label: string; name?: string };

function AudienceFilter({ legend, name, all, options, selected, onChange }: {
  legend: string; name: string; all: string; options: Option[]; selected: number[]; onChange: (next: number[]) => void;
}) {
  const chip = "inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium";
  const active = "border-brand-600 bg-brand-50 text-brand-900";
  const idle = "border-slate-200 bg-white text-slate-600 hover:border-slate-400";
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={`${chip} ${selected.length ? idle : active}`} aria-pressed={!selected.length} onClick={() => onChange([])}>
          {!selected.length && <Check size={14} aria-hidden />}{all}
        </button>
        {options.map((option) => {
          const checked = selected.includes(option.id);
          return <label key={option.id} title={option.name} className={`${chip} ${checked ? active : idle} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-500`}>
            <input className="sr-only" type="checkbox" name={name} value={option.id} checked={checked} aria-label={option.name || option.label}
              onChange={() => onChange(checked ? selected.filter((v) => v !== option.id) : [...selected, option.id].sort((a, b) => a - b))} />
            {checked && <Check size={14} aria-hidden />}{option.label}
          </label>;
        })}
      </div>
    </fieldset>
  );
}

export function SponsoredComposer({ id, faculties, today }: {
  id: string; faculties: { id: number; name: string; shortName: string | null }[]; today: string;
}) {
  const { sponsored: t, common, calendar } = useT();
  const [title, setTitle] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(addDays(today, 1));
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("13:00");
  const [facultyIds, setFacultyIds] = useState<number[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [state, publish, publishing] = useActionState(publishSponsoredEvent, null);
  const [checking, check] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const slotKey = JSON.stringify([date, start, end, facultyIds, years]);
  const [preview, setPreview] = useState<{
    key: string; result: Awaited<ReturnType<typeof checkSponsoredAvailability>> | { error: "network" };
  } | null>(null);
  const reach = preview?.key === slotKey ? preview.result : null;
  const invalidEnd = !!start && !!end && end <= start;
  const facultyOptions = faculties.map((f) => ({ id: f.id, label: f.shortName || f.name, name: f.name }));
  const panel = "card space-y-4 p-4 sm:p-6";
  const heading = "flex items-center gap-2 text-base font-semibold";

  return (
    <form action={publish} ref={form} className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
      <input type="hidden" name="draftId" value={id} />
      <div className="min-w-0 space-y-4">
        <section className={panel}>
          <h2 className={heading}><Ticket size={18} aria-hidden className="text-cyan-800" />{t.details}</h2>
          <label className="block"><span className="label">{t.titleLabel}</span><input className="field" required name="title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className="label">{t.sponsor}</span><input className="field" required name="sponsor" maxLength={100} value={sponsor} onChange={(e) => setSponsor(e.target.value)} /></label>
            <label><span className="label">{t.location} <small>({t.optional})</small></span><input className="field" name="location" maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
          </div>
          <label className="block"><span className="label">{t.description} <small>({t.optional})</small></span><textarea className="field" rows={2} name="description" maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        </section>
        <section className={panel}>
          <h2 className={heading}><CalendarDays size={18} aria-hidden className="text-cyan-800" />{t.schedule}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
            <label className="col-span-2 min-w-0 sm:col-span-1"><span className="label">{t.date}</span><input className="field min-w-0" type="date" required min={today} name="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="min-w-0"><span className="label">{t.start}</span><input className="field min-w-0" type="time" required name="start" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="min-w-0"><span className="label">{t.end}</span><input className="field min-w-0" type="time" required name="end" value={end} aria-invalid={invalidEnd || undefined} aria-describedby={invalidEnd ? "sponsored-time-error" : undefined} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          {invalidEnd && <p id="sponsored-time-error" className="text-sm text-red-700">{calendar.api.endAfterStart}</p>}
          <p className="text-xs text-slate-600">{t.zone}</p>
        </section>
        <section className={panel}>
          <h2 className={heading}><Users size={18} aria-hidden className="text-cyan-800" />{t.audience}</h2>
          <p className="text-sm text-slate-600">{t.audienceHint}</p>
          <AudienceFilter name="faculty" legend={t.faculties} all={t.allFaculties} options={facultyOptions} selected={facultyIds} onChange={setFacultyIds} />
          <AudienceFilter name="year" legend={t.years} all={t.allYears} options={[1, 2, 3, 4, 5, 6].map((id) => ({ id, label: t.year(id) }))} selected={years} onChange={setYears} />
        </section>
      </div>
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-20">
        <div className="space-y-4 rounded-[1.35rem] border border-cyan-900/15 bg-[#eef7f6] p-4 sm:p-5">
          <h2 className={heading}><Eye size={18} aria-hidden className="text-cyan-800" />{t.preview}</h2>
          <SponsoredCard preview title={title.trim() || t.previewTitle} sponsor={sponsor.trim() || t.previewSponsor} date={date.length === 10 ? date : ""}
            time={start && end ? `${start}–${end}` : ""} location={location} description={description}>
            <span className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-cyan-900"><CalendarPlus size={16} aria-hidden />{t.add}</span>
          </SponsoredCard>
          <div className="space-y-2 border-t border-cyan-900/15 pt-4">
            <p className="text-sm font-medium text-slate-700">
              {facultyIds.length ? facultyOptions.filter((f) => facultyIds.includes(f.id)).map((f) => f.label).join(", ") : t.allFaculties}
              {" · "}{years.length ? years.map(t.year).join(", ") : t.allYears}
            </p>
            <button type="button" disabled={checking || publishing || !date || !start || !end || invalidEnd} className="btn-secondary" onClick={() => {
              if (!form.current) return;
              const data = new FormData(form.current);
              check(async () => {
                try { setPreview({ key: slotKey, result: await checkSponsoredAvailability(data) }); }
                catch { setPreview({ key: slotKey, result: { error: "network" } }); }
              });
            }}><CalendarCheck2 size={16} aria-hidden />{checking ? t.checking : t.check}</button>
            <div role="status" className="text-sm">
              {reach && ("error" in reach
                ? <p className="text-red-700">{reach.error === "network" ? common.status.offline : t.errors[reach.error]}</p>
                : <p className="font-semibold text-cyan-950">{reach.total ? t.reach(reach.free, reach.total) : t.noMatches}</p>)}
            </div>
            <p className="text-xs leading-relaxed text-slate-600">{t.reachHint}</p>
          </div>
        </div>
        {state?.error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800">{t.errors[state.error]}</p>}
        <button className="btn-primary w-full" disabled={publishing || invalidEnd}>{publishing ? t.publishing : t.publish}</button>
      </aside>
    </form>
  );
}

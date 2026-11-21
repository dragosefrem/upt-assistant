import Link from "next/link";
import { count } from "drizzle-orm";
import { getDb } from "@/db";
import { entries, faculties, groups } from "@/db/schema";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { Mascot } from "@/components/Mascot";
import { DATE_LOCALE } from "@/i18n/config";
import { getLocale, getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";

export async function generateMetadata() {
  const t = await getT();
  return { title: { absolute: `${t.common.appName} · ${t.landing.title}` }, description: t.landing.hero.sub };
}

/** How much of UPT is in the database, for the strip under the hero. Zero on a fresh install. */
function coverage() {
  const db = getDb();
  const one = (table: typeof groups | typeof entries) => db.select({ n: count() }).from(table).get()?.n ?? 0;
  return {
    groups: one(groups),
    classes: one(entries),
    faculties: db.select({ n: count() }).from(faculties).get()?.n ?? 0,
  };
}

/** The week grid in the hero: a stylised picture of the calendar, not real data. */
const BLOCKS: Array<{ day: number; row: number; span: number; kind: "lecture" | "lab" | "seminar"; label: string }> = [
  { day: 0, row: 1, span: 2, kind: "lecture", label: "AM" },
  { day: 0, row: 3, span: 2, kind: "lecture", label: "FIZ" },
  { day: 1, row: 2, span: 3, kind: "lecture", label: "PC" },
  { day: 1, row: 6, span: 2, kind: "seminar", label: "AG" },
  { day: 2, row: 2, span: 2, kind: "lab", label: "LSD" },
  { day: 2, row: 5, span: 2, kind: "seminar", label: "EN" },
  { day: 3, row: 2, span: 2, kind: "lab", label: "PC" },
  { day: 3, row: 4, span: 2, kind: "seminar", label: "AM" },
  { day: 4, row: 1, span: 2, kind: "seminar", label: "AG" },
  { day: 4, row: 4, span: 2, kind: "lab", label: "ET" },
];
const BLOCK_STYLE = {
  lecture: "border-brand-500 bg-brand-50 text-brand-900",
  lab: "border-amber-500 bg-amber-50 text-amber-900",
  seminar: "border-emerald-500 bg-emerald-50 text-emerald-900",
};

export default async function WelcomePage() {
  const [t, locale, user] = await Promise.all([getT(), getLocale(), getUser()]);
  const l = t.landing;
  const stats = coverage();
  const number = (n: number) => new Intl.NumberFormat(DATE_LOCALE[locale]).format(n);
  const primaryHref = user ? "/" : "/register";
  const primaryLabel = user ? l.nav.openApp : l.hero.cta;

  return (
    <div className="flex flex-1 flex-col overflow-x-clip">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-4">
        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
          <Mascot size={36} chat={false} />
          <Link href="/">
            UPT <span className="text-brand-600">Orar</span>
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitch />
          {user ? (
            <Link href="/" className="btn-primary">{l.nav.openApp}</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost hidden sm:inline-flex">{l.nav.signIn}</Link>
              <Link href="/register" className="btn-primary">{l.nav.start}</Link>
            </>
          )}
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-12 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pb-20 lg:pt-12">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm">
              <span aria-hidden>🎓</span>
              {l.hero.badge}
            </p>
            <h1 className="mt-4 text-4xl font-bold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl">{l.hero.headline}</h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">{l.hero.sub}</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href={primaryHref} className="btn-primary px-5 py-3 text-base shadow-[0_10px_30px_-10px_rgba(31,72,196,0.7)]">{primaryLabel}</Link>
              {!user && <Link href="/login" className="btn-secondary px-5 py-3 text-base">{l.hero.secondary}</Link>}
            </div>
            {!user && <p className="mt-3 text-sm text-slate-500">{l.hero.note}</p>}
          </div>

          {/* A picture of the app: the week, and Poli answering the classic question. */}
          <div className="relative mx-auto w-full max-w-xl" aria-hidden>
            <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-br from-brand-200/60 via-white to-amber-100/70 blur-2xl" />
            <div className="card overflow-hidden shadow-[0_30px_80px_-30px_rgba(20,36,87,0.45)]">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                <span className="ml-2 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">{l.preview.week}</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5 p-3">
                {l.preview.days.map((d) => (
                  <p key={d} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">{d}</p>
                ))}
                {l.preview.days.map((d, day) => (
                  <div key={d} className="grid h-52 grid-rows-7 gap-1 rounded-xl bg-slate-50/80 p-1">
                    {BLOCKS.filter((b) => b.day === day).map((b) => (
                      <div
                        key={`${b.row}-${b.label}`}
                        className={`overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-[11px] font-semibold leading-tight ${BLOCK_STYLE[b.kind]}`}
                        style={{ gridRow: `${b.row} / span ${b.span}` }}
                      >
                        {b.label}
                        <span className="block text-[9px] font-normal opacity-80">{l.preview[b.kind]}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="relative -mt-10 ml-auto mr-2 w-[88%] space-y-2 sm:mr-6 sm:w-[78%]">
              <p className="ml-auto w-fit max-w-full rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-lg">{l.preview.question}</p>
              <div className="flex items-end gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a small static picture; next/image adds nothing here */}
                <img src="/images/mascot.svg" alt="" width={34} height={34} className="mb-1 shrink-0 rounded-full bg-white shadow" />
                <div className="rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-sm leading-relaxed text-slate-800 shadow-lg ring-1 ring-slate-100">
                  {l.preview.answer}
                  <span className="mt-2 flex w-fit items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                    🧭 {l.preview.chip} →
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* What is in the database */}
        {stats.groups > 0 && (
          <section className="border-y border-slate-200/70 bg-white/70">
            <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-4 px-4 py-6 text-center sm:grid-cols-4">
              {[
                [number(stats.faculties), l.stats.faculties],
                [number(stats.groups), l.stats.groups],
                [number(stats.classes), l.stats.classes],
                ["2", l.stats.languages],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="sr-only">{label}</dt>
                  <dd>
                    <span className="block text-2xl font-bold tracking-tight text-brand-700 sm:text-3xl">{value}</span>
                    <span className="text-sm text-slate-600">{label}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Features */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14">
          <h2 className="max-w-2xl text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{l.featuresTitle}</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {l.features.map((f) => (
              <li key={f.title} className="card p-5 transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-12px_rgba(31,72,196,0.35)]">
                <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-2xl">{f.icon}</span>
                <h3 className="mt-3 text-base font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* First-years */}
        <section className="mx-auto w-full max-w-6xl px-4">
          <div className="card relative overflow-hidden bg-gradient-to-br from-brand-600 to-brand-500 p-6 text-white sm:p-10">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
            <div aria-hidden className="pointer-events-none absolute -bottom-20 right-32 h-44 w-44 rounded-full bg-amber-300/20" />
            <div className="relative max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{l.freshers.title}</h2>
              <p className="mt-3 text-base leading-relaxed text-white/90">{l.freshers.body}</p>
              <ul className="mt-5 flex flex-wrap gap-2" lang="ro">
                {l.freshers.words.map((w) => (
                  <li key={w} className="rounded-full bg-white/15 px-3 py-1 text-sm font-medium ring-1 ring-white/25">{w}</li>
                ))}
              </ul>
              <Link href={user ? "/guide" : "/register"} className="btn-secondary mt-5">
                {user ? t.onboarding.tour.openGuide : t.auth.login.create}
              </Link>
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="mx-auto w-full max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{l.steps.title}</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {l.steps.items.map((s, i) => (
              <li key={s.title} className="card p-5">
                <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                <h3 className="mt-3 text-base font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-10 flex flex-col items-center gap-4 text-center">
            <Mascot size={72} wave chat={false} />
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">{l.closing.title}</h2>
            <Link href={primaryHref} className="btn-primary px-6 py-3 text-base">{user ? l.nav.openApp : l.closing.cta}</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/70 bg-white/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center">
          <p className="max-w-2xl">{l.footer.source}</p>
          {!user && (
            <p className="flex gap-4 sm:ml-auto">
              <Link href="/login" className="font-medium text-brand-700 hover:underline">{l.footer.signIn}</Link>
              <Link href="/register" className="font-medium text-brand-700 hover:underline">{l.footer.register}</Link>
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}

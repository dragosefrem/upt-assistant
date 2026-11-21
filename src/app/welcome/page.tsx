import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Mascot } from "@/components/Mascot";
import { getUser } from "@/lib/auth";
import { landingStats, roCount } from "@/lib/landing";

export const metadata: Metadata = {
  title: "Mereu la timp, pentru tot",
  description: "UPT Orar: orarul, examenele și sala la care trebuie să ajungi, într-un singur loc, cu Poli, asistentul care îți răspunde în română.",
};

// The numbers come from the database at request time.
export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: "📅",
    title: "Orarul tău, gata făcut",
    text: "Citim orarele publicate de facultate: grupa ta, laboratoarele tale, săptămânile pare și impare. Adaugi orice altceva cu un clic.",
  },
  {
    icon: "🔔",
    title: "Niciun examen ratat",
    text: "Fiecare examen are sala, clădirea și harta. Primești remindere înainte și alarme în calendarul telefonului.",
  },
  {
    icon: "💬",
    title: "Întrebi pe Poli",
    text: "„Ce am mâine?” „Când sunt liber joi?” „Cum ajung la sală?” Scrii sau vorbești, în română sau engleză.",
  },
];

/** What signed-out visitors see: one short page about UPT Orar, with Poli. */
export default async function WelcomePage() {
  if (await getUser()) redirect("/");
  const stats = landingStats();
  const from = [...stats.imported, ...stats.examsOnly];

  return (
    <div lang="ro" className="flex min-h-full flex-1 flex-col bg-[#f7f8fc] text-slate-900">
      <header className="border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5">
          <Mascot size={36} chat={false} />
          <span className="font-semibold tracking-tight">
            UPT <span className="text-brand-600">Orar</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="btn-ghost px-2 sm:px-3.5">
              <span className="sm:hidden">Intră</span>
              <span className="hidden sm:inline">Intră în cont</span>
            </Link>
            <Link href="/register" className="btn-primary rounded-full px-4">
              <span className="sm:hidden">Cont nou</span>
              <span className="hidden sm:inline">Creează-ți contul</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-[#fff4dc]" />
        <div aria-hidden className="pointer-events-none absolute -left-40 top-64 h-[26rem] w-[26rem] rounded-full bg-brand-50" />

        {/* Hero */}
        <section className="relative mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-5 pb-14 pt-14 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Pentru studenții Politehnicii Timișoara</p>
            <h1 className="mt-4 text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl">
              Mereu <span className="bg-[linear-gradient(transparent_62%,#fde68a_62%)] px-1">la timp</span>,
              <br />
              pentru tot.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-slate-600">
              Orarul, examenele și sala la care trebuie să ajungi, într-un singur loc. Iar Poli îți spune ce urmează.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn-primary rounded-full px-6 py-3 text-base">Creează-ți contul</Link>
              <Link href="/login" className="btn-secondary rounded-full px-6 py-3 text-base">Am deja cont</Link>
            </div>
            {stats.classes + stats.exams > 0 && (
              <p className="mt-6 text-sm text-slate-500">
                Acum în aplicație:{" "}
                {stats.classes > 0 && <b className="text-slate-700">{roCount(stats.classes, "oră", "ore")}</b>}
                {stats.classes > 0 && stats.exams > 0 && " și "}
                {stats.exams > 0 && <b className="text-slate-700">{roCount(stats.exams, "examen", "examene")}</b>}{" "}
                {stats.classes + stats.exams === 1 ? "importat" : "importate"}
                {from.length ? ` de la ${from.join(", ")}` : ""}.
              </p>
            )}
          </div>

          {/* What "on time" looks like: what's next, an exam reminder, Poli */}
          <div className="relative mx-auto w-full max-w-md space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_30px_60px_-20px_rgba(20,36,87,0.35)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Urmează · în 25 min</p>
              <div className="mt-2 flex items-start gap-3">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-500" />
                <div>
                  <p className="font-semibold">Rezistența materialelor</p>
                  <p className="text-sm text-slate-600">10:00–12:00 · curs · sala MEC A102</p>
                </div>
              </div>
            </div>
            <div className="ml-6 flex items-start gap-3 rounded-2xl border border-brand-100 bg-white p-3 shadow-xl">
              <Mascot size={40} chat={false} />
              <div className="text-sm">
                <p className="font-semibold">📝 Examen mâine la 09:00</p>
                <p className="text-slate-600">Sala MEC 204 · Facultatea de Mecanică. Dormi bine! 😴</p>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <Mascot size={64} wave chat={false} />
              <div className="mb-4 rounded-2xl rounded-bl-md bg-brand-600 px-4 py-3 text-sm text-white shadow-lg">
                Joi ai liber de la 10:00. ☕ Pun ședința de club atunci?
              </div>
            </div>
            <p className="text-center font-mono text-[11px] text-slate-400">Exemplu</p>
          </div>
        </section>

        {/* Three things */}
        <section className="relative mx-auto grid max-w-6xl gap-5 px-5 pb-14 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-3xl border border-slate-200 bg-white p-6">
              <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-2xl">{f.icon}</span>
              <h2 className="mt-4 text-lg font-semibold">{f.title}</h2>
              <p className="mt-2 leading-relaxed text-slate-600">{f.text}</p>
            </div>
          ))}
        </section>

        {/* Call to action */}
        <section className="relative px-5 pb-14">
          <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-6 overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-600 to-brand-500 px-8 py-10 text-white sm:flex-row sm:items-center sm:px-12">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
            <div className="relative flex-1">
              <h2 className="text-3xl font-bold tracking-tight">Gata în cinci minute.</h2>
              <p className="mt-2 text-brand-50">Alegi facultatea, anul și grupa. Restul îl face aplicația.</p>
            </div>
            <div className="relative flex items-center gap-4">
              <Link href="/register" className="rounded-full bg-amber-300 px-6 py-3 font-semibold text-brand-900 shadow-sm transition hover:bg-amber-200">Creează-ți contul</Link>
              <span className="hidden rounded-3xl bg-white/15 p-2 sm:block"><Mascot size={56} wave chat={false} /></span>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-5 text-sm text-slate-500">
          <span>UPT Orar · orare din documentele publicate pe upt.ro</span>
          <span>Pe telefon și pe calculator</span>
        </div>
      </footer>
    </div>
  );
}

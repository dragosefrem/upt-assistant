import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Mascot } from "@/components/Mascot";
import { getUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Tu ai planul. Poli are calendarul.",
  description: "UPT Orar: asistentul care îți știe orarul, examenele și sala. Nu mai pierzi nimic, iar timpul câștigat e al tău.",
};

// The numbers come from the database at request time.
export const dynamic = "force-dynamic";

/** The italic display face for the emphasised words, in the spirit of the reference page. */
const serif = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin", "latin-ext"], variable: "--font-serif" });

/** What goes into Poli: the mess a student deals with today. */
const MESS = [
  { text: "📄 orar_sem1_v3_FINAL.pdf", tx: "140px", ty: "60px", top: "6%", left: "2%" },
  { text: "📊 Orar ETcTI.xlsx", tx: "170px", ty: "10px", top: "30%", left: "10%" },
  { text: "💬 „Ce sală avem mâine?”", tx: "150px", ty: "-30px", top: "54%", left: "0%" },
  { text: "📝 programare_examene.pdf", tx: "130px", ty: "-80px", top: "78%", left: "6%" },
];

/** What comes out: a clear day, each item tagged with what Poli did. */
const TIDY = [
  { time: "08:00", title: "Mecanică · curs", where: "sala MEC A101", tag: "Sala găsită", tone: "bg-emerald-100 text-emerald-800" },
  { time: "Mâine 09:00", title: "Examen · Rezistența materialelor", where: "sala MEC 204", tag: "Examen detectat", tone: "bg-red-100 text-red-800" },
  { time: "Joi 10–12", title: "Liber", where: "bun pentru ședința de club", tag: "Timp liber găsit", tone: "bg-amber-100 text-amber-900" },
  { time: "🔔", title: "Reminder cu 2 ore înainte", where: "și alarmă în calendarul telefonului", tag: "Reminder setat", tone: "bg-brand-100 text-brand-700" },
];

/** Questions Poli answers from the student's own timetable. */
const ASKS = ["📅 Ce am mâine?", "📍 Unde am examenul?", "☕ Când sunt liber joi?", "👯 Când e liberă grupa lui Andrei?", "🧭 Cum ajung la sala următoare?", "🎾 Când pot juca tenis săptămâna asta?"];

const STEPS = [
  { n: "1", title: "Alegi grupa", text: "Facultatea, anul și grupa. Două minute, o singură dată." },
  { n: "2", title: "Poli face calendarul", text: "Cursuri, laboratoare, examene și sălile lor, din orarele publicate de facultate." },
  { n: "3", title: "Ești mereu la timp", text: "Remindere înainte de examene și răspunsuri la orice întrebare despre săptămâna ta." },
];

/** What signed-out visitors see: one short page about UPT Orar, with Poli at work. */
export default async function WelcomePage() {
  if (await getUser()) redirect("/");

  return (
    <div lang="ro" className={`${serif.variable} flex min-h-full flex-1 flex-col bg-[#fbf8f1] text-[#14213d]`}>
      <header>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5">
          <Mascot size={36} chat={false} />
          <span className="font-semibold tracking-tight">
            UPT <span className="text-brand-600">Orar</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">
              <span className="sm:hidden">Intră</span>
              <span className="hidden sm:inline">Intră în cont</span>
            </Link>
            <Link href="/register" className="rounded-full bg-[#14213d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700">
              <span className="sm:hidden">Cont nou</span>
              <span className="hidden sm:inline">Creează-ți contul</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-4xl px-5 pb-10 pt-12 text-center sm:pt-20">
          <p className="inline-flex items-center gap-2 rounded-full border border-[#14213d]/10 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Asistentul tău de orar · UPT
          </p>
          <h1 className="mt-6 text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
            Tu ai planul.
            <br />
            <em className="font-[family-name:var(--font-serif)] text-[1.08em] font-normal italic tracking-normal text-brand-600">Poli are calendarul.</em>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
            De la cursuri la planuri cu prietenii: AI-ul care-ți organizează ziua și-ți face loc pentru ce contează.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/register" className="rounded-full bg-[#14213d] px-7 py-3.5 text-base font-semibold text-white shadow-[0_10px_30px_-10px_rgba(20,33,61,0.6)] transition hover:-translate-y-0.5 hover:bg-brand-700">
              Creează-ți contul
            </Link>
            <Link href="/login" className="rounded-full border border-[#14213d]/15 bg-white px-7 py-3.5 text-base font-semibold transition hover:border-[#14213d]/40">
              Am deja cont
            </Link>
          </div>
        </section>

        {/* Poli at work: the mess goes in, a clear week comes out */}
        <section className="mx-auto max-w-6xl px-5 pb-16" aria-label="Cum lucrează Poli">
          <div className="lp-stage relative overflow-hidden rounded-[2rem] border border-[#14213d]/10 bg-white p-6 shadow-[0_40px_80px_-40px_rgba(20,33,61,0.35)] sm:p-10">
            <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 md:grid-cols-[1fr_auto_1.2fr]">
              {/* Before */}
              <div>
                <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Înainte</p>
                <div className="relative h-56 md:h-72">
                  {MESS.map((m, i) => (
                    <span
                      key={m.text}
                      className="lp-chip absolute whitespace-nowrap rounded-xl border border-slate-200 bg-[#fbf8f1] px-3 py-2 text-sm text-slate-600 shadow-sm"
                      style={{ top: m.top, left: m.left, "--tx": m.tx, "--ty": m.ty, "--d": `${i * 0.25}s` } as React.CSSProperties}
                    >
                      {m.text}
                    </span>
                  ))}
                </div>
              </div>

              {/* Poli */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <span aria-hidden className="lp-ring absolute inset-0 rounded-full" />
                  <span aria-hidden className="lp-ring lp-ring-2 absolute inset-0 rounded-full" />
                  <div className="lp-poli relative rounded-full bg-[#fbf8f1] p-4">
                    <Mascot size={112} chat={false} />
                  </div>
                </div>
                <p className="lp-label rounded-full bg-[#14213d] px-3 py-1 text-xs font-semibold text-white">Poli se ocupă ✨</p>
              </div>

              {/* After */}
              <div>
                <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Cu Poli</p>
                <ul className="space-y-2.5">
                  {TIDY.map((t, i) => (
                    <li
                      key={t.tag}
                      className="lp-card flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                      style={{ "--d": `${i * 0.35}s` } as React.CSSProperties}
                    >
                      <span className="w-20 shrink-0 text-xs font-semibold text-slate-500">{t.time}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{t.title}</span>
                        <span className="block truncate text-xs text-slate-500">{t.where}</span>
                      </span>
                      <span className={`hidden shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold sm:inline ${t.tone}`}>{t.tag}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Just ask Poli */}
        <section className="mx-auto max-w-4xl px-5 pb-16 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Întreabă-l pe Poli <em className="font-[family-name:var(--font-serif)] font-normal italic text-brand-600">orice.</em>
          </h2>
          <ul className="mt-8 flex flex-wrap justify-center gap-3">
            {ASKS.map((q, i) => (
              <li
                key={q}
                className="lp-ask rounded-full border border-[#14213d]/10 bg-white px-4 py-2.5 text-base shadow-sm"
                style={{ "--d": `${i * 0.12}s` } as React.CSSProperties}
              >
                {q}
              </li>
            ))}
          </ul>
          <div className="mt-6 inline-flex items-end gap-2 text-left">
            <Mascot size={44} chat={false} />
            <p className="mb-2 rounded-2xl rounded-bl-md bg-brand-600 px-4 py-2.5 text-sm text-white shadow-md">
              Joi ai liber de la 10:00. Pun cafeaua cu prietenii atunci? ☕
            </p>
          </div>
        </section>

        {/* Three steps */}
        <section className="mx-auto grid max-w-6xl gap-5 px-5 pb-16 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-3xl border border-[#14213d]/10 bg-white p-6">
              <span className="font-[family-name:var(--font-serif)] text-4xl italic text-brand-600">{s.n}</span>
              <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 leading-relaxed text-slate-600">{s.text}</p>
            </div>
          ))}
        </section>

        {/* Closing */}
        <section className="px-5 pb-14">
          <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-6 overflow-hidden rounded-[2rem] bg-[#14213d] px-8 py-14 text-center text-white">
            <div aria-hidden className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-brand-600/30" />
            <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-16 h-64 w-64 rounded-full bg-amber-300/15" />
            <Mascot size={72} wave chat={false} />
            <h2 className="relative text-3xl font-semibold tracking-tight sm:text-5xl">
              Tu ai grijă de tine.
              <br />
              <em className="font-[family-name:var(--font-serif)] font-normal italic text-amber-300">Poli are grijă de rest.</em>
            </h2>
            <Link href="/register" className="relative rounded-full bg-amber-300 px-7 py-3.5 font-semibold text-[#14213d] transition hover:-translate-y-0.5 hover:bg-amber-200">
              Creează-ți contul
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#14213d]/10">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-5 text-sm text-slate-500">
          <span>UPT Orar · orare din documentele publicate pe upt.ro</span>
          <span>Poli înțelege română și engleză</span>
        </div>
      </footer>
    </div>
  );
}

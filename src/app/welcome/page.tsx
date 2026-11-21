import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Mascot } from "@/components/Mascot";
import { getUser } from "@/lib/auth";
import { landingStats, roCount } from "@/lib/landing";

export const metadata: Metadata = {
  title: "Orarul tău, gata făcut",
  description: "UPT Orar transformă orarele publicate de facultăți în calendarul tău, cu examene, remindere și Poli, asistentul care îți răspunde în română.",
};

// The numbers come from the database at request time.
export const dynamic = "force-dynamic";

const WEEK = [
  { h: "08–10", days: [["MEC", "curs", "A101"], ["RM", "curs", "A102"], null, ["PC", "curs", "A101"], null] },
  { h: "10–12", days: [["AM", "seminar", "204"], null, ["FIZ", "curs", "ASPC 1"], null, ["SM", "seminar", "206"]] },
  { h: "12–14", days: [null, ["DT", "lab", "310"], null, null, null] },
  { h: "14–16", days: [null, null, ["FIZ", "lab", "ASPC L2"], null, null] },
] as const;
const DAYS = ["Luni", "Marți", "Miercuri", "Joi", "Vineri"];

const ASKS = [
  { tag: "Azi", q: "„Ce urmează și unde?”" },
  { tag: "Examene", q: "„Unde am examenul la Mecanică?”" },
  { tag: "Timp liber", q: "„Când sunt liber joi?”" },
  { tag: "Prieteni", q: "„Când e liberă grupa TI 3.2?”" },
  { tag: "Drum", q: "„Cum ajung la sala următoare?”" },
  { tag: "Orarul tău", q: "„Ascunde cursul de la ora 8.”" },
];

const FAQ = [
  {
    q: "Pot pune orarul în Google Calendar?",
    a: "Da. Din Settings descarci fișierul .ics sau copiezi linkul de abonare, pe care îl adaugi în Google Calendar, Apple Calendar sau Outlook. Examenele vin cu alarme cu o zi și cu 2 ore înainte.",
  },
  { q: "Colegii îmi văd modificările?", a: "Nu. Ce muți, ascunzi sau adaugi apare doar în calendarul tău. Orarul grupei rămâne cel publicat de facultate." },
  {
    q: "Ce se întâmplă când facultatea schimbă orarul?",
    a: "Orarele se reîncarcă de pe site-urile facultăților. Modificările tale personale rămân acolo unde ora și sala nu s-au schimbat.",
  },
  { q: "Pot muta sau ascunde o oră?", a: "Da, din calendar sau cerându-i lui Poli: „Mută laboratorul de miercuri pe vineri.” Schimbarea apare doar în calendarul tău, nu și în al grupei." },
  { q: "Cum aflu în ce sală am examenul?", a: "Pe pagina Exams și în clopoțelul din antet: fiecare examen are sala, clădirea și un link spre hartă. Poli îți spune și la ce oră să fii acolo." },
  { q: "Funcționează pe telefon?", a: "Da. Pagina se adaptează la ecran, iar pe telefon poți întreba și cu vocea." },
];

/** What signed-out visitors see: what UPT Orar does, in Romanian, with Poli. */
export default async function WelcomePage() {
  if (await getUser()) redirect("/");
  const stats = landingStats();
  const hasData = stats.classes > 0 || stats.exams > 0;

  return (
    <div lang="ro" className="bg-[#f7f8fc] text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
          <div className="flex items-center gap-2">
            <Mascot size={36} chat={false} />
            <span className="font-semibold tracking-tight">
              UPT <span className="text-brand-600">Orar</span>
            </span>
          </div>
          <nav className="ml-6 hidden items-center gap-6 text-sm text-slate-600 md:flex">
            <a href="#ce-face" className="hover:text-slate-900">Ce face</a>
            <a href="#examene" className="hover:text-slate-900">Examene</a>
            <a href="#facultati" className="hover:text-slate-900">Facultăți</a>
            <a href="#intrebari" className="hover:text-slate-900">Întrebări</a>
          </nav>
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

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-[#fff4dc]" />
        <div aria-hidden className="pointer-events-none absolute -left-40 top-40 h-[26rem] w-[26rem] rounded-full bg-brand-50" />
        <div className="relative mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-5 pb-24 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pb-32 lg:pt-20">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Pentru studenții Politehnicii Timișoara</p>
            <h1 className="mt-4 text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl">
              Orarul tău,
              <br />
              <span className="bg-[linear-gradient(transparent_62%,#fde68a_62%)] px-1">gata făcut.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
              UPT Orar citește orarele publicate de facultate și le transformă în calendarul tău: grupa ta, laboratoarele tale, săptămânile pare și impare. Apoi îl întrebi pe Poli când ești liber sau unde ai examenul.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn-primary rounded-full px-6 py-3 text-base">Creează-ți contul</Link>
              <a href="#ce-face" className="btn-secondary rounded-full px-6 py-3 text-base">Vezi cum funcționează</a>
            </div>
            {hasData && (
              <p className="mt-6 text-sm text-slate-500">
                Acum în aplicație:{" "}
                {stats.classes > 0 && <b className="text-slate-700">{roCount(stats.classes, "oră", "ore")}</b>}
                {stats.classes > 0 && stats.exams > 0 && " și "}
                {stats.exams > 0 && <b className="text-slate-700">{roCount(stats.exams, "examen", "examene")}</b>}{" "}
                {stats.classes + stats.exams === 1 ? "importat" : "importate"}
                {[...stats.imported, ...stats.examsOnly].length ? ` de la ${[...stats.imported, ...stats.examsOnly].join(", ")}` : ""}.
                {stats.linked.length ? ` Pentru ${stats.linked.join(", ")} găsești linkuri către documentele publicate.` : ""}
              </p>
            )}
          </div>

          {/* A week, as the app shows it, with Poli answering */}
          <div className="relative">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_60px_-20px_rgba(20,36,87,0.35)]">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm">
                <span className="font-semibold">Săptămâna 8 · impară</span>
                <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">Exemplu · anul 1</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] text-left text-xs">
                  <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Ora</th>
                      {DAYS.map((d) => <th key={d} className="px-2 py-2 font-medium">{d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {WEEK.map((row) => (
                      <tr key={row.h} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-slate-500">{row.h}</td>
                        {row.days.map((c, i) =>
                          c ? (
                            <td key={i} className="px-1.5 py-1.5">
                              <div className={`rounded-lg border-l-4 px-2 py-1.5 ${c[1] === "lab" ? "border-amber-400 bg-amber-50" : c[1] === "seminar" ? "border-emerald-500 bg-emerald-50" : "border-brand-500 bg-brand-50"}`}>
                                <b className="block">{c[0]}</b>
                                <span className="text-slate-600">{c[1]} · {c[2]}</span>
                              </div>
                            </td>
                          ) : (
                            <td key={i} className="px-1.5 py-1.5">
                              <div className="rounded-lg border border-dashed border-amber-300 bg-[#fffbeb] px-2 py-2.5 text-center text-amber-700">liber</div>
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-slate-100 px-4 py-2 font-mono text-[11px] text-slate-500">Exemplu de orar · laboratoarele pe care le alegi se adaugă în calendarul tău</p>
            </div>
            {/* Poli's bubble */}
            <div className="mt-4 flex max-w-xs items-end gap-2 lg:absolute lg:-bottom-24 lg:-left-10 lg:mt-0">
              <Mascot size={64} wave chat={false} />
              <div className="mb-6 rounded-2xl rounded-bl-md border border-brand-100 bg-white px-4 py-3 text-sm shadow-lg">
                <p className="font-semibold text-slate-900">Joi ai liber de la 10:00. ☕</p>
                <p className="text-slate-600">Vrei să pun ceva atunci?</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What it does */}
      <section id="ce-face" className="scroll-mt-16 border-y border-slate-200/70 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">Știe deja semestrul, ca să nu mai cauți tu.</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { icon: "📅", t: "Săptămâna corectă, mereu", d: "Săptămâni de predare, vacanța de iarnă, săptămâni pare și impare, cursuri doar în anumite săptămâni. Vezi exact ce se ține săptămâna asta." },
              { icon: "💬", t: "Îl întrebi pe Poli", d: "„Ce am mâine?” „Unde am examenul?” Scrii sau vorbești, în română sau engleză, iar răspunsul vine din orarul tău, cu sala și clădirea." },
              { icon: "✏️", t: "Orarul pe gustul tău", d: "Ascunzi un curs, muți un laborator sau adaugi ședința de club. Totul rămâne doar în calendarul tău; orarul grupei nu se schimbă." },
            ].map((f) => (
              <div key={f.t} className="rounded-3xl border border-slate-200 bg-[#f7f8fc] p-6">
                <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">{f.icon}</span>
                <h3 className="mt-4 text-lg font-semibold">{f.t}</h3>
                <p className="mt-2 leading-relaxed text-slate-600">{f.d}</p>
              </div>
            ))}
          </div>

          {/* Add events */}
          <div className="mt-16 grid grid-cols-[minmax(0,1fr)] items-center gap-10 lg:grid-cols-2">
            <div className="order-2 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:order-1">
              <div className="grid grid-cols-[3rem_1fr_1fr] text-xs">
                <div />
                <div className="border-b border-slate-100 px-2 pb-2 font-semibold text-slate-500">MIE 25</div>
                <div className="border-b border-slate-100 px-2 pb-2 font-semibold text-slate-500">JOI 26</div>
                {["16:00", "17:00", "18:00", "19:00"].map((h, i) => (
                  <div key={h} className="contents">
                    <div className="h-14 pr-2 pt-1 text-right font-mono text-slate-400">{h}</div>
                    <div className="relative h-14 border-l border-t border-slate-100">
                      {i === 0 && <div className="absolute inset-x-1 top-1 h-[6.5rem] rounded-lg border-l-4 border-amber-400 bg-amber-50 px-2 py-1"><b>Lab FIZ</b><span className="block text-slate-600">16:00–18:00</span></div>}
                    </div>
                    <div className="relative h-14 border-l border-t border-slate-100">
                      {i === 2 && <div className="absolute inset-x-1 top-1 h-[6.5rem] rounded-lg border-2 border-dashed border-violet-500 bg-violet-100/80 px-2 py-1 font-semibold text-violet-900">＋ 18:00–20:00<span className="block font-normal">Ședință MechaFusion</span></div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Calendar interactiv</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight">Un clic și ai pus ședința în calendar.</h2>
              <p className="mt-4 text-lg leading-relaxed text-slate-600">
                Apasă pe o oră liberă sau trage cu mouse-ul cât durează. Formularul vine deja completat cu ziua și ora: scrii doar titlul. O dată sau în fiecare săptămână.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Exams */}
      <section id="examene" className="scroll-mt-16">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-5 py-20 lg:grid-cols-2">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-brand-600">Examene și remindere</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Știi mereu în ce sală ai examenul.</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Fiecare examen are numărătoarea inversă, sala, clădirea și harta. Cât timp aplicația e deschisă, clopoțelul te anunță cu o săptămână, o zi, 2 ore și 30 de minute înainte, iar Poli îți dă un sfat potrivit: de la planul de recapitulare până la ora la care să pleci.
            </p>
            <ul className="mt-6 space-y-2 text-slate-700">
              <li className="flex gap-2"><span aria-hidden className="text-brand-600">→</span>Alarme cu o zi și cu 2 ore înainte în calendarul telefonului (Google, Apple, Outlook), chiar și cu aplicația închisă.</li>
              <li className="flex gap-2"><span aria-hidden className="text-brand-600">→</span>Cauți orice examen al facultății după materie, profesor sau sală.</li>
            </ul>
          </div>
          <div className="relative space-y-4">
            <div className="ml-auto flex max-w-md items-start gap-3 rounded-2xl border border-brand-100 bg-white p-3 shadow-xl">
              <Mascot size={40} chat={false} />
              <div className="text-sm">
                <p className="font-semibold">📝 Mecanică începe în 30 min</p>
                <p className="text-slate-600">Mergi în sala MEC A101 · Facultatea de Mecanică. Baftă! 🍀</p>
              </div>
            </div>
            <article className="rounded-3xl border border-red-200 bg-white p-5 shadow-[0_8px_30px_-10px_rgba(220,38,38,0.25)]">
              <div className="flex items-start gap-3">
                <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-red-50 text-red-700">
                  <span className="text-[10px] font-semibold uppercase">ian</span>
                  <span className="text-xl font-bold leading-none">20</span>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">Rezistența materialelor <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">mâine</span></p>
                  <p className="text-sm text-slate-600">Marți 20 ianuarie · 09:00–11:00</p>
                  <p className="mt-1 text-sm">📍 <b>Sala MEC 204</b> <span className="text-slate-600">Facultatea de Mecanică</span> <span className="font-medium text-brand-600">Hartă ↗</span></p>
                </div>
              </div>
              <div className="mt-4 flex items-start gap-2">
                <Mascot size={28} chat={false} />
                <ul className="flex-1 space-y-1 rounded-2xl rounded-tl-md bg-brand-50 px-3 py-2 text-sm text-slate-700">
                  <li>• O recapitulare ușoară, fără capitole noi în seara asta.</li>
                  <li>• Verifică drumul până la sală și pune o alarmă din timp.</li>
                  <li>• Dormi cel puțin 7 ore. 😴</li>
                </ul>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* Questions students ask */}
      <section className="bg-brand-900 text-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="flex items-center gap-4">
            <Mascot size={56} wave chat={false} />
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ce îl întreabă studenții pe Poli</h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ASKS.map((a) => (
              <div key={a.tag} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">{a.tag}</p>
                <p className="mt-2 text-lg font-medium">{a.q}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-brand-100">Scrii sau apeși pe microfon și vorbești, în română sau în engleză: alegi limba dintr-un buton, iar Poli îți poate citi răspunsul cu voce tare.</p>
        </div>
      </section>

      {/* Faculties */}
      <section id="facultati" className="scroll-mt-16 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-bold tracking-tight">Facultăți</h2>
          <p className="mt-3 max-w-2xl text-slate-600">
            Orarele publicate ca tabel sunt importate direct. Unde facultatea publică doar PDF-uri, vezi linkurile către documente, iar restul aplicației funcționează la fel: evenimente proprii, export și Poli.
          </p>
          <div className="mt-8 space-y-3">
            {stats.imported.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-44 font-mono text-[11px] uppercase tracking-wide text-slate-500">Orar importat</span>
                {stats.imported.map((f) => <span key={f} className="rounded-xl border-2 border-brand-600 bg-brand-50 px-3 py-1 font-semibold text-brand-700">{f}</span>)}
              </div>
            )}
            {stats.examsOnly.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-44 font-mono text-[11px] uppercase tracking-wide text-slate-500">Doar examene importate</span>
                {stats.examsOnly.map((f) => <span key={f} className="rounded-xl border border-brand-300 bg-white px-3 py-1 font-medium text-brand-700">{f}</span>)}
              </div>
            )}
            {stats.linked.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-44 font-mono text-[11px] uppercase tracking-wide text-slate-500">Linkuri către documente</span>
                {stats.linked.map((f) => <span key={f} className="rounded-xl border border-dashed border-slate-300 px-3 py-1 text-slate-600">{f}</span>)}
              </div>
            )}
            {stats.pending.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-44 font-mono text-[11px] uppercase tracking-wide text-slate-500">Încă fără orar</span>
                {stats.pending.map((f) => <span key={f} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 text-slate-500">{f}</span>)}
              </div>
            )}
            {!stats.imported.length && !stats.examsOnly.length && !stats.linked.length && !stats.pending.length && <p className="text-slate-600">Lista facultăților apare după primul import al orarelor.</p>}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="intrebari" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-bold tracking-tight">Întrebări</h2>
          <div className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
            {FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="font-semibold">{f.q}</h3>
                <p className="mt-2 leading-relaxed text-slate-600">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section className="px-5 pb-16">
        <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-6 overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-600 to-brand-500 px-8 py-12 text-white sm:flex-row sm:items-center sm:px-12">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div className="relative flex-1">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Configurează-ți săptămâna în cinci minute.</h2>
            <p className="mt-2 text-brand-50">
              Alegi facultatea, anul și grupa.{" "}
              {stats.classes > 0 ? "Dacă orarul facultății tale e importat, cursurile sunt deja în calendar." : "Restul îl face aplicația, pe măsură ce orarele sunt importate."}
            </p>
          </div>
          <div className="relative flex items-center gap-4">
            <Link href="/register" className="rounded-full bg-amber-300 px-6 py-3 font-semibold text-brand-900 shadow-sm transition hover:bg-amber-200">Creează-ți contul</Link>
            <span className="hidden rounded-3xl bg-white/15 p-2 sm:block"><Mascot size={64} wave chat={false} /></span>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-6 text-sm text-slate-500">
          <span>UPT Orar · orare din documentele publicate pe upt.ro</span>
          <span>Poli înțelege română și engleză · pe telefon și pe calculator</span>
        </div>
      </footer>
    </div>
  );
}

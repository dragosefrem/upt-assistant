import { ArrowRight, BookOpen, Bot, Compass, GraduationCap, UsersRound } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { TimetablePreview } from "@/components/TimetablePreview";
import { getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";

export async function generateMetadata() {
  const t = await getT();
  return { title: { absolute: `${t.common.appName} · ${t.landing.title}` }, description: t.landing.hero.sub };
}

export default async function WelcomePage() {
  const [messages, user] = await Promise.all([getT(), getUser()]);
  const t = messages.landing;
  const features = [
    { text: t.features.campus, Icon: Compass, tone: "bg-emerald-50 text-emerald-800" },
    { text: t.features.contacts, Icon: UsersRound, tone: "bg-amber-50 text-amber-800" },
    { text: t.features.poli, Icon: Bot, tone: "bg-brand-50 text-brand-700" },
  ];

  return (
    <div className="welcome-page">
      <header className="border-b border-slate-200/80">
        <div className="welcome-width flex min-h-18 items-center justify-between gap-3">
          <Brand />
          <div className="flex items-center gap-2 sm:gap-5">
            <LanguageSwitch />
            <Link href={user ? "/" : "/login"} className="btn-secondary">{user ? t.nav.openApp : t.nav.signIn}</Link>
          </div>
        </div>
      </header>
      <main>
        <section className="welcome-hero welcome-width">
          <div className="hero-copy">
            <p className="flex items-center gap-2 text-sm font-semibold text-brand-700"><GraduationCap size={19} aria-hidden />{t.hero.audience}</p>
            <h1>{t.hero.headline} <em>{t.hero.accent}</em></h1>
            <p className="hero-description">{t.hero.sub}</p>
            <Link href={user ? "/" : "/register"} className="hero-cta btn-primary">
              {user ? t.nav.openApp : t.hero.cta}<ArrowRight size={18} aria-hidden />
            </Link>
            {!user && <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-600">{t.hero.note}</p>}
          </div>
          <TimetablePreview />
        </section>
        <section className="border-t border-slate-200 bg-white">
          <div className="welcome-width py-8 sm:py-11">
            <h2 className="text-2xl font-semibold tracking-tight">{t.features.heading}</h2>
            <ul className="welcome-features">
              {features.map(({ text, Icon, tone }) => (
                <li key={text.title}>
                  <span className={`feature-icon ${tone}`}><Icon size={22} strokeWidth={1.7} aria-hidden /></span>
                  <div><h3 className="font-semibold">{text.title}</h3><p className="mt-1.5 text-sm leading-relaxed text-slate-600">{text.body}</p></div>
                </li>
              ))}
            </ul>
            {user && <Link href="/guide" className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 pt-5 text-sm text-brand-700">
              <BookOpen size={18} aria-hidden /><strong>{t.guide.title}</strong> {t.guide.action}<ArrowRight size={16} aria-hidden />
            </Link>}
          </div>
        </section>
      </main>
      <footer className="welcome-width border-t border-slate-200 py-5 text-xs leading-relaxed text-slate-600">{t.source}</footer>
    </div>
  );
}

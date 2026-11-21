import { ArrowDown, ArrowRight, BookOpen, FileSpreadsheet, FileText, GraduationCap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { PoliQuestionsPreview } from "@/components/PoliQuestionsPreview";
import { TimetablePreview } from "@/components/TimetablePreview";
import { getT } from "@/i18n/server";
import { getUser } from "@/lib/auth";

export async function generateMetadata() {
  const t = await getT();
  return { title: { absolute: t.landing.title }, description: t.landing.hero.sub };
}

export default async function WelcomePage() {
  const [messages, user] = await Promise.all([getT(), getUser()]);
  const t = messages.landing;
  const action = user ? t.nav.openApp : t.hero.cta;
  const destination = user ? "/" : "/register";
  return (
    <div className="welcome-page">
      <a className="skip-link" href="#welcome-content">{messages.common.nav.skipContent}</a>
      <header className="welcome-width welcome-header">
        <Brand />
        <div className="flex items-center gap-3 sm:gap-5">
          <LanguageSwitch />
          <Link href={user ? "/" : "/login"} className="welcome-login">{user ? t.nav.openApp : t.nav.signIn}</Link>
        </div>
      </header>
      <main id="welcome-content" tabIndex={-1}>
        <section className="welcome-hero welcome-width">
          <p className="welcome-audience"><GraduationCap size={16} aria-hidden />{t.hero.audience}</p>
          <h1>{t.hero.headline}<br /><em>{t.hero.accent}</em></h1>
          <p className="hero-description">{t.hero.sub}</p>
          <div className="welcome-actions">
            <Link href={destination} className="btn-primary hero-cta">{action}<ArrowRight size={17} aria-hidden /></Link>
            <a href="#sample-week" className="btn-secondary hero-cta">{t.nav.sample}<ArrowDown size={16} aria-hidden /></a>
          </div>
        </section>

        <section id="sample-week" tabIndex={-1} className="welcome-stage welcome-width" aria-label={t.stage.title}>
          <div className="stage-input">
            <div className="stage-files">
              <p>{t.stage.before}</p>
              <ul>{t.stage.files.map((file, i) => <li key={file}>
                {i === 1 ? <FileSpreadsheet size={17} aria-hidden /> : <FileText size={17} aria-hidden />}
                <span>{file}</span>
              </li>)}</ul>
            </div>
            <div className="stage-robot" aria-hidden="true">
              <Image src="/images/mascot.svg" alt="" width={112} height={112} loading="eager" />
            </div>
          </div>
          <TimetablePreview />
        </section>

        <div className="welcome-width"><PoliQuestionsPreview /></div>
        <section className="welcome-width" aria-label={t.stepsTitle}>
          <ol className="welcome-steps">{t.steps.map((step, i) => <li key={step.title}>
            <span aria-hidden="true">{i + 1}</span>
            <h2>{step.title}</h2><p>{step.text}</p>
          </li>)}</ol>
        </section>
        <section className="welcome-closing welcome-width">
          <Image src="/images/mascot-happy.svg" width={68} height={68} alt="" />
          <h2>{t.closing.line}<br /><em>{t.closing.accent}</em></h2>
          <Link href={destination} className="btn-primary hero-cta">{action}<ArrowRight size={17} aria-hidden /></Link>
        </section>
      </main>
      <footer className="welcome-width welcome-footer">
        <span>{t.source}</span>
        {user && <Link href="/guide" className="inline-flex items-center gap-2 font-semibold text-brand-700"><BookOpen size={16} aria-hidden />{t.guide.action}</Link>}
      </footer>
    </div>
  );
}

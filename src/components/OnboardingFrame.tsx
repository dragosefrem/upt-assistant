import { Check } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { getT } from "@/i18n/server";
import { Brand } from "./Brand";
import { LanguageSwitch } from "./LanguageSwitch";

export async function OnboardingFrame({ step, heading, children }: { step: 2 | 3; heading: React.ReactNode; children: React.ReactNode }) {
  const o = (await getT()).onboarding;
  const steps = [o.steps.account, o.steps.group, o.steps.courses];
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="welcome-width flex min-h-16 items-center justify-between gap-2">
          <Brand />
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <form action={logoutAction}><button className="btn-ghost">{o.signOut}</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-12 sm:pt-9">
        <ol className="setup-steps" aria-label={o.stepOf(step, steps.length)}>
          {steps.map((label, i) => (
            <li key={label} aria-current={i + 1 === step ? "step" : undefined} data-done={i + 1 < step}>
              <span>{i + 1 < step && <Check size={14} aria-hidden />}{label}</span>
            </li>
          ))}
        </ol>
        <header className="page-heading my-5">{heading}</header>
        {children}
      </main>
    </div>
  );
}

import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { getT } from "@/i18n/server";
import { LanguageSwitch } from "./LanguageSwitch";
import { Mascot } from "./Mascot";

/**
 * The page frame for setting up an account: brand, language, sign out, and where the
 * student is among the steps. `step` is 2 (group) or 3 (courses); step 1, the account,
 * is already done.
 */
export async function OnboardingFrame({ step, bubble, children }: { step: 2 | 3; bubble: React.ReactNode; children: React.ReactNode }) {
  const t = await getT();
  const o = t.onboarding;
  const steps = [o.steps.account, o.steps.group, o.steps.courses, o.steps.ready];
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-4">
        <Link href="/" className="font-semibold tracking-tight text-slate-900">
          <span className="text-brand-600">{t.common.appName}</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitch />
          <form action={logoutAction}>
            <button className="btn-ghost px-2.5 text-sm">{o.signOut}</button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16">
        <ol className="mb-6 flex items-center gap-1.5 sm:gap-2" aria-label={o.stepOf(step, steps.length)}>
          {steps.map((label, i) => {
            const n = i + 1;
            const state = n < step ? "done" : n === step ? "current" : "todo";
            return (
              <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2" aria-current={state === "current" ? "step" : undefined}>
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    state === "done" ? "bg-emerald-500 text-white" : state === "current" ? "bg-brand-600 text-white ring-4 ring-brand-100" : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {state === "done" ? "✓" : n}
                </span>
                <span className={`truncate text-xs font-medium sm:text-sm ${state === "current" ? "text-slate-900" : "text-slate-500"} ${state === "current" ? "" : "max-sm:sr-only"}`}>{label}</span>
                {n < steps.length && <span aria-hidden className={`h-0.5 min-w-3 flex-1 rounded ${n < step ? "bg-emerald-400" : "bg-slate-200"}`} />}
              </li>
            );
          })}
        </ol>

        <div className="mb-5 flex items-start gap-3">
          <div className="shrink-0 rounded-2xl bg-white p-1.5 shadow-[0_8px_24px_-10px_rgba(31,72,196,0.45)]">
            <Mascot size={52} wave chat={false} />
          </div>
          <div className="card rounded-tl-md px-4 py-3">{bubble}</div>
        </div>
        {children}
      </main>
    </div>
  );
}

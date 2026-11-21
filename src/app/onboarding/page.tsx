import Link from "next/link";
import { saveProfileAction } from "./actions";
import { OnboardingFrame } from "@/components/OnboardingFrame";
import { ProfilePicker } from "@/components/ProfilePicker";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { pickerData } from "@/lib/catalog";

export async function generateMetadata() {
  return { title: (await getT()).onboarding.profile.title };
}

export default async function OnboardingPage() {
  const user = await requireUser();
  const t = (await getT()).onboarding.profile;
  const data = pickerData();
  return (
    <OnboardingFrame
      step={2}
      bubble={
        <>
          <p className="text-sm font-semibold text-brand-700">{t.hello(user.name.split(/\s+/)[0] || user.name)}</p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{t.heading}</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{t.intro}</p>
        </>
      }
    >
      {user.role === "admin" && data.groups.length === 0 && (
        <p className="mb-5 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          {t.adminEmpty} <Link href="/admin" className="font-semibold underline">{t.adminLink}</Link>
          {t.adminAfter}
        </p>
      )}
      <div className="card p-5 sm:p-6">
        <ProfilePicker
          data={data}
          initial={{ facultyId: user.facultyId, specializationId: user.specializationId, year: user.year, groupId: user.groupId }}
          action={saveProfileAction}
          submitLabel={t.submit}
        />
      </div>
      <details className="card mt-4 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-800">💡 {t.helpTitle}</summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed text-slate-600">
          {t.help.map((line) => (<li key={line}>{line}</li>))}
        </ul>
      </details>
    </OnboardingFrame>
  );
}

import { redirect } from "next/navigation";
import { CourseChoicesForm } from "@/components/CourseChoicesForm";
import { OnboardingFrame } from "@/components/OnboardingFrame";
import { getLocale, getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth";
import { courseChoices, currentSemester, describeGroup } from "@/lib/schedule";

export async function generateMetadata() {
  return { title: (await getT()).onboarding.courses.title };
}

export default async function OnboardingCoursesPage() {
  const user = await requireUser();
  const semester = currentSemester();
  if (!semester || !user.groupId) redirect("/onboarding");
  const [messages, locale] = await Promise.all([getT(), getLocale()]);
  const t = messages.onboarding.courses;
  const group = describeGroup(user.groupId, locale);
  return (
    <OnboardingFrame
      step={3}
      bubble={
        <>
          <p className="text-sm font-semibold text-brand-700">
            {group ? `${group.spec.name} · ${messages.common.time.year(group.group.year)} · ${group.label}` : t.almostDone}
          </p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{t.heading}</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{t.intro}</p>
        </>
      }
    >
      <div className="card p-5 sm:p-6">
        <CourseChoicesForm choices={courseChoices(user, semester)} returnTo="/" submitLabel={t.submit} />
      </div>
    </OnboardingFrame>
  );
}

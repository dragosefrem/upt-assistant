import { redirect } from "next/navigation";
import { CourseChoicesForm } from "@/components/CourseChoicesForm";
import { requireUser } from "@/lib/auth";
import { courseChoices, currentSemester, describeGroup } from "@/lib/schedule";

export const metadata = { title: "Choose your courses" };

export default async function OnboardingCoursesPage() {
  const user = await requireUser();
  const semester = currentSemester();
  if (!semester || !user.groupId) redirect("/onboarding");
  const group = describeGroup(user.groupId);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <p className="text-sm font-medium text-brand-600">
        {group ? `${group.spec.name} · year ${group.group.year} · ${group.label}` : "Almost done"}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Choose your courses</h1>
      <p className="mb-8 mt-2 text-sm text-slate-600">
        From year 3 onwards part of the curriculum is elective, and some labs run in several slots. Pick what you follow so your calendar only shows your own classes.
      </p>
      <div className="card p-6">
        <CourseChoicesForm choices={courseChoices(user, semester)} returnTo="/" submitLabel="Finish" />
      </div>
    </main>
  );
}

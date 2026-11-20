import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import { saveProfileAction } from "./actions";
import { ProfilePicker } from "@/components/ProfilePicker";
import { requireUser } from "@/lib/auth";
import { pickerData } from "@/lib/catalog";

export const metadata = { title: "Set up your timetable" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const data = pickerData();
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <p className="text-sm font-medium text-brand-600">Welcome, {user.name.split(" ")[0]}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Set up your timetable</h1>
      <p className="mb-8 mt-2 text-sm text-slate-600">
        Tell us where you study and we will load the right classes and exams. You can change this later in Settings.
      </p>
      {user.role === "admin" && data.groups.length === 0 && (
        <p className="mb-6 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          You are the administrator of this installation and no timetables have been imported yet.{" "}
          <Link href="/admin" className="font-semibold underline">Open the admin page and run the UPT scrape</Link>, then come back
          to pick your group.
        </p>
      )}
      <div className="card p-6">
        <ProfilePicker
          data={data}
          initial={{ facultyId: user.facultyId, specializationId: user.specializationId, year: user.year, groupId: user.groupId }}
          action={saveProfileAction}
          submitLabel="Continue"
        />
      </div>
      <form action={logoutAction} className="mt-6 text-center">
        <button className="text-sm text-slate-500 hover:text-slate-700 hover:underline">Sign out</button>
      </form>
    </main>
  );
}

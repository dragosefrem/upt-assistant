import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  if (await getUser()) redirect("/");
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-lg font-bold text-white">U</div>
          <h1 className="text-2xl font-semibold tracking-tight">UPT Orar</h1>
          <p className="mt-1 text-sm text-slate-600">Your timetable, exams and study assistant at Politehnica Timișoara.</p>
        </div>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}

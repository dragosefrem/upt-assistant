import Link from "next/link";
import { redirect } from "next/navigation";
import { Mascot } from "@/components/Mascot";
import { getUser } from "@/lib/auth";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  if (await getUser()) redirect("/");
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-white shadow-[0_8px_30px_-8px_rgba(31,72,196,0.35)]">
            <Mascot size={72} wave chat={false} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Hi, I&apos;m Poli! 👋</h1>
          <p className="mt-1 text-sm text-slate-600">Your timetable, exams and study buddy at Politehnica Timișoara.</p>
        </div>
        <div className="card p-6">{children}</div>
        <p className="mt-4 text-center text-sm">
          <Link href="/welcome" className="text-slate-500 hover:text-brand-600">← What is UPT Orar?</Link>
        </p>
      </div>
    </main>
  );
}

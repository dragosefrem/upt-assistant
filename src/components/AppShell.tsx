import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import type { User } from "@/lib/auth";
import { LocationProvider } from "./LocationProvider";
import { NavLink } from "./NavLink";

/** Header and page frame shared by the student pages and the admin area. */
export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  return (
    <LocationProvider>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1500px] items-center gap-1 px-4">
          <Link href="/" className="mr-1 flex shrink-0 items-center gap-2 font-semibold tracking-tight text-slate-900 sm:mr-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">U</span>
            <span className="hidden sm:inline">UPT Orar</span>
          </Link>
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm sm:gap-1">
            <NavLink href="/">Calendar</NavLink>
            <NavLink href="/exams">Exams</NavLink>
            <NavLink href="/settings">Settings</NavLink>
            {user.role === "admin" && <NavLink href="/admin">Admin</NavLink>}
          </nav>
          <span className="hidden text-sm text-slate-600 md:inline">{user.name}</span>
          <form action={logoutAction}>
            <button className="btn-ghost whitespace-nowrap px-2 sm:px-3.5">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-4 py-5">{children}</main>
    </LocationProvider>
  );
}

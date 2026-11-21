import Link from "next/link";
import { logoutAction } from "@/app/(auth)/actions";
import type { User } from "@/lib/auth";
import { LocationProvider } from "./LocationProvider";
import { Mascot } from "./Mascot";
import { NavLink } from "./NavLink";
import { NotificationBell } from "./NotificationBell";
import { PoliChat } from "./PoliChat";

/** Header and page frame shared by the student pages and the admin area. */
export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  return (
    <LocationProvider>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1500px] items-center gap-1 px-4">
          <div className="mr-1 flex shrink-0 items-center gap-2 sm:mr-3">
            <Mascot size={34} />
            <Link href="/" className="hidden font-semibold tracking-tight text-slate-900 sm:inline">
              <span className="text-brand-600">Poli</span>
            </Link>
          </div>
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm sm:gap-1">
            <NavLink href="/" icon="📅">Calendar</NavLink>
            <NavLink href="/exams" icon="📝">Exams</NavLink>
            <NavLink href="/settings" icon="⚙️">Settings</NavLink>
            {user.role === "admin" && <NavLink href="/admin" icon="🛠️">Admin</NavLink>}
          </nav>
          <NotificationBell />
          <span className="hidden items-center gap-2 text-sm text-slate-700 md:flex">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800">
              {user.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
            {user.name}
          </span>
          <form action={logoutAction}>
            <button className="btn-ghost whitespace-nowrap px-2 sm:px-3.5">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-4 pb-32 pt-5">{children}</main>
      <PoliChat />
    </LocationProvider>
  );
}

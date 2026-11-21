import Link from "next/link";
import { getT } from "@/i18n/server";
import type { User } from "@/lib/auth";
import { incomingContactCount } from "@/lib/contacts";
import { groupInviteCount } from "@/lib/group-events";
import { LocationProvider } from "./LocationProvider";
import { Mascot } from "./Mascot";
import { NavLink } from "./NavLink";
import { NotificationBell } from "./NotificationBell";
import { PoliChat } from "./PoliChat";
import { UserMenu } from "./UserMenu";

/** Header and page frame shared by the student pages and the admin area. */
export async function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const t = await getT();
  const invites = incomingContactCount(user.id) + groupInviteCount(user.id);
  return (
    <LocationProvider>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1500px] items-center gap-1 px-3 sm:px-4">
          <div className="mr-1 flex shrink-0 items-center gap-2 lg:mr-3">
            <Mascot size={34} />
            <Link href="/" className="hidden font-semibold tracking-tight text-slate-900 lg:inline">
              UPT <span className="text-brand-600">Orar</span>
            </Link>
          </div>
          <nav aria-label={t.common.appName} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm sm:gap-1">
            <NavLink href="/" icon="📅">{t.common.nav.calendar}</NavLink>
            <NavLink href="/exams" icon="📝">{t.common.nav.exams}</NavLink>
            <NavLink href="/attendance" icon="✅">{t.common.nav.attendance}</NavLink>
            <NavLink href="/contacts" icon="👥" badge={invites} badgeLabel={t.common.nav.invitations(invites)}>{t.common.nav.contacts}</NavLink>
            <NavLink href="/campus" icon="🧭">{t.common.nav.campus}</NavLink>
            <NavLink href="/guide" icon="🎓">{t.common.nav.guide}</NavLink>
          </nav>
          <NotificationBell />
          <UserMenu name={user.name} email={user.email} admin={user.role === "admin"} />
        </div>
      </header>
      <main id="student-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col px-3 pb-8 pt-5 sm:px-4 sm:pb-32">{children}</main>
      <PoliChat />
    </LocationProvider>
  );
}

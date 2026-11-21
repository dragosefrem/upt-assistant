import { getT } from "@/i18n/server";
import type { User } from "@/lib/auth";
import { incomingContactCount } from "@/lib/contacts";
import { groupInviteCount } from "@/lib/group-events";
import { MainContent } from "./AppShell/MainContent";
import { Brand } from "./Brand";
import { LocationProvider } from "./LocationProvider";
import { NotificationBell } from "./NotificationBell";
import { PoliChat } from "./PoliChat";
import { StudentNav } from "./StudentNav";
import { UserMenu } from "./UserMenu";

export async function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const t = await getT();
  const invites = incomingContactCount(user.id) + groupInviteCount(user.id);
  return (
    <LocationProvider>
      <a href="#student-content" className="skip-link">{t.common.nav.skipContent}</a>
      <header className="app-header">
        <div className="shell-width flex min-h-16 items-center gap-2 lg:gap-5">
          <Brand />
          <StudentNav invites={invites} />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <NotificationBell />
            <UserMenu name={user.name} email={user.email} admin={user.role === "admin"} />
          </div>
        </div>
      </header>
      <MainContent id="student-content" tabIndex={-1} className="app-content shell-width">{children}</MainContent>
      <PoliChat />
    </LocationProvider>
  );
}

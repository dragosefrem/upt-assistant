import { AppShell } from "@/components/AppShell";
import { WelcomeTour } from "@/components/WelcomeTour";
import { requireOnboardedUser } from "@/lib/auth";

/** Student pages: signed in and finished choosing faculty, year and group. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireOnboardedUser();
  return (
    <AppShell user={user}>
      {children}
      {!user.welcomeSeenAt && <WelcomeTour name={user.name} />}
    </AppShell>
  );
}

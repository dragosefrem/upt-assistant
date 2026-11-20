import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "@/lib/auth";

/**
 * The admin area does not require onboarding: on a fresh install the first admin has
 * to run a scrape before there is any faculty to choose.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireAdmin();
  return <AppShell user={user}>{children}</AppShell>;
}

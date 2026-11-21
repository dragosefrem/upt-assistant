"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  icon,
  badge = 0,
  badgeLabel,
  children,
}: {
  href: string;
  icon?: string;
  badge?: number;
  /** What the badge counts, for screen readers ("2 invitations"). */
  badgeLabel?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={typeof children === "string" ? children : undefined}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 font-medium transition xl:px-3.5 ${active ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
    >
      {icon && <span aria-hidden className="text-base leading-none">{icon}</span>}
      {/* On narrow screens only the icon shows; the name stays for screen readers. */}
      <span className={icon ? "max-md:sr-only" : undefined}>{children}</span>
      {badge > 0 && (
        <span aria-label={badgeLabel} className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${active ? "bg-white/25 text-white" : "bg-brand-100 text-brand-700"}`}>
          {badge}
        </span>
      )}
    </Link>
  );
}

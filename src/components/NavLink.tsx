"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, icon, badge = 0, children }: { href: string; icon?: string; badge?: number; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={typeof children === "string" ? children : undefined}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 font-medium transition sm:px-3.5 ${active ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
    >
      {icon && <span aria-hidden className="text-base leading-none">{icon}</span>}
      {/* On phones only the icon shows; the name stays for screen readers. */}
      <span className={icon ? "max-sm:sr-only" : undefined}>{children}</span>
      {badge > 0 && (
        <span className={`rounded-full px-1.5 text-xs font-semibold tabular-nums ${active ? "bg-white/25 text-white" : "bg-brand-100 text-brand-700"}`}>
          {badge}
        </span>
      )}
    </Link>
  );
}

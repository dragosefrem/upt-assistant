"use client";

import { BookOpen, CalendarDays, ClipboardCheck, Compass, Ellipsis, NotebookPen, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { Modal } from "./Modal";

const destinations = [
  { href: "/", key: "calendar", Icon: CalendarDays },
  { href: "/campus", key: "campus", Icon: Compass },
  { href: "/contacts", key: "contacts", Icon: UsersRound },
  { href: "/exams", key: "exams", Icon: NotebookPen },
  { href: "/attendance", key: "attendance", Icon: ClipboardCheck },
  { href: "/guide", key: "guide", Icon: BookOpen },
] as const;

export function StudentNav({ invites }: { invites: number }) {
  const t = useT().common;
  const path = usePathname();
  const [more, setMore] = useState(false);
  const active = (href: string) => path === href || path.startsWith(href + "/");
  const morePages = destinations.slice(3);

  const navItem = ({ href, Icon, key }: typeof destinations[number]) => (
    <Link key={href} href={href} className="nav-item" aria-current={active(href) ? "page" : undefined} onNavigate={() => setMore(false)}>
      <span className="relative inline-flex">
        <Icon size={18} strokeWidth={1.8} aria-hidden />
        {key === "contacts" && invites > 0 && <span className="nav-badge"><span aria-hidden>{invites}</span><span className="sr-only">{t.nav.invitations(invites)}</span></span>}
      </span>
      <span>{t.nav[key]}</span>
    </Link>
  );

  return (
    <>
      <nav className="desktop-nav" aria-label={t.appName}>{destinations.map(navItem)}</nav>
      <nav className="mobile-nav" aria-label={t.appName}>
        {destinations.slice(0, 3).map(navItem)}
        <button type="button" className="nav-item" data-active={morePages.some(({ href }) => active(href))} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}>
          <Ellipsis size={20} aria-hidden />{t.nav.more}
        </button>
      </nav>
      {more && <Modal open title={t.nav.more} onClose={() => setMore(false)}>
        <nav className="more-nav" aria-label={t.nav.more}>{morePages.map(navItem)}</nav>
      </Modal>}
    </>
  );
}

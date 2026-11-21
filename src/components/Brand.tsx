import { CalendarDays } from "lucide-react";
import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" aria-label="Poli" className="brand">
      <span className="brand-mark"><CalendarDays size={21} strokeWidth={2.1} aria-hidden /></span>
      <span>Poli</span>
    </Link>
  );
}

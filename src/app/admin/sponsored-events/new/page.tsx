import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { SponsoredComposer } from "@/components/SponsoredComposer";
import { getDb } from "@/db";
import { faculties } from "@/db/schema";
import { getT } from "@/i18n/server";
import { requireAdmin } from "@/lib/auth";
import { nowLocal } from "@/lib/time";

export async function generateMetadata() {
  return { title: (await getT()).sponsored.create };
}

export default async function NewSponsoredEventPage() {
  await requireAdmin();
  const t = (await getT()).sponsored;
  const options = getDb().select({ id: faculties.id, name: faculties.name, shortName: faculties.shortName })
    .from(faculties).orderBy(asc(faculties.name)).all();
  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <Link href="/admin/sponsored-events" className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft size={16} aria-hidden />{t.back}
      </Link>
      <header className="page-heading"><h1>{t.create}</h1></header>
      <SponsoredComposer id={randomUUID()} faculties={options} today={nowLocal().date} />
    </div>
  );
}

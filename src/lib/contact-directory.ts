import "server-only";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { groups, users } from "@/db/schema";
import type { User } from "./auth";
import { contactProfiles } from "./contacts";
import { describeGroup } from "./schedule";

// Registration accepts 80 Unicode characters, which can occupy up to 160 UTF-16 code units.
export const MAX_NAME_QUERY = 160;
const PAGE_SIZE = 8;

/** Split only timetable conventions that identify a parent group. Preserve other published labels. */
export function groupParts(label: string, faculty: string | null) {
  const name = label.trim().replace(/^(?:grup[aă]|group|gr\.)(?=\s|\d|$)\s*/iu, "");
  const written = /^(?:(.+?)\s+)?(?:semigrup[aă]|subgrup[aă]|subgroup|sgr\.?)\s*(\w+)\s*[-‐–]?$/iu.exec(name);
  if (written) return { group: written[1] ?? null, subgroup: written[2] };

  // FIH publishes the fraction within one programme-year group (e.g. 1/3, 2/3, 3/3).
  if (faculty === "FIH" && /^\d+\/\d+$/.test(name)) return { group: null, subgroup: name };
  const numbered = /^(?:(\d+)\s+)?(\d+)([./]\d+)$/.exec(name);
  if (numbered) return { group: numbered[1] ?? numbered[2], subgroup: numbered[2] + numbered[3] };
  const lettered = /^(\d+)\s*[a-z]$/i.exec(name);
  if (lettered) return { group: lettered[1], subgroup: name };
  return { group: name || null, subgroup: null };
}

type OwnGroup = NonNullable<ReturnType<typeof describeGroup>>;

function classmateGroupIds(own: OwnGroup, subgroupOnly: boolean) {
  if (subgroupOnly || !own.group.name) return [own.group.id];
  const parent = groupParts(own.group.name, own.faculty.shortName).group;
  return getDb().select({ id: groups.id, name: groups.name }).from(groups)
    .where(and(eq(groups.specializationId, own.group.specializationId), eq(groups.year, own.group.year),
      eq(groups.series, own.group.series))).all()
    .filter((row) => row.name && groupParts(row.name, own.faculty.shortName).group === parent)
    .map((row) => row.id);
}

type DirectoryParams = { name?: string | string[]; scope?: string | string[]; page?: string | string[] };

const foldedName = sql`fold_name(${users.name})`;

function nameMatches(name: string) {
  if (name.length > MAX_NAME_QUERY) return sql`0`;
  // instr matches literal substrings. An accent alone folds to an empty string and cannot match everyone.
  return and(...name.split(/\s+/u).map((part) => sql`instr(${foldedName}, nullif(fold_name(${part}), '')) > 0`));
}

export function contactDirectory(viewer: Pick<User, "id" | "groupId">, params: DirectoryParams) {
  const own = describeGroup(viewer.groupId);
  const cohort = own ? groupParts(own.group.name, own.faculty.shortName) : null;
  const name = typeof params.name === "string" ? params.name.trim() : "";
  const scope = name ? "name" : params.scope === "subgroup" && cohort?.subgroup ? "subgroup" : "group";

  const match = name ? nameMatches(name) : own ? inArray(users.groupId, classmateGroupIds(own, scope === "subgroup")) : sql`0`;
  const where = and(ne(users.id, viewer.id), match);
  const total = getDb().select({ value: count() }).from(users).where(where).get()!.value;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(pages, requestedPage)) : 1;
  const people = contactProfiles({}).where(where).orderBy(foldedName, users.id)
    .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE).all();
  return { cohort, name, scope, people, page, pages, total };
}

export type DirectoryPerson = ReturnType<typeof contactDirectory>["people"][number];

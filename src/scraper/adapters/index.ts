import type { FacultyAdapter } from "../types";
import { acAdapter } from "./ac";
import { etcAdapter, fscAdapter, mptAdapter } from "./others";
import { fihAdapter } from "./fih";
import { printedAdapters } from "./printedFaculties";
import { riaAdapter } from "./ria";

const adapters: FacultyAdapter[] = [acAdapter, etcAdapter, mptAdapter, fscAdapter, fihAdapter, riaAdapter, ...printedAdapters];

/** Faculties without an entry here are handled by the generic engine alone. */
export function adapterFor(slug: string): FacultyAdapter {
  return adapters.find((a) => a.slug === slug) ?? { slug };
}

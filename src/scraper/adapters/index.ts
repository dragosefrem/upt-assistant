import type { FacultyAdapter } from "../types";
import { acAdapter } from "./ac";
import { etcAdapter, fscAdapter, mptAdapter } from "./others";

const adapters: FacultyAdapter[] = [acAdapter, etcAdapter, mptAdapter, fscAdapter];

/** Faculties without an entry here are handled by the generic engine alone. */
export function adapterFor(slug: string): FacultyAdapter {
  return adapters.find((a) => a.slug === slug) ?? { slug };
}

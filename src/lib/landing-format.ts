/** Number formatting for the landing page. Pure, so it can be tested. */

/** "2.374" — Romanian thousands separator. */
export function formatCount(n: number): string {
  return n.toLocaleString("ro-RO");
}

/**
 * A count with its noun, as Romanian says it: "1 oră", "19 ore", "20 de ore", "2.374 de ore".
 * "de" comes before the noun when the last two digits are 00 or 20–99.
 */
export function roCount(n: number, one: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const lastTwo = n % 100;
  const de = n !== 0 && (lastTwo === 0 || lastTwo >= 20);
  return `${formatCount(n)} ${de ? "de " : ""}${many}`;
}

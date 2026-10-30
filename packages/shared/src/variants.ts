/**
 * Splits the seller's comma-separated variant text. A comma between digits is
 * an Indonesian decimal ("0,5 mm"), so it only splits there when the whole
 * token is a bare number list like "36,37,38".
 */
export function splitVariants(text: string): string[] {
  return text
    .split(/(?<!\d),|,(?!\d)/)
    .flatMap((v) => (/^\s*\d+(,\d+)+\s*$/.test(v) ? v.split(",") : [v]))
    .map((v) => v.trim())
    .filter(Boolean);
}

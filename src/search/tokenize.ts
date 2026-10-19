const COMBINING_MARKS = /\p{M}/gu;
const NON_ALPHANUMERIC = /[^\p{L}\p{N}]+/u;

/**
 * Splits text into lowercase, accent-free words.
 *
 * Names and queries both go through this function, so they always compare like with like:
 * "Café Strength & Co" becomes ["cafe", "strength", "co"].
 */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .split(NON_ALPHANUMERIC)
    .filter((word) => word.length > 0);
}

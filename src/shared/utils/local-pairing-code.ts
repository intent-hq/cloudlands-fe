/**
 * Local pairing codes (protocol §5.58 Limits): six characters from a
 * 31-symbol alphabet without look-alikes, shown as `KTP-82M`. Spaces and
 * hyphens are ignored and case does not matter.
 */

const LOCAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LOCAL_CODE_LENGTH = 6;

/** @internal Exported for tests. Remove spaces and hyphens, then uppercase. */
export function normalizeLocalCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/** Six characters from the code alphabet once normalized. */
export function isWellFormedLocalCode(input: string): boolean {
  const code = normalizeLocalCode(input);
  return (
    code.length === LOCAL_CODE_LENGTH && [...code].every((ch) => LOCAL_CODE_ALPHABET.includes(ch))
  );
}

/** Display form: `KTP82M` → `KTP-82M`; shorter input is grouped as far as it goes. */
export function formatLocalCode(input: string): string {
  const code = normalizeLocalCode(input).slice(0, LOCAL_CODE_LENGTH);
  return code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

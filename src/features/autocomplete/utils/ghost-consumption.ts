/**
 * Typing characters that match the ghost suggestion consumes them without a
 * new request (Contract §6.3); any other edit clears the ghost.
 *
 * @returns the remaining ghost, or `null` when it should be cleared (no match,
 * or fully typed out).
 */
export function consumeGhost(ghost: string, before: string, after: string): string | null {
  if (after === before) return ghost;
  if (!after.startsWith(before)) return null;
  const typed = after.slice(before.length);
  if (!ghost.toLowerCase().startsWith(typed.toLowerCase())) return null;
  const rest = ghost.slice(typed.length);
  return rest.length > 0 ? rest : null;
}

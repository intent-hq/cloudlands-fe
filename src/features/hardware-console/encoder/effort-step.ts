import type { PhysicalKnobDirection } from '../input/types';

/**
 * Clockwise steps up the advertised catalog order; Auto comes first.
 * Undefined means no change.
 */
export function stepEncoderEffort(
  current: string | null,
  levels: readonly string[],
  direction: PhysicalKnobDirection,
): string | null | undefined {
  if (levels.length === 0) return undefined;
  const options = [null, ...levels];
  const index = options.indexOf(current);
  // An obsolete saved value has no ordered position; return to Auto first.
  if (index < 0) return null;
  const next = index + (direction === 'clockwise' ? 1 : -1);
  return next < 0 || next >= options.length ? undefined : options[next];
}

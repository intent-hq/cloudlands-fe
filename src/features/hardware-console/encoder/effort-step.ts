import type { EncoderDirection } from '../input/types';

/** Auto precedes the advertised catalog order. Undefined means no change. */
export function stepEncoderEffort(
  current: string | null,
  levels: readonly string[],
  direction: EncoderDirection,
): string | null | undefined {
  if (levels.length === 0) return undefined;
  const options = [null, ...levels];
  const index = options.indexOf(current);
  // An obsolete saved value has no ordered position; return to Auto first.
  if (index < 0) return null;
  const next = index + (direction === 'cw' ? 1 : -1);
  return next < 0 || next >= options.length ? undefined : options[next];
}

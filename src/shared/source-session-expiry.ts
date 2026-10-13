/** Pure exact expiry comparison shared by main, preload and renderer. */
/** Pinned daemon parse_iso (time 0.3.55) plus ArtifactBegin's UTC/64-byte bound.
 * The one-byte separator, signed zero offset and leap stand-in are legacy parser
 * compatibility, not an amendment to the protocol's RFC3339 UTC description.
 * Keep the original string for identity/digests; only comparisons use this instant. */
export function deadlineNanoseconds(value: string): bigint | undefined {
  if (
    new TextEncoder().encode(value).byteLength > 64 ||
    value.charCodeAt(10) === 0 ||
    value.charCodeAt(10) > 127
  )
    return undefined;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})[\s\S](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:[Zz]|[+-]00:00)$/.exec(
      value,
    );
  // JS `$` can match before a final newline; the daemon consumes the whole input.
  if (!parts || parts[0] !== value) return undefined;
  const [, y, m, d, h, min, sec, fraction = ''] = parts;
  const year = Number(y),
    month = Number(m),
    day = Number(d);
  const hour = Number(h),
    minute = Number(min),
    second = Number(sec);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 60
  )
    return undefined;
  if (second === 60 && (hour !== 23 || minute !== 59 || day !== days[month - 1])) return undefined;
  // setUTCFullYear avoids Date.UTC's special interpretation of years 00 through 99.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, Math.min(second, 59), 0);
  // The daemon consumes extra digits but truncates their numeric contribution at nine.
  const nanos = second === 60 ? 999999999n : BigInt(fraction.slice(0, 9).padEnd(9, '0'));
  return BigInt(date.getTime()) * 1000000n + nanos;
}
export function parseSourceDeadline(value: string): bigint {
  const instant = deadlineNanoseconds(value);
  if (instant === undefined) throw new Error('Invalid artifact deadline');
  return instant;
}
/** Compare the supplied binary64 epoch-ms clock exactly with integer nanoseconds.
 * Decode its existing significand/exponent rather than subtracting or multiplying
 * floating-point values, which can erase an adjacent value at a fractional boundary. */
export function beforeSourceDeadline(now: number, deadline: bigint): boolean {
  if (!Number.isSafeInteger(Math.floor(now))) return false;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, now);
  const bits = view.getBigUint64(0);
  const exponent = (bits >> 52n) & 0x7ffn;
  const fraction = bits & ((1n << 52n) - 1n);
  const significand = exponent === 0n ? fraction : fraction + (1n << 52n);
  const signed = bits >> 63n ? -significand : significand;
  // Subnormals have no implicit leading bit and use the minimum exponent.
  const shift = exponent === 0n ? -1074n : exponent - 1075n;
  const scaled = signed * 1000000n;
  return shift >= 0n ? scaled << shift < deadline : scaled < deadline << -shift;
}

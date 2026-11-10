import { z } from 'zod';

/**
 * zod 3.25.76 string-format semantics, kept after the zod 4 migration so
 * accepted inputs and parsed values do not change. zod 4 requires seconds and
 * a colon in datetime offsets, trims URL output, and uses a different email
 * grammar; these helpers reproduce the zod 3 checks exactly.
 */

// zod 3 `dateRegexSource` (with leap-year validation).
const DATE_SOURCE =
  '((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))';
// zod 3 `timeRegexSource({ precision: null })`: seconds and fraction optional.
const TIME_SOURCE = '([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?';

/** zod 3 `datetimeRegex({ precision: null, local: false, offset })`. */
export const ZOD3_DATETIME = new RegExp(`^${DATE_SOURCE}T${TIME_SOURCE}(Z)$`);
export const ZOD3_DATETIME_OFFSET = new RegExp(
  `^${DATE_SOURCE}T${TIME_SOURCE}(Z|([+-]\\d{2}:?\\d{2}))$`,
);
/** zod 3 `emailRegex`. */
export const ZOD3_EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

/** zod 3 `z.string().datetime(options)`. */
export function isoDateTime(options: { offset?: boolean; message?: string } = {}) {
  return z
    .string()
    .regex(
      options.offset ? ZOD3_DATETIME_OFFSET : ZOD3_DATETIME,
      options.message ?? 'Invalid datetime',
    );
}

/** zod 3 `z.string().email(message)`. */
export function emailString(message = 'Invalid email') {
  return z.string().regex(ZOD3_EMAIL, message);
}

/** zod 3 `z.string().url(message)`: a `new URL()` check that leaves the value untouched. */
export function urlString(message = 'Invalid url') {
  return z.string().refine((value) => URL.canParse(value), message);
}

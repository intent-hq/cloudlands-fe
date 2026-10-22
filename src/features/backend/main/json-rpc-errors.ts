/**
 * JSON-RPC error shapes and numeric-code → string-code mapping for the live
 * backend transport.
 *
 * The intentd daemon returns standard numeric JSON-RPC error codes. The rest of
 * the app prefers stable string codes, so the transport maps each numeric code
 * to a string and surfaces it on `error.data.code` (preferring an explicit
 * `data.code` from the daemon when one is present).
 */

import { m } from '../../../shared/paraglide/messages.js';
import {
  describeUrlForLog,
  sanitizeCommandForDisplay,
} from '../../../shared/utils/sanitize-credentials';
import { scrubToken } from '../../deeplink/utils/scrub-token';

/** Raw JSON-RPC error object as received from the daemon. */
export interface JsonRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

/** Canonical string codes for the reserved JSON-RPC numeric range. */
const JSON_RPC_ERROR_CODES: Readonly<Record<number, string>> = {
  [-32700]: 'PARSE_ERROR',
  [-32600]: 'INVALID_REQUEST',
  [-32601]: 'METHOD_NOT_FOUND',
  [-32602]: 'INVALID_PARAMS',
  [-32603]: 'INTERNAL_ERROR',
};

/** Map a numeric JSON-RPC code to a stable string code. */
export function mapErrorCode(code: number): string {
  const known = JSON_RPC_ERROR_CODES[code];
  if (known) return known;
  // -32099..-32000 is the reserved implementation-defined server-error range.
  if (code <= -32000 && code >= -32099) return 'SERVER_ERROR';
  return 'UNKNOWN_ERROR';
}

/** Extract a daemon-provided `data.code` string if present, else `undefined`. */
function explicitDataCode(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'code' in data) {
    const value = (data as { code?: unknown }).code;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Error thrown for a JSON-RPC error response. Carries both the numeric daemon
 * code (`rpcCode`) and the resolved string code (`code`), the latter mirrored on
 * `data.code` so it survives serialization across the IPC bridge.
 */
export class JsonRpcError extends Error {
  readonly code: string;
  readonly rpcCode: number;
  readonly data: unknown;

  constructor(error: JsonRpcErrorShape) {
    super(error.message);
    this.name = 'JsonRpcError';
    this.rpcCode = error.code;
    this.code = explicitDataCode(error.data) ?? mapErrorCode(error.code);
    // Ensure the resolved string code is always available on data.code. A
    // non-object daemon `data` (e.g. the -32603 Internal error cause, which the
    // daemon router sends as a plain string) is preserved as `data.detail` so
    // the renderer can surface the real cause instead of the generic message.
    this.data =
      error.data && typeof error.data === 'object'
        ? { ...(error.data as Record<string, unknown>), code: this.code }
        : typeof error.data === 'string' && error.data.length > 0
          ? { code: this.code, detail: error.data }
          : { code: this.code };
  }

  /** Serializable shape for crossing the IPC bridge to the renderer. */
  toErrorPayload(): { code: string; message: string; data: unknown; rpcCode: number } {
    return { code: this.code, message: this.message, data: this.data, rpcCode: this.rpcCode };
  }
}

const MAX_RELAY_DIAGNOSTIC_LENGTH = 2048;

/** Redact whole values before other scrubbers can remove their quote boundaries. */
function scrubDiagnosticFields(text: string): string {
  const fields = /["']?([\w%+-]+)["']?\s*[:=]\s*|(--[\w-]+)\s+/g;
  let result = '';
  let copiedThrough = 0;
  let match: RegExpExecArray | null;
  while ((match = fields.exec(text)) !== null) {
    let key = match[1] ?? match[2];
    try {
      key = decodeURIComponent(key.replace(/\+/g, ' '));
    } catch {
      // A malformed escape in a joined diagnostic prefix must not hide an
      // encoded ASCII header/credential suffix. Leave other bytes unchanged.
      key = key.replace(/%([0-7][a-f\d])/gi, (_escape, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    }
    key = key.replace(/^--/, '');
    if (/(?:authorization|cookie)$/i.test(key)) {
      // Headers can contain several credentials, quoted fields or folded lines.
      // Match suffixes too: removing controls can join a preceding word to a
      // split/encoded header name. Such ambiguous keys must still fail closed.
      // Keep the preceding cause, but fail closed on the entire header tail.
      return `${result}${text.slice(copiedThrough, fields.lastIndex)}***`;
    }
    if (!/(key|token|secret|pass|credential|auth|pwd)/i.test(key) && !/^tc$/i.test(key)) {
      continue;
    }

    const valueStart = fields.lastIndex;
    let valueEnd = valueStart;
    const quote = text[valueStart];
    if (quote === '"' || quote === "'" || quote === '`') {
      valueEnd++;
      while (valueEnd < text.length) {
        const character = text[valueEnd++];
        if (character === '\\') valueEnd = Math.min(valueEnd + 1, text.length);
        else if (character === quote) break;
      }
    } else {
      while (valueEnd < text.length && !/[\s,;}&]/.test(text[valueEnd])) valueEnd++;
    }
    result += `${text.slice(copiedThrough, valueStart)}***`;
    copiedThrough = valueEnd;
    fields.lastIndex = valueEnd;
  }
  return result + text.slice(copiedThrough);
}

/**
 * A bounded diagnostic for the transfer/import dialogs and their logs. Match
 * the renderer's mutationErrorMessage convention for generic internal errors,
 * without serializing arbitrary data or changing the transport's error shape.
 */
export function relayErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : m.workspace_transfer_unknown_error();
  // Bound work BEFORE trimming, concatenating or running credential regexes.
  // Omit oversized fields entirely: a clipped prefix can expose part of a secret.
  if (message.length > MAX_RELAY_DIAGNOSTIC_LENGTH) return m.workspace_transfer_unknown_error();
  let text = message;
  // i18n-ignore (match the daemon's JSON-RPC wire message)
  if (message === 'Internal error' && error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    const detail = data && typeof data === 'object' && 'detail' in data ? data.detail : undefined;
    if (typeof detail === 'string') {
      if (message.length + 2 + detail.length > MAX_RELAY_DIAGNOSTIC_LENGTH) return message;
      const trimmed = detail.trim();
      if (trimmed && trimmed !== message) text = `${message}: ${trimmed}`;
    }
  }

  // Redact while line boundaries still exist, then rescan without controls for
  // split key names. Both interpretations must be safe before shared scrubbers.
  text = scrubDiagnosticFields(text);
  text = scrubDiagnosticFields(
    text
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
        '[REDACTED]',
      ),
  );
  // Reuse the existing command, pairing and URL redaction conventions.
  text = sanitizeCommandForDisplay(scrubToken(text))
    .replace(/[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+/gi, (url) => describeUrlForLog(url))
    .replace(/\b(Bearer|Basic)\s+[a-z\d._~+\/-]+=*/gi, '$1 ***');
  return text.length > MAX_RELAY_DIAGNOSTIC_LENGTH
    ? `${text.slice(0, MAX_RELAY_DIAGNOSTIC_LENGTH - 1)}…`
    : text;
}

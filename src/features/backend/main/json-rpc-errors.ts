/**
 * JSON-RPC error shapes and numeric-code → string-code mapping for the live
 * backend transport.
 *
 * The intentd daemon returns standard numeric JSON-RPC error codes. The rest of
 * the app prefers stable string codes, so the transport maps each numeric code
 * to a string and surfaces it on `error.data.code` (preferring an explicit
 * `data.code` from the daemon when one is present).
 */

/** Raw JSON-RPC error object as received from the daemon. */
export interface JsonRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

/** Canonical string codes for the reserved JSON-RPC numeric range. */
export const JSON_RPC_ERROR_CODES: Readonly<Record<number, string>> = {
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
    // Ensure the resolved string code is always available on data.code.
    this.data =
      error.data && typeof error.data === 'object'
        ? { ...(error.data as Record<string, unknown>), code: this.code }
        : { code: this.code };
  }

  /** Serializable shape for crossing the IPC bridge to the renderer. */
  toErrorPayload(): { code: string; message: string; data: unknown } {
    return { code: this.code, message: this.message, data: this.data };
  }
}

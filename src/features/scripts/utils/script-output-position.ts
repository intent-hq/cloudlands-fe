import type { ScriptOutputPosition } from '$store/renderer/slices/scripts/scripts-types';

/** An unsigned decimal stream position, or `undefined` past exact JS integers. */
export function parseStreamPosition(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * The stream position of a `script:output` event (PROTOCOL §5.8 output
 * cursors), or `undefined` for a daemon notice, an older daemon, or a range
 * that does not match the chunk's `byteLength`.
 */
export function parseScriptOutputPosition(
  data: Record<string, unknown>,
  byteLength: number,
): ScriptOutputPosition | undefined {
  const { runId, daemonBootId } = data;
  const start = parseStreamPosition(data.startOffset);
  const end = parseStreamPosition(data.endOffset);
  if (typeof runId !== 'string' || typeof daemonBootId !== 'string') return undefined;
  if (start === undefined || end === undefined || end - start !== byteLength) return undefined;
  return { runId, bootId: daemonBootId, start, end };
}

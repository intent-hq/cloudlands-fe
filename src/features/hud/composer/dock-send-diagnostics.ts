/**
 * Where a dock send failed, as a stage and a bounded code only: never prompt text,
 * file names, paths or ids. Only allowlisted internal codes are kept; anything else
 * (a localized message, a native description, a file or project name) is `unclassified`.
 */
export type DockSendStage =
  | 'validate'
  | 'transcribe'
  | 'plan'
  | 'screenshot-source'
  | 'screenshot-render'
  | 'overlay-render'
  | 'export'
  | 'placement'
  | 'burn'
  | 'admission'
  | 'barrier';

/** The internal failure codes a dock send can raise; anything else is unclassified. */
const KNOWN_CODES = new Set([
  // send preparation and its media plan
  'invalid-saved-edit', 'media-send-retired', 'transcript-unavailable', 'transcript-pending',
  'invalid-edit', 'stale-source', 'legacy-baked-marks', 'timing-unavailable', 'audio-unavailable',
  'media-source-unavailable', 'media-export-unavailable', 'media-animation-layer-limit',
  'media-export-failed', 'legacy-original-unavailable',
  // canonical rendering
  'capture-render-unavailable', 'capture-blur-unavailable', 'stale-source-pixels', 'not-a-screenshot',
  // admission and evidence
  'not-admitted', 'unavailable', 'dock-evidence-missing-pixels', 'draft-restore-failed',
]);
/** A native result's own error words, kept after `media-export-failed:`. */
const NATIVE_ERRORS = new Set(['unavailable', 'permission', 'failed', 'busy', 'cancelled', 'limit']);

export class DockSendError extends Error {
  constructor(
    readonly stage: DockSendStage,
    readonly code: string,
  ) {
    super(code);
    this.name = 'DockSendError';
  }
}

/** An allowlisted code for any thrown value; never free text, names or paths. */
export function dockSendCode(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const [head, ...native] = message.split(':');
  if (!KNOWN_CODES.has(head)) return 'unclassified';
  if (head !== 'media-export-failed') return native.length ? 'unclassified' : head;
  return [head, ...native.map((word) => (NATIVE_ERRORS.has(word) ? word : 'other'))].join(':');
}

/** The stage and code of a failed send; `fallback` when the error carries no stage. */
export function dockSendFailure(
  error: unknown,
  fallback: DockSendStage,
): { stage: DockSendStage; code: string } {
  return error instanceof DockSendError
    ? { stage: error.stage, code: dockSendCode(error.code) }
    : { stage: fallback, code: dockSendCode(error) };
}

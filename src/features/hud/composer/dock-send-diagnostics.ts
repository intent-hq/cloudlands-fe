/**
 * Where a dock send failed, as a stage and a bounded code only: never prompt text,
 * file names, paths or ids. Internal codes are short kebab-case words; anything else
 * (a localized message, a native description) is reported as `unclassified`.
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

const CODE = /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/;

export class DockSendError extends Error {
  constructor(
    readonly stage: DockSendStage,
    readonly code: string,
  ) {
    super(code);
    this.name = 'DockSendError';
  }
}

/** A bounded code for any thrown value. */
export function dockSendCode(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return message.length <= 64 && CODE.test(message) ? message : 'unclassified';
}

/** The stage and code of a failed send; `fallback` when the error carries no stage. */
export function dockSendFailure(
  error: unknown,
  fallback: DockSendStage,
): { stage: DockSendStage; code: string } {
  return error instanceof DockSendError
    ? { stage: error.stage, code: error.code }
    : { stage: fallback, code: dockSendCode(error) };
}

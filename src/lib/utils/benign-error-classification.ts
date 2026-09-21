import { shouldSuppressMonacoUnhandledRejection } from './monaco-error-suppression';
import { isStaleWebviewGuestError } from './webview-error-suppression';

// Single source of truth for which uncaught errors / unhandled rejections are benign noise.
// Both the global ErrorHandler and the layout ErrorBoundary classify through this function, so
// a suppression added here is honoured by every listener (intent-hq/intent#5241 reappeared
// because the two listeners kept separate inline lists).

export type BenignErrorKind =
  | 'svelte-effect-depth'
  | 'resize-observer'
  | 'monaco'
  | 'webview-stale-guest'
  | 'bits-ui-cleanup'
  | 'svelte-transition-reset';

interface Probe {
  /** ErrorEvent.message, else the error's message, else the stringified value. */
  message: string;
  /** The thrown value / rejection reason, when there is one. */
  error: unknown;
  name: string | undefined;
  stack: string | undefined;
}

// Svelte 5 compiles {@render snippet()} to n.call(...); in production the stack is minified
// (no 'bits-ui' string), so bits-ui cleanup errors surface as e.g. "n.call is not a function".
const MINIFIED_SNIPPET_CALL = /^[a-zA-Z_$]{1,3}\.call is not a function$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '';
  }
}

function toProbe(input: unknown): Probe {
  if (typeof input === 'string') {
    return { message: input, error: undefined, name: undefined, stack: undefined };
  }
  if (input instanceof Error) {
    return { message: input.message, error: input, name: input.name, stack: input.stack };
  }
  if (isRecord(input) && 'error' in input) {
    // ErrorEvent-like `{ message, error }` (also the `{ error }` wrapper some rejections use)
    const error = input.error;
    const inner = isRecord(error) ? error : undefined;
    return {
      message: asString(input.message) || asString(inner?.message) || '',
      error,
      name: asString(inner?.name),
      stack: asString(inner?.stack),
    };
  }
  if (isRecord(input)) {
    return {
      message: asString(input.message) || safeString(input),
      error: input,
      name: asString(input.name),
      stack: asString(input.stack),
    };
  }
  return { message: safeString(input), error: input, name: undefined, stack: undefined };
}

function isSvelteEffectDepthError(probe: Probe): boolean {
  const error = probe.error;
  const candidates: unknown[] = [probe.message];
  if (error instanceof Error) {
    candidates.push(
      error.message,
      error.toString(),
      error.name,
      (error as { code?: unknown }).code,
    );
  } else if (isRecord(error)) {
    candidates.push(error.message, safeString(error), error.name, error.code);
  } else if (error !== undefined) {
    candidates.push(safeString(error));
  }
  return candidates.some(
    (candidate) =>
      typeof candidate === 'string' &&
      (candidate.includes('effect_update_depth_exceeded') ||
        // i18n-ignore (matches Svelte's internal English error message)
        candidate.includes('Maximum update depth exceeded')),
  );
}

/**
 * Classify an uncaught error, an `ErrorEvent`-like `{ message, error }`, a rejection reason, or a
 * bare message string. Returns the benign kind, or `null` when the error is a real app error.
 */
export function classifyBenignError(input: unknown): BenignErrorKind | null {
  if (input === null || input === undefined) return null;

  const probe = toProbe(input);
  const { message, name, stack } = probe;
  // The thrown value when there is one; ErrorEvents for cross-origin scripts carry only a message.
  const target = probe.error ?? message;

  // Svelte effect depth errors are handled globally and must never cascade into another surface.
  if (isSvelteEffectDepthError(probe)) return 'svelte-effect-depth';

  // Benign browser warning.
  // i18n-ignore (matches the browser's internal English error message)
  if (message.includes('ResizeObserver loop')) return 'resize-observer';

  // Monaco disposal / cancellation noise (Canceled, TextModel disposed, inmemory TS, isInHiddenArea…).
  // The util is given the original input: it unwraps `{ message, error }` itself and matches both
  // the wrapper's message and the nested error, so an ErrorEvent message that differs from the
  // nested error's message still counts (as the ErrorBoundary historically matched event.message).
  // A bare `Canceled` reason string / `name === 'Canceled'` and the ViewZones `isInHiddenArea`
  // message probe are kept explicit to preserve the ErrorBoundary's former rules verbatim.
  if (
    shouldSuppressMonacoUnhandledRejection(input) ||
    message === 'Canceled' ||
    name === 'Canceled' ||
    message.includes('isInHiddenArea')
  ) {
    return 'monaco';
  }

  // Electron's renderer WebViewImpl keeps a stale guestInstanceId after the guest webContents is
  // destroyed (e.g. the guest page called window.close()); removing the <webview> then throws
  // `Invalid guestInstanceId: N`. The guest is already gone, so this is a harmless upstream quirk.
  if (isStaleWebviewGuestError(target)) return 'webview-stale-guest';

  // bits-ui internal event handlers firing after component destruction.
  // Known issue: https://github.com/huntabyte/bits-ui/discussions/1302
  if (
    message.includes('is not a function') &&
    (stack?.includes('bits-ui') ||
      message.includes('.current is not a function') ||
      MINIFIED_SNIPPET_CALL.test(message))
  ) {
    return 'bits-ui-cleanup';
  }

  // Race between {#each} reconciliation and in-flight crossfade transitions (e.g. workspace switching).
  if (
    // i18n-ignore (matches the browser's internal English error message)
    message.includes("Cannot read properties of undefined (reading 'reset')") &&
    stack?.includes('transitions')
  ) {
    return 'svelte-transition-reset';
  }

  return null;
}

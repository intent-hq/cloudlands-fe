import { logger } from '$shared/logger';
import type { HandleClientError } from '@sveltejs/kit';
import { initAnalytics, track, identifyUser } from '$lib/services/analytics';
import { shouldSuppressMonacoUnhandledRejection } from '$lib/utils/monaco-error-suppression';

// In browser-only mode (no Electron), @sentry/electron/renderer is unavailable.
// We lazily import it and provide a no-op fallback so the app still boots.
let Sentry: { init: (...args: any[]) => void; captureException: (...args: any[]) => void } = {
  init: () => {},
  captureException: () => {},
};
const sentryReady = (async () => {
  try {
    const mod = await import('@sentry/electron/renderer');
    Sentry = mod;
  } catch {
    console.info('[hooks.client] @sentry/electron/renderer not available — running in browser mode');
  }
})();

/**
 * Check if a Sentry exception should be filtered out before sending.
 * This catches errors that bypass SvelteKit's handleError hook but are still
 * caught by Sentry's global handlers (e.g., Monaco "Canceled" errors).
 *
 * The exception object from Sentry's event.exception.values[] includes:
 * - type: e.g., "TypeError"
 * - value: e.g., "n.call is not a function"
 * - stacktrace: { frames: [{ filename, function, ... }] }
 */
function shouldFilterSentryException(exception: {
  type?: string;
  value?: string;
  stacktrace?: { frames?: Array<{ filename?: string }> };
}): boolean {
  const { type, value } = exception;

  // Filter Monaco "Canceled" errors - these are benign cancellation signals
  // that occur during normal editor disposal, navigation, or typing
  if (type === 'Canceled' || value === 'Canceled' || value?.includes('Canceled: Canceled')) {
    return true;
  }

  // Filter TextModel disposal errors - race condition during editor cleanup
  if (value?.includes('TextModel got disposed')) {
    return true;
  }

  // Filter Monaco diff computation race conditions
  if (value?.includes('no diff result available')) {
    return true;
  }

  // Filter TextMate grammar tokenization errors
  if (value?.includes('trying to pop an empty stack')) {
    return true;
  }

  // Filter Monaco inmemory TypeScript errors
  if (value?.includes('Could not find source file') && value?.includes('inmemory://')) {
    return true;
  }

  // Filter Monaco ViewLine isInHiddenArea race condition
  if (value?.includes('isInHiddenArea')) {
    return true;
  }

  // Filter minified bits-ui/Svelte snippet call errors during component teardown.
  // In production, Svelte 5 compiles {@render snippet()} to n.call(...) where n is a
  // minified variable. When bits-ui tooltip components are destroyed during workspace
  // transitions, internal snippet references become undefined, causing:
  //   TypeError: n.call is not a function
  // We require BOTH:
  //   1. The error message matches the minified .call pattern
  //   2. The stack trace references a SvelteKit production chunk (immutable/chunks/)
  // This prevents accidentally suppressing legitimate errors.
  // See: https://github.com/huntabyte/bits-ui/discussions/1302
  if (type === 'TypeError' && value && /^[a-zA-Z_$]{1,3}\.call is not a function$/.test(value)) {
    // Check stack trace to confirm this is from a SvelteKit production chunk
    const frames = exception.stacktrace?.frames;
    const isFromSvelteKitChunk = frames?.some((f) => f.filename?.includes('immutable/chunks/'));
    if (isFromSvelteKitChunk || !frames?.length) {
      // Filter if from SvelteKit chunk, or if no stack frames available (can't verify origin)
      return true;
    }
  }

  return false;
}

// Initialize Sentry for renderer process using config from main process via IPC
// This avoids bundling the DSN into the client JavaScript
async function initSentry() {
  try {
    await sentryReady;
    // Fetch config from main process (which has build-time config baked in)
    const sentryConfig = await window.electronAPI?.fetchSentryConfig?.();
    if (sentryConfig?.dsn) {
      const isProduction = sentryConfig.environment === 'production';
      Sentry.init({
        dsn: sentryConfig.dsn,
        environment: sentryConfig.environment || 'development',
        release: sentryConfig.release,
        // Sample rate for performance tracing - use environment from main process
        tracesSampleRate: isProduction ? 0.1 : 1.0,
        debug: !isProduction, // Only enable debug in development
        // Filter out known benign errors that bypass handleError hook
        // but are caught by Sentry's global handlers
        beforeSend: (event: any) => {
          const exceptions = event.exception?.values || [];
          for (const ex of exceptions) {
            if (shouldFilterSentryException(ex)) {
              return null; // Drop the event
            }
          }
          return event;
        },
      });
      console.log('[Sentry Renderer] Initialized', {
        environment: sentryConfig.environment,
        release: sentryConfig.release,
        isProduction,
      });
    } else {
      console.warn('[Sentry Renderer] No DSN available from main process');
    }
  } catch (error) {
    console.warn('[Sentry Renderer] Failed to initialize:', error);
  }
}

// Initialize analytics (Segment) for renderer process
// Fetches write key from main process via IPC, then tracks app open and identifies user
async function initAnalyticsClient() {
  try {
    const success = await initAnalytics();
    if (success) {
      console.log('[Analytics] Renderer initialized');

      // Identify user with traits (email, tenant, etc.)
      // This ties all subsequent events to the user
      await identifyUser();

      // Track app opened event (common properties are auto-attached)
      track('Opened App', {});

      // Listen for analytics events forwarded from the main process
      window.electronAPI?.on('analytics:track-from-main', (data: { event: string; properties: Record<string, unknown> }) => {
        try {
          if (typeof data?.event !== 'string' || typeof data?.properties !== 'object') {
            return;
          }
          track(data.event as any, data.properties as any);
        } catch (err) {
          console.warn('[Analytics] Failed to track main-process event:', data?.event, err);
        }
      });
    }
  } catch (error) {
    console.warn('[Analytics] Failed to initialize:', error);
  }
}

// Install a full browser mock for window.electronAPI when running outside Electron.
// This provides mock data for workspaces, settings, etc. so the app renders fully.
// The import auto-installs the mock if window.electronAPI is not already present.
import '$lib/browser-mock';

// Initialize Sentry and Analytics asynchronously
initSentry();
initAnalyticsClient();

// Track if we've initialized - this helps suppress the initial "Not found: /index.html"
// error that happens in SPA mode when the app first loads
let initialized = false;

// Track consecutive "Not found" errors to detect router corruption
let consecutiveNotFoundErrors = 0;
const MAX_CONSECUTIVE_NOT_FOUND = 2;

export const handleError: HandleClientError = ({ error, event }) => {
  // Check if this is a known Monaco/editor race condition error - non-fatal
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message);
    // Diff models disposed before diff computation completes
    if (message.includes('no diff result available')) {
      return { message: '' };
    }
    // ViewLine.render fires during hideUnchangedRegions model swap
    if (message.includes('isInHiddenArea')) {
      return { message: '' };
    }
    // Model disposed during async operations (e.g., diff computation, tokenization)
    if (message.includes('TextModel got disposed')) {
      return { message: '' };
    }
  }

  // Check if this is a "Not found" error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message);
    const isNotFoundError =
      message.includes('Not found: /index.html') || message.includes('Not found');

    if (isNotFoundError) {
      // Suppress the initial "Not found: /index.html" error during SPA initialization
      if (!initialized) {
        initialized = true;
        consecutiveNotFoundErrors = 0;
        return {
          message: '',
        };
      }

      // Track consecutive "Not found" errors
      consecutiveNotFoundErrors++;

      // If we get multiple consecutive "Not found" errors, the router is likely corrupted
      // This can happen after HMR reloads in development
      if (consecutiveNotFoundErrors >= MAX_CONSECUTIVE_NOT_FOUND) {
        logger.warn('Multiple consecutive "Not found" errors detected, router may be corrupted', {
          url: event.url.toString(),
          routeId: event.route.id,
          consecutiveErrors: consecutiveNotFoundErrors,
        });

        // Reset counter and trigger a full page reload to recover
        consecutiveNotFoundErrors = 0;

        // Schedule a reload after a short delay to allow the error page to render
        if (typeof window !== 'undefined') {
          setTimeout(() => {
            logger.info('Triggering full page reload to recover from router corruption');
            window.location.reload();
          }, 100);
        }
      }

      // Log the error
      logger.error('Client navigation error:', {
        error,
        url: event.url.toString(),
        routeId: event.route.id,
      });

      return {
        message: 'Page not found',
      };
    } else {
      // Reset counter for non-"Not found" errors
      consecutiveNotFoundErrors = 0;
    }
  }

  // Log other errors with full details
  // Extract error details for better logging
  let errorDetails: Record<string, unknown>;

  if (error instanceof Error) {
    errorDetails = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      url: event.url.toString(),
      routeId: event.route.id,
    };
  } else if (error && typeof error === 'object') {
    // Handle non-Error objects (e.g., SvelteKit internal errors)
    try {
      errorDetails = {
        ...error,
        url: event.url.toString(),
        routeId: event.route.id,
        errorType: 'object',
        errorKeys: Object.keys(error),
      };
    } catch {
      errorDetails = {
        message: String(error),
        url: event.url.toString(),
        routeId: event.route.id,
        errorType: 'non-serializable-object',
      };
    }
  } else {
    errorDetails = {
      message: String(error),
      url: event.url.toString(),
      routeId: event.route.id,
      errorType: typeof error,
    };
  }

  // Suppress known Monaco Editor errors (e.g., TextMate grammar tokenization issues)
  // These are harmless and occur during syntax highlighting of certain code patterns
  if (shouldSuppressMonacoUnhandledRejection(error)) {
    return {
      message: '',
    };
  }

  // Suppress bits-ui cleanup errors during component teardown
  // In production, Svelte 5 compiles {@render snippet()} to n.call(...) where n is minified.
  // When bits-ui tooltips are destroyed during workspace transitions, internal snippet
  // references become undefined, causing: TypeError: n.call is not a function
  // See: https://github.com/huntabyte/bits-ui/discussions/1302
  const errorMsg = error instanceof Error ? error.message : String(error);
  if (
    errorMsg?.includes('.call is not a function') &&
    (/^[a-zA-Z_$]{1,3}\.call is not a function$/.test(errorMsg) ||
      (error instanceof Error && error.stack?.includes('immutable/chunks/')))
  ) {
    return {
      message: '',
    };
  }

  // Send error to Sentry
  Sentry.captureException(error, {
    tags: {
      type: 'clientError',
      routeId: event.route.id || 'unknown',
    },
    extra: errorDetails,
  });

  logger.error('Client error:', errorDetails);
  // Also log the raw error for debugging
  console.error('[hooks.client] Raw error:', error);
  // Try to log as JSON for better visibility
  try {
    console.error('[hooks.client] Error as JSON:', JSON.stringify(error, null, 2));
  } catch {
    console.error('[hooks.client] Error not JSON serializable');
  }

  // Return a user-friendly error message
  return {
    message: 'An unexpected error occurred',
  };
};

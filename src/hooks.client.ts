import { logger } from '$shared/logger';
import type { HandleClientError } from '@sveltejs/kit';
import { shouldSuppressMonacoUnhandledRejection } from '$lib/utils/monaco-error-suppression';

// Install a full browser mock for window.electronAPI when running outside Electron.
// This provides mock data for workspaces, settings, etc. so the app renders fully.
// DEV-ONLY: gated on import.meta.env.DEV (or explicit VITE_ENABLE_BROWSER_MOCK=true
// opt-in) so packaged/daemon-bridged builds never load the mock — unbridged
// channels then fail loudly (UnbridgedMockIpcChannelError) instead of silently
// serving mock data. The import auto-installs the mock if window.electronAPI is
// not already present (installBrowserMock re-checks the same gate internally).
if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_BROWSER_MOCK === 'true') {
  void import('$lib/browser-mock');
}

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

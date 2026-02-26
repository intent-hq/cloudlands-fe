<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { Logger } from '../../shared/logger';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faTriangleExclamation,
    faRotateRight,
    faArrowsRotate,
    faCopy,
    faCheck,
  } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    fallback?: string;
    onError?: (error: Error, errorInfo?: any) => void;
    componentName?: string;
    logger?: Logger;
    children?: any;
    error?: Error | null;
    status?: number;
  }

  let {
    fallback = 'Something went wrong. Please refresh the page.',
    onError,
    componentName = 'Component',
    logger: customLogger,
    children,
    error: initialError,
    status,
  }: Props = $props();

  let hasError = $state(initialError ? true : false);
  let errorMessage = $state(initialError?.message || '');
  let errorDetails = $state<Error | null>(initialError || null);
  let errorInfo = $state(initialError?.stack || '');
  let showDetails = $state(false);
  let copyFeedback = $state(false);

  // Sync error prop to state (needed for +error.svelte where page.error updates after mount)
  $effect(() => {
    if (initialError) {
      hasError = true;
      errorMessage = initialError.message || '';
      errorDetails = initialError instanceof Error ? initialError : null;
      errorInfo = initialError instanceof Error ? (initialError.stack || '') : '';
    }
  });

  // Use $derived to ensure logger updates if componentName changes
  // Use custom logger if provided, otherwise create a new one
  const logger = $derived(customLogger || new Logger(`ErrorBoundary:${componentName}`));

  function handleError(error: Error, errorInfoParam?: any) {
    // Use queueMicrotask to avoid state_unsafe_mutation error when called from window event handlers
    queueMicrotask(() => {
      hasError = true;
      errorMessage = error.message || 'An unexpected error occurred';
      errorDetails = error;
      errorInfo = error.stack || '';
    });

    logger.error('Component error caught', {
      component: componentName,
      error: error.message,
      stack: error.stack,
      errorInfo: errorInfoParam,
    });

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfoParam);
    }
  }

  function retry() {
    hasError = false;
    errorMessage = '';
    errorDetails = null;
    errorInfo = '';
    showDetails = false;
  }

  async function handleCopyDetails() {
    try {
      const textToCopy = `Error: ${errorDetails?.message || 'Unknown error'}\n\nStack Trace:\n${errorInfo}`;
      await navigator.clipboard.writeText(textToCopy);
      copyFeedback = true;
      setTimeout(() => {
        copyFeedback = false;
      }, 2000);
    } catch (err) {
      logger.error('Failed to copy to clipboard:', err);
    }
  }

  // Helper to check if an error is a Svelte effect depth error
  function isSvelteEffectDepthError(error: any): boolean {
    if (!error) return false;

    // Check various places where the error message might be
    const messagesToCheck = [
      error.message,
      error.toString?.(),
      String(error),
      error.name,
      error.code,
    ].filter(Boolean);

    return messagesToCheck.some(
      (msg) =>
        msg.includes('effect_update_depth_exceeded') ||
        msg.includes('svelte.dev/e/effect_update_depth_exceeded') ||
        msg.includes('Maximum update depth exceeded'),
    );
  }

  // Catch unhandled errors in child components
  onMount(() => {
    const errorHandler = (event: ErrorEvent) => {
      try {
        // Skip Svelte effect depth errors - these are handled globally and shouldn't trigger ErrorBoundary
        const errorMessage = event.message || event.error?.message || '';
        if (
          errorMessage.includes('effect_update_depth_exceeded') ||
          errorMessage.includes('svelte.dev/e/effect_update_depth_exceeded') ||
          isSvelteEffectDepthError(event.error)
        ) {
          return;
        }

        // Skip ResizeObserver loop errors - these are benign browser warnings
        if (errorMessage.includes('ResizeObserver loop')) {
          return;
        }

        // Skip bits-ui cleanup errors during component unmount
        // These occur when bits-ui internal event handlers fire after component destruction
        // Known issue: https://github.com/huntabyte/bits-ui/discussions/1302
        // In production, stack traces are minified (no 'bits-ui' string), and Svelte 5
        // compiles {@render snippet()} to n.call(...), producing errors like:
        //   "n.call is not a function" (minified variable names)
        if (
          errorMessage.includes('is not a function') &&
          (event.error?.stack?.includes('bits-ui') ||
            errorMessage.includes('.current is not a function') ||
            /^[a-zA-Z_$]{1,3}\.call is not a function$/.test(errorMessage))
        ) {
          return;
        }

        // Skip Monaco "Canceled" errors - benign cancellations during editor disposal/navigation
        if (errorMessage === 'Canceled' || event.error?.name === 'Canceled') {
          return;
        }

        // Skip Monaco ViewZones "isInHiddenArea" race condition - benign error when
        // hideUnchangedRegions triggers a re-render while view zones are stale
        if (errorMessage.includes('isInHiddenArea')) {
          return;
        }

        // Only handle errors from this component tree
        if (event.error && !hasError) {
          handleError(event.error);
          event.preventDefault();
        }
      } catch (err) {
        console.error('Error in error handler:', err);
      }
    };

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      // Defer handling to a microtask so other listeners (e.g. monaco-workers)
      // have a chance to call event.preventDefault() to suppress known benign errors.
      queueMicrotask(() => {
        try {
          if (event.defaultPrevented) return;

          // Skip Svelte effect depth errors
          const reason = String(event.reason || '');
          if (
            reason.includes('effect_update_depth_exceeded') ||
            reason.includes('svelte.dev/e/effect_update_depth_exceeded') ||
            isSvelteEffectDepthError(event.reason)
          ) {
            return;
          }

          // Skip Monaco TypeScript worker errors for inmemory diff models
          // These occur because the TS language service can't find in-memory models used by diff viewers
          if (reason.includes('Could not find source file') && reason.includes('inmemory://')) {
            event.preventDefault();
            return;
          }

          // Skip bits-ui cleanup errors during component unmount
          // In production, stack traces are minified (no 'bits-ui' string), and Svelte 5
          // compiles {@render snippet()} to n.call(...), producing errors like:
          //   "n.call is not a function" (minified variable names)
          if (
            reason.includes('is not a function') &&
            (event.reason?.stack?.includes('bits-ui') ||
              reason.includes('.current is not a function') ||
              /^[a-zA-Z_$]{1,3}\.call is not a function$/.test(reason))
          ) {
            event.preventDefault();
            return;
          }

          // Skip Monaco "Canceled" errors - benign cancellations during editor disposal/navigation
          if (
            reason === 'Canceled' ||
            reason.includes('Canceled: Canceled') ||
            event.reason?.name === 'Canceled'
          ) {
            event.preventDefault();
            return;
          }

          if (!hasError) {
            // Handle different types of rejection reasons
            let errorMessage = 'Unhandled promise rejection';
            let stack = '';

            if (event.reason) {
              if (event.reason instanceof Error) {
                errorMessage = event.reason.message || errorMessage;
                stack = event.reason.stack || '';
              } else if (typeof event.reason === 'string') {
                errorMessage = event.reason;
              } else if (typeof event.reason === 'object') {
                // Common structured shapes: { message, stack } or { error: { message, stack } }
                const anyReason = event.reason as any;
                if (anyReason?.message) {
                  errorMessage = anyReason.message;
                  stack = anyReason.stack || '';
                } else if (anyReason?.error?.message) {
                  errorMessage = anyReason.error.message;
                  stack = anyReason.error.stack || '';
                }
              }
            }

            const error = new Error(errorMessage);
            if (stack) {
              error.stack = stack;
            }
            handleError(error);
            event.preventDefault();
          }
        } catch (err) {
          console.error('Error in rejection handler:', err);
        }
      });
    };

    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectionHandler);

    return () => {
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', rejectionHandler);
    };
  });

  // Reset error state when component is destroyed
  onDestroy(() => {
    hasError = false;
    errorMessage = '';
    errorDetails = null;
    errorInfo = '';
  });

  // Reusable error display snippet for both boundary and async errors
  function handleCopyDetailsForSnippet(errMsg: string, errStack: string) {
    try {
      const textToCopy = `Error: ${errMsg}\n\nStack Trace:\n${errStack}`;
      navigator.clipboard.writeText(textToCopy);
      copyFeedback = true;
      setTimeout(() => {
        copyFeedback = false;
      }, 2000);
    } catch (err) {
      logger.error('Failed to copy to clipboard:', err);
    }
  }
</script>

{#snippet errorDisplay(errMsg: string, errStack: string, retryFn: () => void)}
  <!-- Full viewport container with vertical centering -->
  <div class="min-h-full flex items-center justify-center p-6 bg-background">
    <!-- Centered content container with max width -->
    <div
      class="w-full max-w-md"
      role="alert"
      aria-live="assertive"
    >
      <!-- Card container -->
      <div class="bg-card border border-border rounded-lg shadow-lg p-8">
        <!-- Vertically stacked content, all centered -->
        <div class="flex flex-col items-center text-center space-y-6">

          <!-- Warning Icon - Large and centered -->
          <div
            class="animate-in fade-in zoom-in duration-300 mt-5"
          >
            <Fa icon={faTriangleExclamation} size={40} class="text-muted-foreground/50" />
          </div>

          <!-- Error Message - Centered -->
          <div class="space-y-3">
            <h3 class="text-2xl font-semibold text-foreground">
              Something went wrong
            </h3>
            <p class="text-base text-foreground/70 leading-relaxed max-w-sm mx-auto break-words">
              {errMsg || fallback}
            </p>
          </div>

          <!-- Action Buttons - Centered horizontally -->
          <div class="flex items-center justify-center gap-3 flex-wrap">
            <Button variant="default" size="default" onclick={retryFn}>
              <Fa icon={faRotateRight} class="w-4 h-4" />
              Try Again
            </Button>
            <Button variant="outline" size="default" onclick={() => window.location.reload()}>
              <Fa icon={faArrowsRotate} class="w-4 h-4" />
              Reload Page
            </Button>
          </div>

          <!-- Show Details Button - Separate row if error info exists -->
          {#if errStack}
            <div class="w-full flex flex-col items-center">
            <div class="relative mx-auto ">
              <Button
                variant="ghost"
                size="sm"
                class="text-foreground/60 hover:text-foreground"
                onclick={() => (showDetails = !showDetails)}
              >
                {showDetails ? 'Hide' : 'Show'} Technical Details
              </Button>

          {#if showDetails}
              <Button
                variant="ghost"
                size="icon-sm"
                class="absolute right-1 transform translate-x-full text-foreground/60 hover:text-foreground"
                title="Copy error details to clipboard"
                onclick={() => handleCopyDetailsForSnippet(errMsg, errStack)}
              >
                <Fa icon={copyFeedback ? faCheck : faCopy} class="w-4 h-4" />
              </Button>
              {/if}
            </div>

          <!-- Stack Trace Details - Full width with proper overflow handling -->
          {#if showDetails}
            <div class="relative w-full pt-3" transition:slide={{ axis: 'y' }}>


              <div class="p-4 border border-border/50">
                <pre class="text-xs font-mono text-foreground/70 leading-relaxed overflow-x-auto max-h-64 text-left whitespace-pre-wrap break-all">{errStack}</pre>
              </div>
            </div>
          {/if}
          </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/snippet}

<svelte:boundary onerror={(error: unknown, reset) => {
  const err = error instanceof Error ? error : new Error(String(error));
  // Skip Monaco "Canceled" errors - benign cancellations during editor disposal/navigation
  if (err.message === 'Canceled' || err.name === 'Canceled') return;
  logger.error(`[ErrorBoundary] Render error in ${componentName}:`, err);
  if (onError) onError(err);
}}>
  {#snippet failed(error: unknown, reset)}
    {@const err = error instanceof Error ? error : new Error(String(error))}
    {@render errorDisplay(err.message || 'An unexpected error occurred', err.stack || '', reset)}
  {/snippet}

  {#if hasError}
    {@render errorDisplay(errorMessage, errorInfo, retry)}
  {:else}
    {@render children?.()}
  {/if}
</svelte:boundary>

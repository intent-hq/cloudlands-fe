<script lang="ts">
  /**
   * Enhanced Error Boundary Component
   *
   * Provides comprehensive error handling for Svelte components with:
   * - Automatic error recovery attempts
   * - User-friendly error messages
   * - Detailed error logging
   * - Fallback UI options
   * - Error reporting to backend
   */

  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { createLogger } from '$lib/utils/client-logger';
  import { ErrorHandler } from '$features/agent/services/error-handler';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faTriangleExclamation,
    faRotateRight,
    faArrowsRotate,
    faHouse,
    faSpinner,
    faCopy,
    faCheck,
  } from '@fortawesome/free-solid-svg-icons';
  import { goto } from '$app/navigation';

  const logger = createLogger('EnhancedErrorBoundary');
  const errorHandler = ErrorHandler.getInstance();

  interface Props {
    children: any;
    fallback?: any;
    onError?: (error: Error, errorInfo?: string) => void;
    componentName?: string;
    showDetails?: boolean;
    autoRecover?: boolean;
    recoveryDelay?: number;
  }

  let {
    children,
    fallback,
    onError,
    componentName = 'Unknown',
    showDetails: showDetailsProp = false,
    autoRecover = false,
    recoveryDelay = 3000,
  }: Props = $props();

  let error: Error | null = $state(null);
  let errorInfo: string = $state('');
  let recoveryAttempts = $state(0);
  let isRecovering = $state(false);
  let showDetails = $state(showDetailsProp);
  let copyFeedback: boolean = $state(false);

  // Helper to check if an error is a Svelte effect depth error
  function isSvelteEffectDepthError(err: any): boolean {
    if (!err) return false;
    const messagesToCheck = [err.message, err.toString?.(), String(err)].filter(Boolean);
    return messagesToCheck.some(
      (msg) =>
        msg.includes('effect_update_depth_exceeded') ||
        msg.includes('svelte.dev/e/effect_update_depth_exceeded') ||
        msg.includes('Maximum update depth exceeded'),
    );
  }

  // Handle errors during rendering
  function handleError(event: ErrorEvent) {
    // Skip Svelte effect depth errors - these are handled globally
    const errorMsg = event.message || event.error?.message || '';
    if (
      errorMsg.includes('effect_update_depth_exceeded') ||
      errorMsg.includes('svelte.dev/e/effect_update_depth_exceeded') ||
      isSvelteEffectDepthError(event.error)
    ) {
      return;
    }

    // Skip Monaco ViewZones "isInHiddenArea" race condition - benign error when
    // hideUnchangedRegions triggers a re-render while view zones are stale
    if (errorMsg.includes('isInHiddenArea')) {
      return;
    }

    // Skip if we already have an error
    if (error) return;

    error = new Error(event.message);
    errorInfo = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '';

    logger.error(`Error caught in ${componentName}:`, { error, errorInfo });

    // Track error with error handler
    errorHandler.track(error);

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }

    // Attempt auto-recovery if enabled
    if (autoRecover && recoveryAttempts < 3) {
      attemptRecovery();
    }

    // Prevent default error handling
    event.preventDefault();
  }

  // Handle unhandled promise rejections
  function handleRejection(event: PromiseRejectionEvent) {
    // Skip Svelte effect depth errors
    const reason = String(event.reason || '');
    if (
      reason.includes('effect_update_depth_exceeded') ||
      reason.includes('svelte.dev/e/effect_update_depth_exceeded') ||
      isSvelteEffectDepthError(event.reason)
    ) {
      return;
    }

    // Skip if we already have an error
    if (error) return;

    error = new Error(event.reason?.message || 'Unhandled promise rejection');
    errorInfo = event.reason?.stack || '';

    logger.error(`Unhandled rejection in ${componentName}:`, { error, errorInfo });

    // Track error with error handler
    errorHandler.track(error);

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }

    // Attempt auto-recovery if enabled
    if (autoRecover && recoveryAttempts < 3) {
      attemptRecovery();
    }

    // Prevent default error handling
    event.preventDefault();
  }

  async function attemptRecovery() {
    isRecovering = true;
    recoveryAttempts++;

    logger.info(`Attempting recovery (attempt ${recoveryAttempts}/3)...`);

    await new Promise((resolve) => setTimeout(resolve, recoveryDelay));

    // Reset error state
    error = null;
    errorInfo = '';
    // Note: boundary.reset() removed - not available in Svelte
    isRecovering = false;
  }

  function handleReset() {
    error = null;
    errorInfo = '';
    recoveryAttempts = 0;
    // Note: boundary.reset() removed - not available in Svelte
    logger.info(`Error boundary reset for ${componentName}`);
  }

  function handleReload() {
    window.location.reload();
  }

  function handleGoHome() {
    goto('/');
  }

  async function handleCopyDetails() {
    try {
      const textToCopy = `Error: ${error?.message || 'Unknown error'}\n\nStack Trace:\n${errorInfo}`;
      await navigator.clipboard.writeText(textToCopy);
      copyFeedback = true;
      setTimeout(() => {
        copyFeedback = false;
      }, 2000);
    } catch (err) {
      logger.error('Failed to copy to clipboard:', err);
    }
  }

  onMount(() => {
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
  });

  onDestroy(() => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
  });
</script>

{#if error}
  {#if fallback}
    {@render fallback({ error, errorInfo, onReset: handleReset })}
  {:else}
    <!-- Full viewport container with vertical centering -->
    <div class="min-h-screen flex items-center justify-center p-6 bg-background">
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

            <!-- Warning Icon with Recovery Animation - Large and centered -->
            <div
              class="w-14 h-14 rounded-full bg-warning/15 flex items-center justify-center ring-1 ring-warning/20 animate-in fade-in zoom-in duration-300"
            >
              {#if isRecovering}
                <Fa icon={faSpinner} class="w-10 h-10 text-warning" spin />
              {:else}
                <Fa icon={faTriangleExclamation} class="w-10 h-10 text-muted-foreground/50" />
              {/if}
            </div>

            <!-- Error Message - Centered -->
            <div class="space-y-3">
              <h3 class="text-2xl font-semibold text-foreground">
                {#if isRecovering}
                  Attempting recovery...
                {:else}
                  Something went wrong
                {/if}
              </h3>
              <p class="text-base text-foreground/70 leading-relaxed max-w-sm mx-auto">
                {#if isRecovering}
                  Trying to recover automatically (attempt {recoveryAttempts}/3)
                {:else}
                  {error.message || `Error in ${componentName}`}
                {/if}
              </p>
            </div>

            <!-- Action Buttons - Centered horizontally -->
            {#if !isRecovering}
              <div class="flex items-center justify-center gap-3 flex-wrap">
                <Button variant="default" size="default" onclick={handleReset}>
                  <Fa icon={faRotateRight} class="w-4 h-4" />
                  Try Again
                </Button>
                <Button variant="outline" size="default" onclick={handleReload}>
                  <Fa icon={faArrowsRotate} class="w-4 h-4" />
                  Reload Page
                </Button>
              </div>

              <!-- Secondary action and details toggle - Separate row -->
              <div class="flex items-center justify-center gap-3 flex-wrap">
                <Button variant="ghost" size="sm" onclick={handleGoHome}>
                  <Fa icon={faHouse} class="w-4 h-4" />
                  Go Home
                </Button>
                {#if errorInfo}
                  <div class="relative">
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
                        onclick={handleCopyDetails}
                      >
                        <Fa icon={copyFeedback ? faCheck : faCopy} class="w-4 h-4" />
                      </Button>
                    {/if}
                  </div>
                {/if}
              </div>

              <!-- Stack Trace Details - Full width with proper overflow handling -->
              {#if showDetails && errorInfo}
                <div class="w-full pt-6 border-t border-border" transition:slide={{ axis: 'y' }}>
                  <div class="bg-muted/60 rounded-lg p-4 border border-border/50">
                    <pre class="text-xs font-mono text-foreground/70 leading-relaxed overflow-x-auto max-h-64 text-left whitespace-pre-wrap break-all">{errorInfo}</pre>
                  </div>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
{:else}
  {@render children()}
{/if}

<script lang="ts">
  import { createLogger } from '$lib/utils/client-logger';
  import ErrorBoundary from '$lib/components/ErrorBoundary.svelte';
  import EnhancedErrorBoundary from '$lib/components/error/EnhancedErrorBoundary.svelte';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
  faTriangleExclamation,
  faCheckCircle,
} from '@fortawesome/free-solid-svg-icons';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const logger = createLogger('TestErrorBoundary');

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let basicErrorMessage = $state('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let enhancedErrorMessage = $state('');

  function triggerBasicError() {
    basicErrorMessage = 'Simple Error';
    throw new Error('This is a simple error triggered by the button');
  }

  function triggerBasicTypeError() {
    basicErrorMessage = 'Type Error';
    const obj: any = null;
    obj.nonexistentMethod();
  }

  function triggerEnhancedError() {
    enhancedErrorMessage = 'Enhanced Error';
    throw new Error('This error will trigger auto-recovery in the Enhanced Error Boundary');
  }

  function triggerEnhancedTypeError() {
    enhancedErrorMessage = 'Enhanced Type Error';
    const arr: any = undefined;
    arr.map((x: any) => x);
  }
</script>

<div class="min-h-screen bg-background p-8">
  <div class="max-w-6xl mx-auto">
    <!-- Page Header -->
    <div class="mb-12">
      <h1 class="text-4xl font-bold text-foreground mb-2">Error Boundary Test Page</h1>
      <p class="text-lg text-subtle">
        Demonstrate both error boundary components with different error types
      </p>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <!-- Section 1: Basic Error Boundary -->
      <div class="space-y-4">
        <div class="flex items-center gap-2 mb-6">
          <Fa icon={faCheckCircle} class="w-6 h-6 text-primary" />
          <h2 class="text-2xl font-semibold text-foreground">Basic Error Boundary</h2>
        </div>

        <p class="text-sm text-subtle mb-4">
          Tests the standard ErrorBoundary component with manual retry functionality.
        </p>

        <ErrorBoundary componentName="BasicTest" fallback="Something went wrong in the basic boundary">
          <div class="space-y-3">
            <Button variant="destructive" onclick={triggerBasicError} class="w-full">
              Trigger Simple Error
            </Button>
            <p class="text-xs text-subtle">
              Throws a basic Error with a custom message
            </p>

            <Button variant="destructive" onclick={triggerBasicTypeError} class="w-full">
              Trigger TypeError
            </Button>
            <p class="text-xs text-subtle">
              Attempts to call a method on null (TypeError)
            </p>

            <div class="bg-card border border-border rounded-lg p-4 mt-4">
              <p class="text-sm text-subtle">
                ✓ Click buttons to trigger errors<br />
                ✓ Error boundary will catch and display them<br />
                ✓ Use "Try Again" to retry<br />
                ✓ Use "Reload Page" to refresh
              </p>
            </div>
          </div>
        </ErrorBoundary>
      </div>

      <!-- Section 2: Enhanced Error Boundary -->
      <div class="space-y-4">
        <div class="flex items-center gap-2 mb-6">
          <Fa icon={faTriangleExclamation} class="w-6 h-6 text-warning" />
          <h2 class="text-2xl font-semibold text-foreground">Enhanced Error Boundary</h2>
        </div>

        <p class="text-sm text-subtle mb-4">
          Tests the EnhancedErrorBoundary with automatic recovery attempts (3 retries, 2s delay).
        </p>

        <EnhancedErrorBoundary
          componentName="EnhancedTest"
          autoRecover={true}
          recoveryDelay={2000}
        >
          <div class="space-y-3">
            <Button variant="destructive" onclick={triggerEnhancedError} class="w-full">
              Trigger Error (Auto-Recover)
            </Button>
            <p class="text-xs text-subtle">
              Throws an error that will auto-retry up to 3 times
            </p>

            <Button variant="destructive" onclick={triggerEnhancedTypeError} class="w-full">
              Trigger TypeError (Auto-Recover)
            </Button>
            <p class="text-xs text-subtle">
              Throws a TypeError with automatic recovery
            </p>

            <div class="bg-card border border-border rounded-lg p-4 mt-4">
              <p class="text-sm text-subtle">
                ✓ Click buttons to trigger errors<br />
                ✓ Watch the spinner during recovery<br />
                ✓ Auto-recovery attempts 3 times<br />
                ✓ 2 second delay between attempts
              </p>
            </div>
          </div>
        </EnhancedErrorBoundary>
      </div>
    </div>

    <!-- Footer Info -->
    <div class="mt-12 p-6 bg-card border border-border rounded-lg">
      <h3 class="text-lg font-semibold text-foreground mb-3">Test Instructions</h3>
      <ul class="space-y-2 text-sm text-subtle">
        <li>• Click any button to trigger an error in that section</li>
        <li>• The error boundary will catch the error and display it</li>
        <li>• Basic boundary requires manual retry via "Try Again" button</li>
        <li>• Enhanced boundary automatically attempts recovery (3 times, 2s delay)</li>
        <li>• Use browser DevTools console to see detailed error logs</li>
        <li>• "Show Technical Details" reveals the error stack trace</li>
      </ul>
    </div>
  </div>
</div>

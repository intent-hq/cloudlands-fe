<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';
  import { navigateToFirstWorkspace } from '$lib/utils/workspace-navigation';
  import { m } from '$shared/paraglide/messages.js';

  let error = $derived(page.error);
  let status = $derived(page.status);
  let showDetails = $state(false);

  // 404s auto-redirect home instead of stranding the user on an error card;
  // if we're already at '/' render the card to avoid a redirect loop.
  let redirectingNotFound = $derived(status === 404 && page.url.pathname !== '/');

  $effect(() => {
    if (redirectingNotFound) {
      console.warn('[+error.svelte] 404, redirecting to /', { url: page.url.href, status });
      void goto('/', { replaceState: true });
    } else {
      // Log the error for debugging
      console.error('[+error.svelte]', { status, error });
    }
  });
</script>

{#if !redirectingNotFound}
  <!-- Full height container with vertical centering -->
  <div class="h-full flex items-center justify-center p-6 bg-background">
    <!-- Centered content container with max width -->
    <div class="w-full max-w-md" role="alert" aria-live="assertive">
      <!-- Card container -->
      <div class="bg-card border border-border rounded-xl shadow-lg p-8 space-y-6 text-center">
        <!-- Warning Icon - Large and centered -->
        <div class="flex justify-center">
          <div
            class="w-14 h-14 rounded-full bg-warning/10 flex items-center justify-center opacity-50"
          >
            <Fa icon={faTriangleExclamation} size="lg" class="text-warning" />
          </div>
        </div>

        <!-- Error Message - Centered -->
        <div class="space-y-3">
          <h2 class="text-2xl font-semibold text-foreground">
            {m.error_page_title()}
          </h2>
          {#if status && status !== 500}
            <p class="text-sm text-subtle">{m.error_page_status_label({ status })}</p>
          {/if}
          <p class="text-base text-subtle leading-relaxed break-words">
            {error?.message || m.error_page_unexpected_fallback()}
          </p>
        </div>

        <!-- Action Buttons - Centered horizontally -->
        <div class="flex items-center justify-center gap-3 flex-wrap">
          <Button variant="outline" size="default" onclick={() => window.location.reload()}>
            {m.error_page_reload_button()}
          </Button>
          <Button variant="default" size="default" onclick={() => void navigateToFirstWorkspace()}>
            {m.layout_sidebarNav_allWorkspaces_title()}
          </Button>
        </div>

        <!-- Show Details Button - Only if error message exists -->
        {#if error?.message}
          <div class="w-full flex flex-col items-center">
            <button
              class="text-sm text-muted-foreground hover:text-muted-foreground transition-colors"
              onclick={() => (showDetails = !showDetails)}
            >
              {showDetails ? m.error_page_hideDetails_label() : m.error_page_showDetails_label()}
            </button>

            <!-- Stack Trace Details - Full width with proper overflow handling -->
            {#if showDetails}
              <div class="relative w-full pt-3" transition:slide={{ axis: 'y' }}>
                <div class="p-4 border border-border/50 rounded bg-muted/30">
                  <pre
                    class="text-xs font-mono text-subtle leading-relaxed overflow-x-auto max-h-64 text-left whitespace-pre-wrap break-all">{m.error_page_statusLine_label(
                      { status },
                    )}
{m.error_page_messageLine_label({ message: error?.message ?? '' })}</pre>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

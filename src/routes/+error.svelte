<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Fa from 'svelte-fa';
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  let error = $derived(page.error);
  let status = $derived(page.status);

  // Root boundary: catches URLs that match no route at all (the (app) group
  // boundary only covers errors inside the group). 404s auto-redirect home
  // instead of stranding the user; if we're already at '/' render the card
  // to avoid a redirect loop.
  let redirectingNotFound = $derived(status === 404 && page.url.pathname !== '/');

  $effect(() => {
    if (redirectingNotFound) {
      console.warn('[+error.svelte:root] 404, redirecting to /', { url: page.url.href, status });
      void goto('/', { replaceState: true });
    } else {
      // Log the error for debugging
      console.error('[+error.svelte:root]', { status, error });
    }
  });
</script>

{#if !redirectingNotFound}
  <div class="min-h-screen flex items-center justify-center p-6 bg-background">
    <div class="w-full max-w-md" role="alert" aria-live="assertive">
      <div class="bg-card border border-border rounded-xl shadow-lg p-8 space-y-6 text-center">
        <div class="flex justify-center">
          <div
            class="w-14 h-14 rounded-full bg-warning/10 flex items-center justify-center opacity-50"
          >
            <Fa icon={faTriangleExclamation} size="lg" class="text-warning" />
          </div>
        </div>

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

        <div class="flex items-center justify-center gap-3 flex-wrap">
          <Button variant="outline" size="default" onclick={() => window.location.reload()}>
            {m.error_page_reload_button()}
          </Button>
        </div>
      </div>
    </div>
  </div>
{/if}

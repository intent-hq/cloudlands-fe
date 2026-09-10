<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { claudeLoginRequested } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { store as appStore } from '$store/renderer/store';

  let opening = $state(false);
  let error = $state<string | null>(null);

  async function login(event: MouseEvent) {
    event.stopPropagation();
    if (opening) return;
    opening = true;
    error = null;

    try {
      const request = claudeLoginRequested();
      appStore.dispatch(request);
      await request.promise;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.terminal_adapter_openFailed_error();
    } finally {
      opening = false;
    }
  }
</script>

<Button
  type="button"
  variant="outline"
  size="sm"
  class="disabled:pointer-events-auto"
  disabled={opening}
  aria-busy={opening}
  onclick={login}
  onkeydown={(event) => event.stopPropagation()}
>
  {m.onboarding_providerCard_logIn_label()}
</Button>
{#if error}
  <p role="alert" class="mt-2 text-xs text-danger">{error}</p>
{/if}

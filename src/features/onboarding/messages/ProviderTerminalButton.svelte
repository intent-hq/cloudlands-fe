<script lang="ts">
  /**
   * Runs a provider's login or install command in the root terminal drawer,
   * so setup needs no terminal outside Intent.
   */
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import {
    providerInstallRequested,
    providerLoginRequested,
  } from '$store/renderer/slices/agent-availability/agent-availability-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    providerId: string;
    kind: 'login' | 'install';
  }

  let { providerId, kind }: Props = $props();

  let opening = $state(false);
  let error = $state<string | null>(null);

  async function run(event: MouseEvent) {
    event.stopPropagation();
    if (opening) return;
    opening = true;
    error = null;

    try {
      await appStore.dispatch(
        kind === 'install'
          ? providerInstallRequested(providerId)
          : providerLoginRequested(providerId),
      );
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m.terminal_adapter_openFailed_error();
    } finally {
      opening = false;
    }
  }
</script>

<div class="flex min-w-0 flex-col items-start gap-2">
  <Button
    type="button"
    variant="secondary"
    size="sm"
    class="disabled:pointer-events-auto"
    disabled={opening}
    aria-busy={opening}
    onclick={run}
    onkeydown={(event) => event.stopPropagation()}
  >
    {kind === 'install'
      ? m.onboarding_providerCard_install_label()
      : m.onboarding_providerCard_logIn_label()}
  </Button>
  {#if error}
    <p role="alert" class="text-xs text-foreground rounded-md bg-background px-2 py-1">{error}</p>
  {/if}
</div>

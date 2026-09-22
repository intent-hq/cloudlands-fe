<script lang="ts">
  /**
   * Mounts the invite-progress modal and owns the renderer service lifecycle
   * (install on mount, dispose on destroy) so the app layout only needs a
   * single mount line.
   */
  import { onMount } from 'svelte';
  import InviteProgressModal from '$lib/components/modals/InviteProgressModal.svelte';
  import type { InviteProgressShowPayload } from '$shared/ipc/invite-progress';
  import { cancelInviteProgress, installInviteProgressService } from './invite-progress-service';

  let open = $state(false);
  let payload = $state<InviteProgressShowPayload | null>(null);

  onMount(() =>
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous IPC listener install/dispose for a transient main-process progress dialog (ephemeral UI state, not Redux domain data)
    installInviteProgressService({
      onShow: (next) => {
        payload = next;
        open = true;
      },
      onUpdate: (next) => {
        payload = next;
      },
      onDismiss: () => {
        open = false;
        payload = null;
      },
    }),
  );

  function cancel() {
    payload = null;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- fire-and-forget cancel of the transient progress dialog; nothing is loaded
    cancelInviteProgress();
  }
</script>

<InviteProgressModal bind:open {payload} onCancel={cancel} />

<script lang="ts">
  /**
   * Mounts the invite-notice modal and owns the renderer service lifecycle
   * (install on mount, dispose on destroy) so the app layout only needs a
   * single mount line.
   */
  import { onMount } from 'svelte';
  import InviteNoticeModal from '$lib/components/modals/InviteNoticeModal.svelte';
  import type { InviteNoticeShowPayload } from '$shared/ipc/invite-notice';
  import { acknowledgeInviteNotice, installInviteNoticeService } from './invite-notice-service';

  let open = $state(false);
  let payload = $state<InviteNoticeShowPayload | null>(null);

  onMount(() =>
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous IPC listener install/dispose for a transient main-process notice (ephemeral UI state, not Redux domain data)
    installInviteNoticeService({
      onShow: (next) => {
        payload = next;
        open = true;
      },
      onDismiss: () => {
        open = false;
        payload = null;
      },
    }),
  );

  function acknowledge() {
    payload = null;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- fire-and-forget acknowledgement of the transient notice; nothing is loaded
    acknowledgeInviteNotice();
  }
</script>

<InviteNoticeModal bind:open {payload} onAcknowledge={acknowledge} />

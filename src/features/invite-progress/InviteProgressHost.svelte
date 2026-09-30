<script lang="ts">
  /**
   * Mounts the invite-progress modal and owns the renderer service lifecycle
   * (install on mount, dispose on destroy) so the app layout only needs a
   * single mount line.
   */
  import { onMount } from 'svelte';
  import InviteProgressModal from '$lib/components/modals/InviteProgressModal.svelte';
  import type { InviteProgressShowPayload } from '$shared/ipc/invite-progress';
  import {
    cancelInviteProgress,
    retryInviteProgress,
    installInviteProgressService,
  } from './invite-progress-service';
  import { store } from '$store/renderer/store';
  import { openPalette } from '$store/renderer/slices/palette/palette-slice';
  import { selectIsPaletteOpen } from '$store/renderer/slices/palette/palette-selectors';
  const paletteOpen$ = selectIsPaletteOpen();

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

  function findMultiplayer() {
    store.dispatch(openPalette('Multiplayer')); // i18n-ignore (feature command search)
  }

  function cancel() {
    payload = null;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- fire-and-forget cancel of the transient progress dialog; nothing is loaded
    cancelInviteProgress();
  }
</script>

<InviteProgressModal
  bind:open
  {payload}
  onCancel={cancel}
  recoveryHidden={$paletteOpen$}
  onFindMultiplayer={findMultiplayer}
  onRetry={() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- explicit retry of an ephemeral main-process invitation; no domain data is fetched here
    void retryInviteProgress().catch(() => {});
  }}
/>

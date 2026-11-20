<script lang="ts">
  /** Mounts the browser-panel passkey dialog and owns its IPC listener lifecycle. */
  import { onMount } from 'svelte';
  import type { PasskeyDialogShowPayload } from '$shared/ipc/passkeys';
  import PasskeyDialog from './PasskeyDialog.svelte';
  import { installPasskeyDialogService, respondToPasskeyDialog } from './passkey-dialog-service';

  let payload = $state<PasskeyDialogShowPayload | null>(null);

  onMount(() =>
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous IPC listener install/dispose for a transient main-process dialog (ephemeral UI state, not Redux domain data)
    installPasskeyDialogService({
      onShow: (next) => {
        payload = next;
      },
      onClose: (ceremonyId) => {
        if (payload?.ceremonyId === ceremonyId) payload = null;
      },
    }),
  );
</script>

<PasskeyDialog
  {payload}
  onRespond={(answer) => {
    if (!payload) return;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- fire-and-forget answer to the main-process ceremony; nothing is loaded
    respondToPasskeyDialog({ ...answer, ceremonyId: payload.ceremonyId });
  }}
/>

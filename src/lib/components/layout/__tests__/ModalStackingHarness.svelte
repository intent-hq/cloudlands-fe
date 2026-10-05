<script lang="ts">
  // protocol-version-ok-file: intentionally mismatched fixture versions exercise advisory UI.
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import DaemonStatusIndicator from '../DaemonStatusIndicator.svelte';
  import QuitConfirmationModal from '$lib/components/modals/QuitConfirmationModal.svelte';
  import ReleaseNotesModal from '$lib/components/modals/ReleaseNotesModal.svelte';
  import { store } from '$store/renderer/store';
  import {
    connectionsListReceived,
    protocolMismatchReceived,
    protocolMismatchModalDismissed,
  } from '$store/renderer/slices/connections/connections-slice';
  import type { ConnectionProtocolMismatchEvent } from '$shared/types/connections';
  import type { QuitConfirmationShowPayload } from '$shared/ipc/quit-confirmation';

  let {
    updateKind,
    protocolOpen = false,
    updateOpen = false,
  }: {
    updateKind: 'quit' | 'release-notes';
    protocolOpen?: boolean;
    updateOpen?: boolean;
  } = $props();

  const mismatch: ConnectionProtocolMismatchEvent = {
    id: 'modal-stacking-demo',
    host: 'demo.invalid',
    port: 443,
    localProtocolVersion: '1.0',
    remoteProtocolVersion: '2.0',
    origin: 'switch',
  };
  const quitPayload: QuitConfirmationShowPayload = {
    requestId: 'modal-stacking-demo',
    interrupted: [],
    disruptedBrowserTabs: [{ tabId: 'demo-tab', ownerAgentId: 'demo-agent' }],
  };
  let backgroundActions = $state(0);
  let quitProceeds = $state(0);
  let quitCancels = $state(0);
  let releaseDismissals = $state(0);

  store.dispatch(
    connectionsListReceived({
      connections: [
        {
          id: mismatch.id,
          label: 'Demo backend',
          host: mismatch.host,
          port: mismatch.port,
          fingerprint: null,
          isLocal: false,
        },
      ],
      activeId: mismatch.id,
      windowBackendId: mismatch.id,
    }),
  );

  // CT initializes the real reducer store without production sagas or IPC middleware.
  // Feed only the incoming notice; no update, install, or connection action is invoked.
  $effect(() => {
    store.dispatch(
      protocolOpen ? protocolMismatchReceived(mismatch) : protocolMismatchModalDismissed(),
    );
  });
  onDestroy(() => store.dispatch(protocolMismatchModalDismissed()));
</script>

<div class="p-6" data-testid="modal-stacking-background">
  <Button onclick={() => backgroundActions++}>Background action</Button>
  <DaemonStatusIndicator />
</div>
<output
  data-testid="modal-stacking-actions"
  data-background={backgroundActions}
  data-quit-proceeds={quitProceeds}
  data-quit-cancels={quitCancels}
  data-release-dismissals={releaseDismissals}
></output>

{#if updateKind === 'quit'}
  <QuitConfirmationModal
    bind:open={updateOpen}
    payload={quitPayload}
    onRespond={(proceed) => {
      if (proceed) quitProceeds++;
      else quitCancels++;
    }}
  />
{:else}
  <ReleaseNotesModal
    bind:open={updateOpen}
    releaseNotes={{
      version: '0.0.0-demo',
      notes: '## Demo release\n\nSafe, isolated modal stacking verification.',
      url: 'https://example.invalid/demo-release',
    }}
    onClose={() => {
      updateOpen = false;
      releaseDismissals++;
    }}
  />
{/if}

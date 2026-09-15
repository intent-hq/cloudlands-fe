<script lang="ts">
  /* eslint-disable intent/no-component-async-data-fetch -- this host coordinates ephemeral UI promises; it does not load domain data */
  import ConfirmRequestView from './ConfirmRequestView.svelte';
  import { onMount } from 'svelte';
  import {
    settleConfirmRequest,
    subscribeConfirmRequests,
    type ConfirmRequest,
  } from './confirm-service';

  let request = $state<ConfirmRequest | null>(null);
  let value = $state('');
  let busy = $state(false);

  onMount(() =>
    subscribeConfirmRequests((next) => {
      request = next;
      value = next?.kind === 'prompt' ? (next.options.field.initialValue ?? '') : '';
      busy = false;
    }),
  );

  function cancel() {
    if (!request || busy) return;
    settleConfirmRequest(request.id, request.kind === 'confirm' ? false : null);
  }

  async function accept() {
    if (!request || busy) return;
    const current = request;
    busy = true;
    try {
      if (current.kind === 'confirm') {
        await current.options.onConfirm?.();
        settleConfirmRequest(current.id, true);
      } else if (current.kind === 'prompt') {
        await current.options.onConfirm?.(value.trim());
        settleConfirmRequest(current.id, value.trim());
      } else {
        settleConfirmRequest(current.id, undefined);
      }
    } catch (error) {
      console.error('Confirm action failed:', error);
      busy = false;
    }
  }
</script>

{#if request}
  <ConfirmRequestView {request} bind:value {busy} onAccept={accept} onCancel={cancel} />
{/if}

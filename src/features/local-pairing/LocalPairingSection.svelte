<script lang="ts">
  /**
   * Settings → Machines, host side of local code pairing (Labs). Shown only
   * when `selectLocalPairingVisible` holds; see `local-pairing-saga.ts` for why
   * the window must be bound to this computer's own daemon.
   */
  import { onDestroy, onMount } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import LocalPairingCodePanel from './LocalPairingCodePanel.svelte';
  import LocalIntentsList from './LocalIntentsList.svelte';
  import { codePanelView } from './local-pairing-model';
  import {
    registerLocalPairingCodeText,
    type LocalPairingCodeText,
  } from './local-pairing-code-text';
  import { selectLocalPairing, selectLocalPairingVisible } from './local-pairing-selectors';
  import {
    localPairingCancelRequested,
    localPairingCloseRequested,
    localPairingCodeRequested,
    localPairingListenerConfirmed,
    localPairingRefreshRequested,
    localPairingRemoveFailureDismissed,
    localPairingRemoveRequested,
  } from './local-pairing-slice';

  const visible$ = selectLocalPairingVisible();
  const state$ = selectLocalPairing();
  let heldCode = $state<LocalPairingCodeText | null>(null);
  onMount(() => registerLocalPairingCodeText((value) => (heldCode = value)));

  let nowMs = $state(Date.now());
  const active = $derived($state$.step === 'open' && $state$.code?.state === 'active');
  // Seconds while a code counts down; otherwise often enough for "Last used".
  $effect(() => {
    const timer = setInterval(() => (nowMs = Date.now()), active ? 1_000 : 30_000);
    nowMs = Date.now();
    return () => clearInterval(timer);
  });

  const view = $derived(codePanelView($state$.step, $state$.code, $state$.failure, nowMs));
  const codeText = $derived(
    $state$.code && heldCode?.codeId === $state$.code.codeId ? heldCode.code : null,
  );

  onMount(() => appStore.dispatch(localPairingRefreshRequested()));
  // Leaving Settings never leaves a usable code on screen nobody watches.
  onDestroy(() => {
    if ($state$.step !== 'closed') appStore.dispatch(localPairingCloseRequested());
  });
</script>

{#if $visible$}
  <div class="space-y-5" data-testid="local-pairing-section">
    <LocalPairingCodePanel
      {view}
      {codeText}
      onShow={() => appStore.dispatch(localPairingCodeRequested())}
      onConfirmListener={() => appStore.dispatch(localPairingListenerConfirmed())}
      onCancel={() => appStore.dispatch(localPairingCancelRequested())}
      onClose={() => appStore.dispatch(localPairingCloseRequested())}
    />
    <LocalIntentsList
      credentials={$state$.credentials}
      removing={$state$.removing}
      removeFailed={$state$.removeFailed}
      now={new Date(nowMs)}
      onRemove={(id) => appStore.dispatch(localPairingRemoveRequested(id))}
      onDismissFailure={(id) => appStore.dispatch(localPairingRemoveFailureDismissed(id))}
    />
  </div>
{/if}

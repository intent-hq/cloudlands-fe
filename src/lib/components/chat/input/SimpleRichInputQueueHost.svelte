<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { store } from '$store/renderer/store';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import SimpleRichInput from './SimpleRichInput.svelte';
  import QueuedMessageList from '../QueuedMessageList.svelte';
  import EventSubscriptionsCard from '../EventSubscriptionsCard.svelte';

  let {
    streaming = false,
    queueCount = 12,
    width = 360,
  }: { streaming?: boolean; queueCount?: number; width?: number } = $props();
  const fixtureDispatch = store.dispatch;
  const previousPrincipal = untrack(() => store.state.principal);
  // This fixture sends a new message without an existing workspace.
  untrack(() => admitLegacyPrincipal());
  const fixturePrincipal = untrack(() => store.state.principal);
  onDestroy(() => {
    if (store.dispatch !== fixtureDispatch || store.state.principal !== fixturePrincipal) return;
    store.dispatch(principalContextChanged(previousPrincipal.context));
    if (previousPrincipal.context && previousPrincipal.snapshot)
      store.dispatch(
        principalReceived(
          { context: previousPrincipal.context, invalidation: 0, presentationVersion: 0 },
          previousPrincipal.snapshot,
        ),
      );
  });

  let value = $state('');
  let lastAction = $state('');
  const messages = $derived(
    Array.from({ length: queueCount }, (_, i) => ({
      id: `queue-${i}`,
      // i18n-ignore (test-only component fixture content)
      content: `Queued message ${i + 1}`,
      queuedAt: '2026-01-01T00:00:00.000Z',
      position: i,
    })),
  );
</script>

<div class="group/panel flex flex-col" style="height: 560px;" style:width="{width}px">
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div class="mt-auto" style:--queued-messages-max-height="280px">
      <div class="has-[>_*]:pb-2"><QueuedMessageList {messages} /></div>
      <EventSubscriptionsCard
        workspaceId="queue-test"
        agentId="queue-test"
        isolatedPreview={{ count: 2, initiallyExpanded: false }}
      />
    </div>
  </div>
  <div class="shrink-0">
    <SimpleRichInput
      bind:value
      workspace={null}
      isStreaming={streaming}
      isResponding={streaming}
      onsubmit={() => (lastAction = 'sent')}
      onstop={() => (lastAction = 'stopped')}
    />
  </div>
</div>
<output>{lastAction}</output>

<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    state?: 'failed' | 'queued' | 'attempting' | 'recovered' | 'retired';
    partial?: boolean;
    longError?: boolean;
    details?: boolean;
    width?: number;
  }
  export const preview = definePreview<Props>({
    id: 'failure-recovery',
    title: 'Repeated failure recovery',
    defaultState: 'repeated-failures',
    states: {
      'repeated-failures': { props: { state: 'queued' } },
      'action-needed': { props: { state: 'failed' } },
      attempting: { props: { state: 'attempting' } },
      details: { props: { state: 'failed', details: true } },
      'long-error': { props: { state: 'failed', longError: true, details: true } },
      narrow: { props: { state: 'queued', width: 320 } },
      'partial-output': { props: { state: 'failed', partial: true } },
      'read-only': { props: { state: 'retired' } },
      recovered: { props: { state: 'recovered', partial: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { appClient } from '$lib/client';
  import { store } from '$store/renderer/store';
  import { selectAgentQueueMessages } from '$store/renderer/slices/agent-queue/agent-queue-selectors';
  import type { AgentMessage } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import ChatPanelOperationalGeometryHost from './__tests__/ChatPanelOperationalGeometryHost.svelte';
  let {
    state: recoveryState = 'failed',
    partial = false,
    longError = false,
    details = false,
    width,
  }: Props = $props();
  const previousGetQueue = appClient.agents.getQueue;
  appClient.agents.getQueue = async (agentId) =>
    agentId === 'chat-panel-operational-agent'
      ? selectAgentQueueMessages.select(store.state, agentId, 'chat-panel-operational-geometry')
      : previousGetQueue.call(appClient.agents, agentId);
  onDestroy(() => {
    appClient.agents.getQueue = previousGetQueue;
  });
  let root: HTMLDivElement;
  let measuredWidth = $state(720);
  const error = $derived(
    longError
      ? `Failed to load workspace requirements: ${'unbroken-provider-diagnostic-'.repeat(32)}\nOriginal backend diagnostic retained.`
      : 'Failed to load workspace requirements: workspace service unavailable',
  );
  const messages = $derived.by(() => {
    const message = (
      id: string,
      seq: number,
      role: AgentMessage['role'],
      text: string,
      failure = false,
    ): AgentMessage => ({
      id,
      seq,
      role,
      timestamp: '2026-08-17T12:00:00.000Z',
      contentBlocks: [
        { type: 'text', text, ...(failure ? { meta: { kind: 'turn-failure' } } : {}) },
      ],
    });
    return [
      message(
        'recovery-user',
        1,
        'user',
        'Review the changes and tell me what still needs attention.',
      ),
      message('failure-one', 2, 'system', error, true),
      message('failure-two', 3, 'system', error, true),
      ...(partial
        ? [
            message(
              'partial-work',
              4,
              'assistant',
              'I reviewed the changed files. The validation results still need checking.',
            ),
          ]
        : []),
      message('failure-three', partial ? 5 : 4, 'system', error, true),
      ...(recoveryState === 'recovered'
        ? [
            message(
              'recovered-reply',
              6,
              'assistant',
              'The review is complete. The validation results are now checked.',
            ),
          ]
        : []),
    ];
  });
  onMount(() => {
    if (!details) return;
    let disposed = false;
    let observer: MutationObserver | undefined;
    void tick().then(() => {
      if (disposed) return;
      observer = new MutationObserver(openDetails);
      function openDetails() {
        const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent?.trim() === m.chat_failureRecovery_details_label(),
        );
        if (button) {
          button.click();
          observer?.disconnect();
        }
      }
      observer.observe(root, { childList: true, subtree: true });
      openDetails();
    });
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  });
</script>

<div
  bind:this={root}
  bind:clientWidth={measuredWidth}
  data-testid="failure-recovery-preview"
  class="w-full min-w-0 max-w-full"
>
  <ChatPanelOperationalGeometryHost
    initializeStore={false}
    width={width ?? measuredWidth}
    height={820}
    liveMessages={messages}
    liveStreaming={false}
    failureRecovery={{ state: recoveryState, error }}
  />
</div>

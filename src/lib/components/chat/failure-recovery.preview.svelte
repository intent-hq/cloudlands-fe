<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    state?: 'failed' | 'queued' | 'attempting' | 'recovered' | 'retired';
    partial?: boolean;
    longError?: boolean;
    details?: boolean;
    history?: boolean;
    signIn?: boolean;
    width?: number;
  }
  export const preview = definePreview<Props>({
    id: 'failure-recovery',
    title: 'Repeated failure recovery',
    defaultState: 'repeated-failures',
    states: {
      'repeated-failures': { props: { state: 'queued' } },
      'expired-sign-in': { props: { state: 'queued', signIn: true } },
      'action-needed': { props: { state: 'failed' } },
      attempting: { props: { state: 'attempting' } },
      details: { props: { state: 'failed', details: true } },
      'history-details': { props: { state: 'recovered', partial: true, history: true } },
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
  import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
  import type { AgentMessage } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import ChatPanelOperationalGeometryHost from './__tests__/ChatPanelOperationalGeometryHost.svelte';
  let {
    state: recoveryState = 'failed',
    partial = false,
    longError = false,
    details = false,
    history = false,
    signIn = false,
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
  const signInReply = 'Failed to authenticate: OAuth session expired and could not be refreshed';
  const error = $derived(
    signIn
      ? 'session/prompt: provider "claude-code" (Anthropic Claude Code) is not authenticated — run "claude auth login" in a terminal, then retry. Note: signing into the Claude desktop app does not carry over to the CLI — run "claude" in a terminal, then "/login".'
      : longError
        ? `Failed to load workspace requirements: ${'unbroken-provider-diagnostic-'.repeat(32)}\nOriginal backend diagnostic retained.`
        : 'Failed to load workspace requirements: workspace service unavailable',
  );
  const messages = $derived.by(() => {
    // The latest failure carries the session's failure time; earlier rows are a minute apart.
    const latestFailure = signIn ? 7 : partial ? 5 : 4;
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
      timestamp: new Date(
        Date.parse('2026-08-17T12:00:00.000Z') + (seq - latestFailure) * 60_000,
      ).toISOString(),
      contentBlocks: [
        { type: 'text', text, ...(failure ? { meta: { kind: 'turn-failure' } } : {}) },
      ],
    });
    const request = message(
      'recovery-user',
      1,
      'user',
      'Review the changes and tell me what still needs attention.',
    );
    if (signIn)
      return [
        request,
        ...[1, 2, 3].flatMap((attempt) => [
          message(`sign-in-reply-${attempt}`, attempt * 2, 'assistant', signInReply),
          message(`sign-in-failure-${attempt}`, attempt * 2 + 1, 'system', error, true),
        ]),
      ];
    return [
      request,
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
      message('failure-three', latestFailure, 'system', error, true),
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
  // Claude Code on this host: its sign-in failure offers Log in.
  $effect(() => {
    if (signIn)
      store.dispatch(updateSession('chat-panel-operational-agent', { provider: 'claude-code' }));
  });
  onMount(() => {
    if (!details && !history) return;
    let disposed = false;
    let observer: MutationObserver | undefined;
    void tick().then(() => {
      if (disposed) return;
      observer = new MutationObserver(openDetails);
      function openDetails() {
        const button = history
          ? root.querySelector<HTMLButtonElement>('.turn-failure-notice button[aria-expanded]')
          : [...root.querySelectorAll<HTMLButtonElement>('button')].find(
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

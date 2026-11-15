<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    theme?: 'light' | 'dark';
    width?: number;
    enabled?: boolean;
    expand?: boolean;
    /** Scroll so the expanded hint leaves the top: `inside` the run or `past` it. */
    scroll?: 'inside' | 'past';
    live?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'automated-activity',
    title: 'Hide automated activity (Labs)',
    defaultState: 'collapsed',
    states: {
      collapsed: { props: {} },
      expanded: { props: { expand: true } },
      'pinned-inside': { props: { expand: true, scroll: 'inside' } },
      'pinned-past': { props: { expand: true, scroll: 'past' } },
      live: { props: { live: true } },
      off: { props: { enabled: false } },
      dark: { props: { theme: 'dark' } },
      narrow: { props: { width: 360 } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { AgentMessage } from '$shared/types';
  import { appClient } from '$lib/client';
  import { store } from '$store/renderer/store';
  import { setLabsHideAutomatedActivityEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import ChatPanelComposerGeometryHost from './__tests__/ChatPanelComposerGeometryHost.svelte';

  let {
    theme = 'light',
    width = 720,
    enabled = true,
    expand = false,
    scroll,
    live = false,
  }: Props = $props();

  const previous = store.state.userPreferences.labsHideAutomatedActivityEnabled;
  store.dispatch(setLabsHideAutomatedActivityEnabled(untrack(() => enabled)));
  const previousGetQueue = appClient.agents.getQueue;
  appClient.agents.getQueue = async () => [];
  onDestroy(() => {
    appClient.agents.getQueue = previousGetQueue;
    store.dispatch(setLabsHideAutomatedActivityEnabled(previous));
  });

  let at = Date.parse('2026-11-14T09:00:00.000Z');
  const text = (id: string, role: AgentMessage['role'], body: string, metadata?: object) =>
    ({
      id,
      role,
      timestamp: new Date((at += 30_000)).toISOString(),
      contentBlocks: [{ type: 'text', text: body }],
      ...(metadata ? { metadata } : {}),
    }) as AgentMessage;

  const automated = (fixtureLive: boolean): AgentMessage[] => [
    text('hook-1', 'user', '[Background hook "CI watcher"] CI finished: 1 check failed (lint).', {
      type: 'hook_wake',
      source: 'system',
      hookName: 'CI watcher',
      hookId: 'hook-ci',
      reason: 'dispatched',
    }),
    text(
      'hook-1-r',
      'assistant',
      'Lint failed on an unused import. I removed it and pushed again.',
    ),
    text('agent-1', 'user', 'Use waitForResponse instead of polling the cookie jar.', {
      type: 'agent_message',
      fromAgentId: 'reviewer-agent',
      fromAgentName: 'Reviewer',
    }),
    text('agent-1-r', 'assistant', 'Good point. I switched to waitForResponse on /session.'),
    text('pr-1', 'user', 'All checks passed. 1 new review comment.', {
      type: 'pr_monitor_wake',
      source: 'system',
      repo: 'acme/web',
      prNumber: 812,
    }),
    ...(fixtureLive
      ? []
      : [text('pr-1-r', 'assistant', 'I answered the review comment and resolved the thread.')]),
  ];

  const messages = untrack(() => [
    text('user-1', 'user', 'The login test fails about 1 run in 5. Find out why and fix it.'),
    text(
      'user-1-r',
      'assistant',
      'The test waits for a fixed 200 ms before it reads the session cookie. I replaced the wait with an explicit wait on the cookie and pushed the branch.',
    ),
    ...automated(false),
    text('user-2', 'user', 'Great. Summarize what changed so I can post it in the team channel.'),
    text(
      'user-2-r',
      'assistant',
      'The login test now waits on the /session response, not on a timer. The fix is in PR #812, CI is green and the review thread is resolved.\n\n<!-- suggested-prompts\nMerge PR #812.\nApply the same fix to the signup test.\n-->',
    ),
    ...(live ? automated(true).map((message) => ({ ...message, id: `live-${message.id}` })) : []),
  ]);

  let host: HTMLDivElement;
  onMount(() => {
    if (!expand) return;
    let frames = 0;
    let handle = 0;
    const step = () => {
      const toggle = host.querySelector<HTMLButtonElement>('[data-automated-run-hint] button');
      const container = host.querySelector<HTMLElement>(
        '[data-testid="chat-transcript-scroll-viewport"]',
      );
      if (!toggle || !container) {
        if (frames++ < 240) handle = requestAnimationFrame(step);
        return;
      }
      toggle.click();
      if (!scroll) return;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const turns = container.querySelectorAll<HTMLElement>('[data-automated-run-turn]');
          const target =
            scroll === 'inside'
              ? turns[1]
              : host.querySelector<HTMLElement>('[data-message-id="user-2"]');
          if (!target) return;
          container.scrollTop +=
            target.getBoundingClientRect().top - container.getBoundingClientRect().top - 24;
        }),
      );
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  });
</script>

<div bind:this={host}>
  <ChatPanelComposerGeometryHost {theme} {width} height={560} {messages} streaming={live} />
</div>

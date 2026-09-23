<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Group = 'standard' | 'fallbacks' | 'different-request' | 'boundaries';
  type Scenario = {
    id: string;
    title: string;
    expected: string;
  };
  interface Props {
    group: Group;
  }

  const groups: Record<Group, Scenario[]> = {
    standard: [
      { id: 'saved', title: 'Saved notice is present', expected: 'One notice. No reminder.' },
      {
        id: 'history',
        title: 'Notice is in loaded scrollback',
        expected: 'One notice. No reminder.',
      },
      {
        id: 'running',
        title: 'Agent resumes automatically',
        expected: 'Pending request stays visible once.',
      },
      {
        id: 'resolved',
        title: 'User has replied',
        expected: 'Saved notice stays. Pending reminder is cleared.',
      },
    ],
    fallbacks: [
      {
        id: 'missing',
        title: 'Saved notice is missing',
        expected: 'Fallback keeps the request and reason visible.',
      },
      {
        id: 'missing-reason',
        title: 'Reason is missing',
        expected: 'Fallback shows its label and time.',
      },
      {
        id: 'missing-time',
        title: 'Request timestamp is missing',
        expected: 'Keep the fallback; the saved notice cannot be identified safely.',
      },
      {
        id: 'invalid-time',
        title: 'Request timestamp is invalid',
        expected: 'Keep the fallback; the saved notice cannot be identified safely.',
      },
    ],
    'different-request': [
      {
        id: 'older',
        title: 'Same wording, older notice',
        expected: 'Keep both: the pending request is newer.',
      },
      {
        id: 'newer',
        title: 'Same wording, later notice',
        expected: 'Keep both: the timestamps identify different requests.',
      },
      {
        id: 'wrong-kind',
        title: 'Same wording, different request kind',
        expected: 'A discussion does not replace a blocker, or vice versa.',
      },
      {
        id: 'wrong-reason',
        title: 'Same time, different reason',
        expected: 'Keep both distinct explanations.',
      },
    ],
    boundaries: [
      {
        id: 'assistant',
        title: 'Matching words in an assistant message',
        expected: 'Ordinary chat text does not replace an attention notice.',
      },
      {
        id: 'failure',
        title: 'Matching words in a failure notice',
        expected: 'A turn failure does not replace the pending request.',
      },
      {
        id: 'invalid-message-time',
        title: 'Saved notice timestamp is invalid',
        expected: 'Keep the fallback rather than hide an unidentified request.',
      },
      {
        id: 'equivalent-time',
        title: 'Same time, different ISO formatting',
        expected: 'One notice. No reminder.',
      },
    ],
  };

  export const preview = definePreview<Props>({
    id: 'attention-dedup',
    title: 'Attention notice edge cases',
    defaultState: 'standard',
    states: {
      standard: { props: { group: 'standard' } },
      fallbacks: { props: { group: 'fallbacks' } },
      'different-request': { props: { group: 'different-request' } },
      boundaries: { props: { group: 'boundaries' } },
    },
  });
</script>

<script lang="ts">
  import { store } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    prependHistoryMessages,
    removeSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import type { AgentMessage, AgentSession } from '$shared/types';
  import AttentionRequestBanner from './AttentionRequestBanner.svelte';
  import BlockerReportNotice from './BlockerReportNotice.svelte';
  import DiscussionRequestNotice from './DiscussionRequestNotice.svelte';
  import TurnFailureNotice from './TurnFailureNotice.svelte';
  import { getAttentionNotice } from './attention-notice';

  let { group }: Props = $props();
  const timestamp = '2026-09-23T03:00:00Z';
  const cases = $derived(
    groups[group].flatMap((scenario) =>
      (['blocker', 'discussion'] as const).map((kind) => {
        const id = `preview-attention-dedup-${scenario.id}-${kind}`;
        const reason =
          kind === 'blocker'
            ? 'Git identity is missing. Configure it to save the commit.'
            : 'The change is ready. Please choose whether to open a pull request.';
        const pendingReason = scenario.id === 'missing-reason' ? undefined : reason;
        const requestTimestamp =
          scenario.id === 'missing-time'
            ? undefined
            : scenario.id === 'invalid-time'
              ? 'invalid'
              : timestamp;
        const noticeKind =
          scenario.id === 'failure'
            ? 'turn-failure'
            : (kind === 'blocker') !== (scenario.id === 'wrong-kind')
              ? 'blocker-report'
              : 'discussion-request';
        const messageTimestamp =
          scenario.id === 'older'
            ? '2026-09-22T03:00:00Z'
            : scenario.id === 'newer'
              ? '2026-09-24T03:00:00Z'
              : scenario.id === 'invalid-message-time'
                ? 'invalid'
                : scenario.id === 'equivalent-time'
                  ? '2026-09-23T03:00:00.000Z'
                  : timestamp;
        const message: AgentMessage | null = ['missing', 'missing-reason'].includes(scenario.id)
          ? null
          : {
              id: `${id}-notice`,
              role: scenario.id === 'assistant' ? 'assistant' : 'system',
              timestamp: messageTimestamp,
              contentBlocks: [
                {
                  type: 'text',
                  text:
                    scenario.id === 'wrong-reason'
                      ? 'The preview server is unavailable. Restart it before continuing.'
                      : reason,
                  meta: { kind: noticeKind },
                },
              ],
            };
        return { ...scenario, agentId: id, kind, reason, pendingReason, requestTimestamp, message };
      }),
    ),
  );

  $effect(() => {
    const fixtures = cases;
    store.dispatch(
      bulkUpsertSessions(
        fixtures.map(
          (item) =>
            ({
              id: item.agentId,
              workspaceId: 'preview-attention-dedup',
              name: 'Preview agent',
              status: item.id === 'running' ? 'active' : 'idle',
              messages: item.message && item.id !== 'history' ? [item.message] : [],
              attentionRequestKind: item.id === 'resolved' ? undefined : item.kind,
              attentionRequestReason: item.id === 'resolved' ? undefined : item.pendingReason,
              attentionRequestTimestamp: item.id === 'resolved' ? undefined : item.requestTimestamp,
              createdAt: timestamp,
              updatedAt: timestamp,
            }) as unknown as AgentSession,
        ),
      ),
    );
    for (const item of fixtures) {
      if (item.id === 'history' && item.message) {
        store.dispatch(prependHistoryMessages(item.agentId, [item.message]));
      }
    }
    return () => {
      for (const item of fixtures) store.dispatch(removeSession(item.agentId));
    };
  });
</script>

<div class="grid gap-6 text-foreground" data-attention-gallery={group}>
  <header class="grid gap-2">
    <h1 class="text-2xl font-semibold">Attention notices — {group.replaceAll('-', ' ')}</h1>
    <p class="text-sm text-muted-foreground">
      Blockers on the left. Discussion requests on the right.
    </p>
  </header>
  <div class="grid grid-cols-2 gap-5">
    {#each cases as item (item.agentId)}
      <section
        class="min-w-0 rounded-lg border border-border bg-background p-5"
        data-attention-case={item.agentId}
      >
        <header class="grid gap-1 border-b border-border pb-4">
          <p class="text-xs text-muted-foreground">{item.kind}</p>
          <h2 class="font-semibold">{item.title}</h2>
          <p class="text-sm text-muted-foreground">{item.expected}</p>
        </header>
        {#if item.message}
          {@const notice = getAttentionNotice(item.message)}
          {#if notice?.kind === 'blocker-report'}
            <BlockerReportNotice reason={notice.reason} />
          {:else if notice?.kind === 'discussion-request'}
            <DiscussionRequestNotice reason={notice.reason} />
          {:else if notice?.kind === 'turn-failure'}
            <TurnFailureNotice reason={notice.reason} />
          {:else}
            <p class="mt-10">{item.reason}</p>
          {/if}
        {/if}
        <AttentionRequestBanner agentId={item.agentId} />
      </section>
    {/each}
  </div>
</div>

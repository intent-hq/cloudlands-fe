<script lang="ts">
  import type { AgentSession, Workspace } from '$shared/types';
  import { Button } from '$lib/components/ui/button';
  import DismissQuestionsConfirmDialog from '$lib/components/chat/questions/DismissQuestionsConfirmDialog.svelte';
  import {
    clearWizardDraft,
    wizardDraftKey,
  } from '$lib/components/chat/questions/wizard-draft-storage';
  import { formatDateTime } from '$lib/i18n/format';
  import { store } from '$store/renderer/store';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import { getHomeAttentionRequests } from './home-attention';
  import { homeDismissQuestionAction, homeRetryAgentAction } from './home-attention-actions';

  let {
    workspace,
    agents,
    onreply,
    onreview,
  }: {
    workspace: Workspace;
    agents: AgentSession[];
    onreply: (agentId: string, questionMessageId?: string) => void;
    onreview: () => void;
  } = $props();
  const requests = $derived(getHomeAttentionRequests(workspace.id, agents));
  const needsReview = $derived(
    workspace.attention === 'review_required' || workspace.displayStatus === 'pr_ready',
  );
  let confirming = $state<{ agentId: string; messageId: string } | null>(null);
  let pending = $state<{ agentId: string; kind: 'dismiss' | 'retry' } | null>(null);
  let error = $state('');

  async function dismiss() {
    if (!confirming || pending) return;
    const target = confirming;
    confirming = null;
    error = '';
    const action = homeDismissQuestionAction(
      workspace.id,
      selectAgentSession.select(store.state, target.agentId),
      target.messageId,
    );
    if (!action) {
      error = m.home_attention_changed();
      return;
    }
    pending = { agentId: target.agentId, kind: 'dismiss' };
    try {
      await store.dispatch(action);
      clearWizardDraft(wizardDraftKey(target.agentId, target.messageId));
    } catch {
      error = m.home_attention_failure();
    } finally {
      pending = null;
    }
  }

  async function retry(agentId: string) {
    if (pending) return;
    error = '';
    const action = homeRetryAgentAction(
      workspace.id,
      selectAgentSession.select(store.state, agentId),
    );
    if (!action) {
      error = m.home_attention_changed();
      return;
    }
    pending = { agentId, kind: 'retry' };
    try {
      await store.dispatch(action);
    } catch {
      error = m.home_attention_failure();
    } finally {
      pending = null;
    }
  }
</script>

{#if requests.length || needsReview || error || pending}
  <section
    class="max-h-[40%] shrink-0 space-y-3 overflow-y-auto border-b border-border px-4 py-3"
    aria-label={m.home_attention_title()}
    data-home-attention
  >
    {#if needsReview}
      <div class="space-y-2">
        <p class="type-caption text-muted-foreground">
          {workspace.attention === 'review_required'
            ? m.home_status_review()
            : m.home_status_pull_request()}
        </p>
        <Button variant="outline" size="sm" onclick={onreview}>{m.home_attention_review()}</Button>
      </div>
    {/if}
    {#each requests as request (request.agentId)}
      <div class="space-y-1.5" data-home-attention-agent={request.agentId}>
        <div
          class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 type-caption"
        >
          <span class="min-w-0 break-words font-medium">{request.agentName}</span>
          {#if request.timestamp}
            <time class="text-muted-foreground" datetime={request.timestamp}
              >{formatDateTime(request.timestamp)}</time
            >
          {/if}
        </div>
        <p class="whitespace-pre-wrap break-words type-caption text-muted-foreground">
          {request.reason ??
            (request.kind === 'blocker'
              ? m.home_attention_blocker()
              : request.kind === 'failed'
                ? m.home_attention_failed()
                : request.kind === 'discussion'
                  ? m.home_attention_discussion()
                  : m.home_attention_question())}
        </p>
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onclick={() => onreply(request.agentId, request.questionMessageId ?? undefined)}
          >
            {request.questionMessageId
              ? m.home_attention_view_question()
              : m.home_attention_reply()}
          </Button>
          {#if request.questionMessageId}
            <Button
              variant="ghost"
              size="sm"
              disabled={!!pending}
              onclick={() => {
                error = '';
                confirming = { agentId: request.agentId, messageId: request.questionMessageId! };
              }}>{m.chat_questionWizard_dismiss_label()}</Button
            >
          {/if}
          {#if request.canRetry}
            <Button
              variant="outline"
              size="sm"
              disabled={!!pending}
              onclick={() => retry(request.agentId)}
            >
              {pending?.agentId === request.agentId && pending.kind === 'retry'
                ? m.ui_agentFailureToast_retrying_label()
                : m.agent_failureToast_retry_label()}
            </Button>
          {/if}
        </div>
      </div>
    {/each}
    {#if pending?.kind === 'dismiss'}<p class="type-caption text-muted-foreground" role="status">
        {m.home_attention_dismissing()}
      </p>{/if}
    {#if error}<p class="type-caption text-danger" role="status">{error}</p>{/if}
  </section>
{/if}
<DismissQuestionsConfirmDialog
  open={confirming !== null}
  onConfirm={dismiss}
  onCancel={() => {
    confirming = null;
  }}
/>

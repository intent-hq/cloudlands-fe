<script lang="ts">
  import { InputMessage } from '$lib/components/ui/input-message';
  import { onMount, onDestroy } from 'svelte';
  import QuestionWizard, {
    type QuestionAnswer,
  } from '$lib/components/chat/questions/QuestionWizard.svelte';
  import type { PendingQuestionSet } from '$lib/components/chat/questions/pending-questions';
  import { wizardDraftKey } from '$lib/components/chat/questions/wizard-draft-key';
  import { buildAnswerSubmission } from '$lib/components/chat/questions/answer-message';
  import { submitChatMessage } from '$features/agent/chat-submission';
  import { store } from '$store/renderer/store';
  import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
  import { agentSessionDismissQuestionsRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { selectDockConversationView } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import { selectQuestionUiConsumer } from '$store/renderer/slices/question-ui/question-ui-selectors';
  import {
    questionWizardConsumed,
    questionWizardDraftChanged,
    questionWizardCollapsedChanged,
    questionWizardReleaseRequested,
    questionWizardResolved,
    questionWizardReleased,
  } from '$store/renderer/slices/question-ui/question-ui-slice';
  import type { QuestionWizardDraft } from '$store/renderer/slices/question-ui/question-ui-types';

  let {
    workspaceId,
    agentId,
    authority,
    generation,
    pending,
    collapsed = $bindable(false),
  }: {
    workspaceId: string;
    agentId: string;
    authority: string;
    generation: number;
    pending: PendingQuestionSet;
    /** Mirrors this consumer's collapsed flag so the panel can return the composer. */
    collapsed?: boolean;
  } = $props();
  const consumerId = `dock-question:${crypto.randomUUID()}`;
  const requestId = crypto.randomUUID();
  const view$ = selectDockConversationView();
  const consumer$ = selectQuestionUiConsumer(consumerId);
  let mounted = false;
  $effect(() => {
    collapsed = $consumer$?.collapsed ?? false;
  });

  function current(): boolean {
    if (!mounted || getPrincipalActionContext(store.state) !== authority) return false;
    const context = selectDockConversationView.select(store.state).questionContext;
    return (
      context?.workspaceId === workspaceId &&
      context.agentId === agentId &&
      context.generation === generation &&
      context.authority === authority &&
      context.pending.messageId === pending.messageId
    );
  }
  onMount(() => {
    mounted = true;
    if (!current()) return;
    store.dispatch(
      questionWizardConsumed(
        consumerId,
        requestId,
        wizardDraftKey(agentId, pending.messageId),
        pending.questions,
        { idx: 0, answers: pending.questions.map(() => ({ sel: [], text: '', skipped: false })) },
        false,
      ),
    );
  });
  onDestroy(() => {
    mounted = false;
    collapsed = false;
    store.dispatch(
      getPrincipalActionContext(store.state) === authority
        ? questionWizardReleaseRequested(consumerId, requestId)
        : questionWizardReleased(consumerId, requestId),
    );
  });
  function changeDraft(draft: QuestionWizardDraft): void {
    if (current()) store.dispatch(questionWizardDraftChanged(consumerId, requestId, draft));
  }
  function complete(answers: QuestionAnswer[]): boolean {
    if (!current()) return false;
    const session = store.state.agentSessions.byAgentId[agentId];
    return submitChatMessage(store, agentId, {
      wsId: workspaceId,
      ...buildAnswerSubmission(answers, pending.messageId),
      agentName: session?.name,
      agentModel: session?.model ?? undefined,
      isInitialWorkspaceAgent: session?.metadata?.isInitialAgent === true,
    });
  }
  async function dismiss(): Promise<void> {
    if (!current()) throw new Error('Question context changed');
    await store.dispatch(
      agentSessionDismissQuestionsRequested(agentId, workspaceId, pending.messageId),
    );
  }
  function resolved(): void {
    if (getPrincipalActionContext(store.state) !== authority) return;
    store.dispatch(questionWizardResolved(consumerId, requestId));
  }
</script>

{#if $view$.sendError && !collapsed}
  <InputMessage tone="error">{$view$.sendError}</InputMessage>
{/if}
<QuestionWizard
  questions={pending.questions}
  {workspaceId}
  draft={$consumer$?.draft}
  {collapsed}
  onDraftChange={changeDraft}
  onToggleCollapsed={(next) => {
    if (current()) store.dispatch(questionWizardCollapsedChanged(consumerId, requestId, next));
  }}
  onComplete={complete}
  onDismiss={dismiss}
  onResolved={resolved}
/>

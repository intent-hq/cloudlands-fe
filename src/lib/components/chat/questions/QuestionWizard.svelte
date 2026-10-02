<!--
  Product adapter for AskUserQuestions. The primitive owns the reference Q&A
  presentation and interactions; this component preserves the daemon Question
  shape, QuestionAnswer output, local draft, dismissal, and host-owned collapse.
-->
<script lang="ts" module>
  import type { Question } from '$shared/types/question-resource';
  import type { QuestionAnswer } from './answer-message';

  export type { QuestionAnswer };
</script>

<script lang="ts">
  import { AskUserQuestions } from '$lib/components/ui/ask-user-questions';
  import type { AskUserAnswer, AskUserQuestion } from '$lib/components/ui/ask-user-questions';
  import { Button } from '$lib/components/ui/button';
  import { crispOut, springIn } from '$lib/motion';
  import { m } from '$shared/paraglide/messages.js';
  import type {
    QuestionWizardDraft,
    QuestionWizardDraftAnswer,
  } from '$store/renderer/slices/question-ui/question-ui-types';
  import DismissQuestionsConfirmDialog from './DismissQuestionsConfirmDialog.svelte';

  interface Props {
    questions: Question[];
    draft?: QuestionWizardDraft;
    onDraftChange?: (draft: QuestionWizardDraft) => void;
    onResolved?: () => void;
    collapsed?: boolean;
    onToggleCollapsed?: (collapsed: boolean) => void;
    onComplete?: (answers: QuestionAnswer[]) => unknown;
    onDismiss?: () => Promise<void> | void;
  }

  let {
    questions,
    draft = undefined,
    onDraftChange,
    onResolved,
    collapsed = false,
    onToggleCollapsed,
    onComplete,
    onDismiss,
  }: Props = $props();

  let localDraft = $state<QuestionWizardDraft>({
    idx: 0,
    answers: questions.map(() => ({ sel: [], text: '', skipped: false })),
  });
  const activeDraft = $derived(draft ?? localDraft);
  const idx = $derived(activeDraft.idx);
  const answers = $derived(activeDraft.answers);
  let completed = $state(false);
  let confirmingDismiss = $state(false);

  const multiStep = $derived(questions.length > 1);
  const primitiveQuestions = $derived<AskUserQuestion[]>(
    questions.map((question) => ({
      id: question.attachmentId,
      title: question.question,
      description: question.explanation,
      layout: 'stacked',
      options: question.options.map((option, optionIndex) => ({
        id: String(optionIndex),
        title: option.label,
        description: option.description,
      })),
      multiSelect: question.multiSelect,
      allowOther: true,
      otherPlaceholder: m.chat_questionWizard_ownAnswer_placeholder(),
      otherAriaLabel: m.chat_questionWizard_ownAnswer_ariaLabel(),
      otherAutoGrowMaxLines: 6,
      otherEnterSubmits: true,
      skippable: true,
      nextLabel: m.chat_questionWizard_next_label(),
    })),
  );
  const primitiveAnswers = $derived.by(() =>
    Object.fromEntries(
      questions.map((question, questionIndex) => {
        const answer = answers[questionIndex];
        return [
          question.attachmentId,
          {
            questionId: question.attachmentId,
            selectedIds: answer.sel.map(String),
            otherText: answer.text || undefined,
            skipped: answer.skipped,
          } satisfies AskUserAnswer,
        ];
      }),
    ),
  );

  let draftResolved = false;

  function resolveDraft() {
    if (draftResolved) return;
    draftResolved = true;
    onResolved?.();
  }

  function updateDraft(next: QuestionWizardDraft) {
    if (draftResolved) return;
    if (onDraftChange) onDraftChange(next);
    else localDraft = next;
  }

  function toDraftAnswers(next: Record<string, AskUserAnswer>): QuestionWizardDraftAnswer[] {
    return questions.map((question) => {
      const answer = next[question.attachmentId];
      if (!answer || answer.skipped)
        return { sel: [], text: '', skipped: Boolean(answer?.skipped) };
      const text = answer.otherText ?? '';
      const sel = answer.selectedIds
        .map(Number)
        .filter(
          (optionIndex) =>
            Number.isInteger(optionIndex) &&
            optionIndex >= 0 &&
            optionIndex < question.options.length,
        );
      return {
        sel: !question.multiSelect && text.length > 0 ? [] : sel,
        text,
        skipped: false,
      };
    });
  }

  function buildAnswers(source: QuestionWizardDraftAnswer[]): QuestionAnswer[] {
    return questions.map((question, questionIndex) => {
      const answer = source[questionIndex];
      return {
        question,
        selectedLabels: answer.sel.map((optionIndex) => question.options[optionIndex].label),
        freeText: answer.text.trim(),
        skipped: answer.skipped,
      };
    });
  }

  function handleAnswersChange(next: Record<string, AskUserAnswer>) {
    if (!completed) updateDraft({ idx, answers: toDraftAnswers(next) });
  }

  function handleComplete(next: Record<string, AskUserAnswer>) {
    if (completed) return;
    const completedAnswers = toDraftAnswers(next);
    updateDraft({ idx, answers: completedAnswers });
    if (onComplete?.(buildAnswers(completedAnswers)) === false) return;
    completed = true;
    resolveDraft();
  }

  function handleBack(currentIndex: number) {
    if (!completed) updateDraft({ idx: Math.max(0, currentIndex - 1), answers });
  }

  let root = $state<HTMLDivElement>();
  let expandedElement = $state<HTMLDivElement>();
  let collapsedElement = $state<HTMLDivElement>();
  let previousBounds: DOMRect | undefined;

  $effect.pre(() => {
    // Keep the outgoing surface at its last screen position while the host reflows.
    previousBounds = (collapsed ? expandedElement : collapsedElement)?.getBoundingClientRect();
  });

  function enterState(node: HTMLElement, expanded: boolean) {
    // Svelte can reuse an outgoing branch when a disclosure is toggled rapidly.
    node.inert = false;
    node.removeAttribute('aria-hidden');
    for (const property of ['position', 'width', 'left', 'top'])
      node.style.removeProperty(property);
    return springIn(node, {
      tier: 'moderate',
      y: expanded ? 8 : 4,
      scale: expanded ? 0.96 : 0.98,
    });
  }

  function exitState(node: HTMLElement) {
    const bounds = previousBounds ?? node.getBoundingClientRect();
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
    node.style.position = 'absolute';
    node.style.width = `${bounds.width}px`;
    const origin = root?.getBoundingClientRect();
    node.style.left = `${bounds.left - (origin?.left ?? bounds.left)}px`;
    node.style.top = `${bounds.top - (origin?.top ?? bounds.top)}px`;
    return crispOut(node, { tier: 'moderate', y: 8, scale: 0.98 });
  }
</script>

{#snippet dismissAction()}
  {#if onDismiss}
    <Button
      variant="ghost"
      size="xs"
      class="text-danger"
      title={m.chat_questionWizard_dismiss_tooltip()}
      onclick={() => (confirmingDismiss = true)}>{m.chat_questionWizard_dismiss_label()}</Button
    >
  {/if}
{/snippet}

{#snippet footerActions()}
  <Button
    variant="ghost-light"
    size="xs"
    title={m.chat_questionWizard_hide_tooltip()}
    onclick={() => onToggleCollapsed?.(true)}>{m.chat_questionWizard_hide_label()}</Button
  >
  {@render dismissAction()}
{/snippet}

<div
  bind:this={root}
  class={collapsed
    ? 'relative w-full min-w-0 text-left'
    : 'relative w-full max-w-160 min-w-0 text-left'}
  style:--focus-ring="var(--muted-foreground)"
  data-question-wizard
  role="group"
  aria-label={m.chat_questionWizard_title()}
>
  {#if collapsed}
    <div
      bind:this={collapsedElement}
      data-question-state="collapsed"
      class="flex w-full min-w-0 items-center rounded-(--radius-large) border border-border bg-card"
      in:enterState={false}
      out:exitState
    >
      <Button
        variant="plain"
        wrapContent={false}
        class="h-auto min-w-0 flex-1 justify-start gap-2 px-3 py-2.5 text-left sm:px-4"
        aria-expanded={false}
        onclick={() => onToggleCollapsed?.(false)}
      >
        <span class="flex min-w-0 flex-1 items-center gap-1">
          <span class="truncate type-caption font-medium text-foreground"
            >{m.chat_questionWizard_title()}</span
          >
          <span class="shrink-0 type-caption text-muted-foreground">{questions.length}</span>
        </span>
        <span class="min-w-0 max-w-[40%] truncate type-caption text-muted-foreground">
          {m.chat_questionWizard_clickToExpand_label()}
        </span>
      </Button>
      {#if onDismiss}
        <div class="shrink-0 pr-1 sm:pr-2">
          {@render dismissAction()}
        </div>
      {/if}
    </div>
  {:else}
    <div
      bind:this={expandedElement}
      data-question-state="expanded"
      class="w-full origin-bottom"
      in:enterState={true}
      out:exitState
    >
      <AskUserQuestions
        questions={primitiveQuestions}
        currentIndex={idx}
        answers={primitiveAnswers}
        onCurrentIndexChange={(nextIndex) => {
          if (!completed) updateDraft({ idx: nextIndex, answers });
        }}
        onAnswersChange={handleAnswersChange}
        onComplete={handleComplete}
        showBack={multiStep}
        onBack={handleBack}
        backLabel={m.chat_questionWizard_back_label()}
        showCounter={multiStep}
        alwaysShowSkip
        showOtherSubmit
        exclusiveOther
        clearOnSkip
        globalKeyboardShortcuts
        restoreFocusOnNavigate
        disabled={completed || confirmingDismiss || collapsed}
        {footerActions}
        class="max-w-none max-h-[var(--question-max-height,60dvh)] overflow-y-auto bg-popover [box-shadow:none]!"
        skipLabel={m.chat_questionWizard_skip_label()}
        size="compact"
        data-testid="question-wizard-card"
      />
    </div>
  {/if}
</div>

<DismissQuestionsConfirmDialog
  open={confirmingDismiss}
  onConfirm={async () => {
    confirmingDismiss = false;
    try {
      await onDismiss?.();
      resolveDraft();
    } catch {
      // The host surfaces the failure; preserve the draft for a retry.
    }
  }}
  onCancel={() => (confirmingDismiss = false)}
/>

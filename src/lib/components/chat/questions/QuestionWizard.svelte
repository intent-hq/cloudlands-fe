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
  import { onDestroy } from 'svelte';
  import { AskUserQuestions } from '$lib/components/ui/ask-user-questions';
  import type { AskUserAnswer, AskUserQuestion } from '$lib/components/ui/ask-user-questions';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import DismissQuestionsConfirmDialog from './DismissQuestionsConfirmDialog.svelte';
  import {
    clearWizardDraft,
    loadWizardDraft,
    saveWizardDraft,
    type WizardDraft,
  } from './wizard-draft-storage';

  interface Props {
    questions: Question[];
    /** Immutable per mounted question set; absent means no persistence. */
    draftKey?: string;
    collapsed?: boolean;
    onToggleCollapsed?: (collapsed: boolean) => void;
    onComplete?: (answers: QuestionAnswer[]) => void;
    onDismiss?: () => Promise<void> | void;
  }

  interface DraftAnswer {
    sel: number[];
    text: string;
    skipped: boolean;
  }

  let {
    questions,
    draftKey = undefined,
    collapsed = false,
    onToggleCollapsed,
    onComplete,
    onDismiss,
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  const draftStorageKey = draftKey;
  // svelte-ignore state_referenced_locally
  const restoredDraft = draftStorageKey ? loadWizardDraft(draftStorageKey, questions) : null;

  let idx = $state(restoredDraft?.idx ?? 0);
  let completed = $state(false);
  let confirmingDismiss = $state(false);
  // svelte-ignore state_referenced_locally
  let answers = $state<DraftAnswer[]>(
    restoredDraft?.answers ?? questions.map(() => ({ sel: [], text: '', skipped: false })),
  );

  const multiStep = $derived(questions.length > 1);
  const primitiveQuestions = $derived<AskUserQuestion[]>(
    questions.map((question) => ({
      id: question.attachmentId,
      header: question.header,
      title: question.question,
      description: question.explanation,
      options: question.options.map((option, optionIndex) => ({
        id: String(optionIndex),
        title: option.label,
        description: option.description,
      })),
      multiSelect: question.multiSelect,
      allowOther: true,
      otherPlaceholder: m.chat_questionWizard_ownAnswer_placeholder(),
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

  const DRAFT_SAVE_DEBOUNCE_MS = 300;
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingDraftSave: WizardDraft | null = null;
  let draftResolved = false;
  let draftEffectPrimed = false;

  function cancelPendingDraftSave() {
    if (draftSaveTimer !== null) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
    pendingDraftSave = null;
  }

  function resolveDraft() {
    if (!draftStorageKey) return;
    draftResolved = true;
    cancelPendingDraftSave();
    clearWizardDraft(draftStorageKey);
  }

  $effect(() => {
    const key = draftStorageKey;
    if (!key) return;
    const snapshot: WizardDraft = {
      idx,
      answers: answers.map((answer) => ({
        sel: [...answer.sel],
        text: answer.text,
        skipped: answer.skipped,
      })),
    };
    if (!draftEffectPrimed) {
      draftEffectPrimed = true;
      return;
    }
    if (draftResolved) return;
    pendingDraftSave = snapshot;
    if (draftSaveTimer !== null) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = null;
      if (pendingDraftSave && !draftResolved) {
        saveWizardDraft(key, pendingDraftSave);
        pendingDraftSave = null;
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
  });

  onDestroy(() => {
    if (draftStorageKey && pendingDraftSave && !draftResolved) {
      saveWizardDraft(draftStorageKey, pendingDraftSave);
    }
    cancelPendingDraftSave();
  });

  function toDraftAnswers(next: Record<string, AskUserAnswer>): DraftAnswer[] {
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

  function buildAnswers(source: DraftAnswer[]): QuestionAnswer[] {
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
    if (!completed) answers = toDraftAnswers(next);
  }

  function handleComplete(next: Record<string, AskUserAnswer>) {
    if (completed) return;
    const completedAnswers = toDraftAnswers(next);
    answers = completedAnswers;
    completed = true;
    resolveDraft();
    onComplete?.(buildAnswers(completedAnswers));
  }

  function handleBack(currentIndex: number) {
    if (!completed) idx = Math.max(0, currentIndex - 1);
  }
</script>

{#snippet headerActions()}
  <Button
    variant="ghost-light"
    size="xs"
    title={m.chat_questionWizard_hide_tooltip()}
    onclick={() => onToggleCollapsed?.(true)}>{m.chat_questionWizard_hide_label()}</Button
  >
  {#if onDismiss}
    <Button
      variant="ghost"
      size="xs"
      class="text-destructive"
      title={m.chat_questionWizard_dismiss_tooltip()}
      onclick={() => (confirmingDismiss = true)}>{m.chat_questionWizard_dismiss_label()}</Button
    >
  {/if}
{/snippet}

<div
  class={collapsed
    ? 'min-w-0 overflow-hidden rounded-(--radius-large) border border-border bg-card'
    : 'min-w-0'}
  data-question-wizard
  role="group"
  aria-label={m.chat_questionWizard_title()}
>
  {#if collapsed}
    <div class="flex min-w-0 w-full items-center">
      <Button
        variant="ghost"
        class="h-auto min-w-0 flex-1 justify-start rounded-none px-3 py-2.5 sm:px-4"
        onclick={() => onToggleCollapsed?.(false)}
      >
        <span class="type-caption font-medium text-foreground">{m.chat_questionWizard_title()}</span
        >
        <span class="type-caption text-muted-foreground">{questions.length}</span>
        <span class="ml-auto min-w-0 truncate type-caption text-muted-foreground">
          {m.chat_questionWizard_clickToExpand_label()}
        </span>
      </Button>
      {#if onDismiss}
        <Button
          variant="ghost"
          class="h-auto rounded-none px-3 py-2.5 text-destructive"
          title={m.chat_questionWizard_dismiss_tooltip()}
          onclick={() => (confirmingDismiss = true)}>{m.chat_questionWizard_dismiss_label()}</Button
        >
      {/if}
    </div>
  {:else}
    <AskUserQuestions
      questions={primitiveQuestions}
      currentIndex={idx}
      answers={primitiveAnswers}
      onCurrentIndexChange={(nextIndex) => {
        if (!completed) idx = nextIndex;
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
      disabled={completed}
      {headerActions}
      skipLabel={m.chat_questionWizard_skip_label()}
      class="max-w-none"
      data-testid="question-wizard-card"
    />
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

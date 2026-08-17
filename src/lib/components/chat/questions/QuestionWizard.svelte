<!--
  Sequential Agent Q&A wizard rendered in the composer slot as a quiet,
  transparent form with outlined controls. Walks
  the pending questions one at a time; choose-one advances on selection,
  multi-select keeps a Next button, Enter in the free-form field advances,
  Skip clears + advances, Back returns with the previous answer pre-selected.
  Hide collapses the well to a compact re-expandable banner (transient —
  the host owns the collapse flag; nothing is persisted). Dismiss is a
  destructive action gated behind a confirmation dialog; confirming hands off
  to `onDismiss` — the host calls `agent.dismissQuestions`, which persists
  the dismissal (survives reload) and releases the question hold. On the last
  question Send hands the full answers array to `onComplete`. Single-question
  wizards hide the step counter, progress segments, and Back button — none
  carry information when there is only one step.
-->
<script lang="ts" module>
  import type { Question } from '$shared/types/question-resource';
  // Canonical QuestionAnswer shape lives with the flattening utility
  // (answer-message.ts); re-exported here for existing importers.
  import type { QuestionAnswer } from './answer-message';

  export type { QuestionAnswer };
</script>

<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faChevronLeft,
    faArrowRight,
    faArrowUp,
    faCheck,
  } from '@fortawesome/free-solid-svg-icons';
  import { fade } from 'svelte/transition';
  import Button from '$lib/components/ui/button/button.svelte';
  import DismissQuestionsConfirmDialog from './DismissQuestionsConfirmDialog.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    questions: Question[];
    /** Host-owned Ignore state — true renders the compact banner. */
    collapsed?: boolean;
    onToggleCollapsed?: (collapsed: boolean) => void;
    onComplete?: (answers: QuestionAnswer[]) => void;
    /** Persistent dismissal — host calls `agent.dismissQuestions`. */
    onDismiss?: () => void;
  }

  let { questions, collapsed = false, onToggleCollapsed, onComplete, onDismiss }: Props = $props();

  interface DraftAnswer {
    sel: number[];
    text: string;
    skipped: boolean;
  }

  let idx = $state(0);
  // Dismiss is destructive and persistent — gate it behind a confirm dialog.
  let confirmingDismiss = $state(false);
  // Intentional initial capture: the host remounts the wizard ({#key} on the
  // question-bearing message id) whenever a different question set pends.
  // svelte-ignore state_referenced_locally
  let answers = $state<DraftAnswer[]>(questions.map(() => ({ sel: [], text: '', skipped: false })));

  const current = $derived(questions[idx]);
  const draft = $derived(answers[idx]);
  const isLast = $derived(idx === questions.length - 1);
  const isMulti = $derived(!!current?.multiSelect);
  // Single-question wizards drop the counter, segments, and Back button.
  const multiStep = $derived(questions.length > 1);
  // Single-select mid-flow advances on selection — no Next button.
  const showNext = $derived(isMulti || isLast);
  const nextDisabled = $derived(
    (isMulti || isLast) && draft.sel.length === 0 && !draft.text.trim(),
  );
  // Single-select answers are mutually exclusive with the free-form Other
  // input: any raw text disables the option buttons (multi-select allows
  // options + free text together).
  const optionsLocked = $derived(!isMulti && draft.text.length > 0);

  // Motion: snappy 150ms step transitions, none under prefers-reduced-motion.
  const stepDuration =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      ? 0
      : 150;

  function buildAnswers(): QuestionAnswer[] {
    return questions.map((q, i) => {
      const a = answers[i];
      return {
        question: q,
        selectedLabels: a.sel.map((oi) => q.options[oi].label),
        freeText: a.text.trim(),
        skipped: a.skipped,
      };
    });
  }

  function advance() {
    if (idx >= questions.length - 1) {
      onComplete?.(buildAnswers());
      return;
    }
    idx += 1;
  }

  function selectOption(oi: number) {
    if (optionsLocked) return;
    if (isMulti) {
      draft.sel = draft.sel.includes(oi) ? draft.sel.filter((x) => x !== oi) : [...draft.sel, oi];
      draft.skipped = false;
      return;
    }
    draft.sel = draft.sel.includes(oi) ? [] : [oi];
    draft.skipped = false;
    if (isLast) return;
    advance();
  }

  function handleNext() {
    if (nextDisabled) return;
    advance();
  }

  function handleSkip() {
    draft.sel = [];
    draft.text = '';
    draft.skipped = true;
    advance();
  }

  function handleBack() {
    idx = Math.max(idx - 1, 0);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    handleNext();
  }
</script>

<div
  class="min-w-0 overflow-hidden rounded-(--radius-large) bg-card shadow-sm"
  data-question-wizard
  data-testid="question-wizard-card"
>
  {#if collapsed}
    <!-- Hide-collapsed banner: click to re-expand; Dismiss is a sibling
         button (not nested — invalid HTML) that opens the confirm dialog. -->
    <div class="flex min-w-0 w-full items-center">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2 border-none bg-transparent px-3 py-2.5 text-left font-[inherit] cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
        onclick={() => onToggleCollapsed?.(false)}
      >
        <span class="type-caption font-medium text-foreground">{m.chat_questionWizard_title()}</span
        >
        <span class="type-caption text-subtle">{questions.length}</span>
        <span class="ml-auto min-w-0 truncate type-caption text-subtle"
          >{m.chat_questionWizard_clickToExpand_label()}</span
        >
      </button>
      {#if onDismiss}
        <button
          type="button"
          class="shrink-0 border-none bg-transparent px-3 py-2.5 type-caption text-error-foreground cursor-pointer font-[inherit] hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          title={m.chat_questionWizard_dismiss_tooltip()}
          onclick={() => (confirmingDismiss = true)}
        >
          {m.chat_questionWizard_dismiss_label()}
        </button>
      {/if}
    </div>
  {:else}
    <div class="flex min-h-7 items-center px-3 pt-3 sm:px-4">
      {#if multiStep}
        <span class="type-caption text-subtle"
          >{m.chat_questionWizard_stepCounter_label({
            current: idx + 1,
            total: questions.length,
          })}</span
        >
      {/if}
      <span class="ml-auto flex items-center gap-1">
        <button
          type="button"
          class="border-none bg-transparent type-caption text-subtle cursor-pointer font-[inherit] px-1.5 py-1 rounded-(--radius-small) hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={m.chat_questionWizard_hide_tooltip()}
          onclick={() => onToggleCollapsed?.(true)}
        >
          {m.chat_questionWizard_hide_label()}
        </button>
        {#if onDismiss}
          <button
            type="button"
            class="border-none bg-transparent type-caption text-error-foreground cursor-pointer font-[inherit] px-1.5 py-1 rounded-(--radius-small) hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={m.chat_questionWizard_dismiss_tooltip()}
            onclick={() => (confirmingDismiss = true)}
          >
            {m.chat_questionWizard_dismiss_label()}
          </button>
        {/if}
      </span>
    </div>

    {#key idx}
      <div in:fade={{ duration: stepDuration }}>
        <div class="flex flex-col gap-4 px-3 pt-3 pb-3 sm:px-4">
          <div class="flex flex-col gap-1">
            <p class="type-caption text-subtle">{current.header}</p>
            <h2 class="type-title font-medium text-foreground">{current.question}</h2>
          </div>

          <div class="flex flex-col divide-y divide-border">
            {#each current.options as option, oi (oi)}
              {@const selected = draft.sel.includes(oi)}
              <button
                type="button"
                aria-pressed={selected}
                disabled={optionsLocked}
                data-question-option
                data-selected={selected}
                class="flex min-w-0 w-full items-start gap-2.5 border-0 bg-transparent px-2 py-2.5 text-left font-[inherit] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring {selected
                  ? 'bg-accent cursor-pointer'
                  : optionsLocked
                    ? 'opacity-50 cursor-default'
                    : 'cursor-pointer hover:bg-accent/50 active:bg-accent'}"
                onclick={() => selectOption(oi)}
              >
                <span
                  aria-hidden="true"
                  data-option-indicator
                  class="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center border box-border {isMulti
                    ? 'rounded-(--radius-small)'
                    : 'rounded-full'} {selected ? 'border-primary' : 'border-input'}"
                >
                  {#if isMulti && selected}
                    <span class="inline-flex size-full items-center justify-center bg-primary">
                      <Fa icon={faCheck} class="text-[9px] text-primary-foreground a11y-ignore" />
                    </span>
                  {:else if selected}
                    <span class="size-2 rounded-full bg-primary"></span>
                  {/if}
                </span>
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    class="type-body font-medium {selected
                      ? 'text-accent-foreground'
                      : 'text-foreground'}">{option.label}</span
                  >
                  {#if option.description}
                    <span
                      class="type-caption leading-normal {selected
                        ? 'text-accent-foreground/70'
                        : 'text-subtle'}">{option.description}</span
                    >
                  {/if}
                </span>
              </button>
            {/each}
          </div>

          <div
            class="flex items-center rounded-(--radius-medium) border border-input bg-transparent px-3 py-2 focus-within:border-ring"
          >
            <input
              bind:value={draft.text}
              oninput={() => {
                draft.skipped = false;
                if (!isMulti && draft.text.length > 0) draft.sel = [];
              }}
              onkeydown={handleKeydown}
              aria-label={m.chat_questionWizard_ownAnswer_ariaLabel()}
              placeholder={m.chat_questionWizard_ownAnswer_placeholder()}
              class="type-body flex-1 border-none! bg-transparent font-[inherit] text-foreground outline-none! ring-0! focus:outline-none! focus:ring-0! focus-visible:outline-none! focus-visible:ring-0!"
            />
          </div>
        </div>

        <div class="flex items-center gap-2 px-3 py-3 sm:px-4" data-testid="question-wizard-footer">
          {#if multiStep}
            <button
              type="button"
              class="inline-flex items-center gap-1 border-none bg-transparent type-caption font-[inherit] px-2 py-1.5 rounded-(--radius-small) {idx ===
              0
                ? 'text-ghost opacity-50 cursor-default'
                : 'text-subtle cursor-pointer hover:text-foreground'}"
              disabled={idx === 0}
              onclick={handleBack}
            >
              <Fa icon={faChevronLeft} class="text-[9px] a11y-ignore" />
              {m.chat_questionWizard_back_label()}
            </button>
          {/if}
          <span class="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              class="border-none bg-transparent type-caption text-subtle cursor-pointer font-[inherit] px-2 py-1.5 rounded-(--radius-small) hover:text-foreground"
              onclick={handleSkip}
            >
              {m.chat_questionWizard_skip_label()}
            </button>
            {#if showNext}
              <Button size="sm" disabled={nextDisabled} onclick={handleNext}>
                {isLast ? m.chat_questionWizard_send_label() : m.chat_questionWizard_next_label()}
                <Fa icon={isLast ? faArrowUp : faArrowRight} class="text-[10px] a11y-ignore" />
              </Button>
            {/if}
          </span>
        </div>
      </div>
    {/key}
  {/if}
</div>

<DismissQuestionsConfirmDialog
  open={confirmingDismiss}
  onConfirm={() => {
    confirmingDismiss = false;
    onDismiss?.();
  }}
  onCancel={() => (confirmingDismiss = false)}
/>

<!--
  Sequential Agent Q&A wizard rendered in the composer slot as a quiet,
  transparent form with outlined controls. Walks
  the pending questions one at a time; choose-one advances on selection,
  multi-select keeps a Next button, Enter in the free-form field advances,
  Skip clears + advances, Back returns with the previous answer pre-selected.
  Hide collapses the well to a compact re-expandable banner (the host owns
  the collapse flag and its persistence). With a
  `draftKey` the in-progress answers + current step persist to localStorage
  (wizard-draft-storage) and restore on remount/reload; completing or
  dismissing clears the stored draft (and the host's persisted collapsed
  state stored beside it). Dismiss is a
  destructive action gated behind a confirmation dialog; confirming hands off
  to `onDismiss` — the host calls `agent.dismissQuestions`, which persists
  the dismissal (survives reload) and clears the pending question set, so the
  otherwise-sticky wizard stays hidden through later turns. The stored
  draft is only cleared once `onDismiss` resolves, so a failed dismissal
  (wizard re-surfaces) keeps the in-progress answers. On the last
  question an option submits immediately; typed text uses Send. Single-question
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
  import { onDestroy } from 'svelte';
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
  import {
    clearWizardDraft,
    loadWizardDraft,
    saveWizardDraft,
    type WizardDraft,
  } from './wizard-draft-storage';

  interface Props {
    questions: Question[];
    /**
     * localStorage key (see `wizardDraftKey`) that persists in-progress
     * answers + the current step across unmounts/reloads. Absent → no
     * persistence (behavior identical to before the prop existed).
     * Captured once at init — later changes to the prop are ignored, so a
     * host must remount (e.g. via `{#key}`) to change the key.
     */
    draftKey?: string;
    /** Host-owned Ignore state — true renders the compact banner. */
    collapsed?: boolean;
    onToggleCollapsed?: (collapsed: boolean) => void;
    onComplete?: (answers: QuestionAnswer[]) => void;
    /**
     * Persistent dismissal — host calls `agent.dismissQuestions`. May return
     * a promise; the stored draft is cleared only after it resolves, so a
     * failed dismissal keeps the draft for the re-surfaced wizard.
     */
    onDismiss?: () => Promise<void> | void;
  }

  let {
    questions,
    draftKey = undefined,
    collapsed = false,
    onToggleCollapsed,
    onComplete,
    onDismiss,
  }: Props = $props();

  interface DraftAnswer {
    sel: number[];
    text: string;
    skipped: boolean;
  }

  // The host remounts the wizard per question set ({#key} on the
  // question-bearing message id), so the draft key is immutable per instance.
  // Capture it once at init so teardown-time reads (the onDestroy flush) never
  // re-evaluate the prop getter against a host source that may already be null.
  // svelte-ignore state_referenced_locally
  const draftStorageKey = draftKey;

  // Restore any persisted draft for this exact question set before the state
  // below initializes. Intentional initial capture (like `answers` below):
  // the host remounts the wizard per question set.
  // svelte-ignore state_referenced_locally
  const restoredDraft = draftStorageKey ? loadWizardDraft(draftStorageKey, questions) : null;

  let idx = $state(restoredDraft?.idx ?? 0);
  // The host normally unmounts this component after completion. Keep a local,
  // synchronous latch so rapid clicks cannot complete or replace an answer twice.
  let completed = $state(false);
  // Dismiss is destructive and persistent — gate it behind a confirm dialog.
  let confirmingDismiss = $state(false);
  // Intentional initial capture: the host remounts the wizard ({#key} on the
  // question-bearing message id) whenever a different question set pends.
  // svelte-ignore state_referenced_locally
  let answers = $state<DraftAnswer[]>(
    restoredDraft?.answers ?? questions.map(() => ({ sel: [], text: '', skipped: false })),
  );

  const current = $derived(questions[idx]);
  const draft = $derived(answers[idx]);
  const isLast = $derived(idx === questions.length - 1);
  const isMulti = $derived(!!current?.multiSelect);
  // Single-question wizards drop the counter, segments, and Back button.
  const multiStep = $derived(questions.length > 1);
  // Single-select options submit immediately. The final Send action remains
  // available only for typed custom answers; multi-select stays explicit.
  const showNext = $derived(isMulti || (isLast && draft.text.trim().length > 0));
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

  // ── Draft persistence (only when `draftKey` is set) ────────────────────
  // Saves are debounced so typing does not write every keystroke; the
  // pending save is flushed on unmount so switching away mid-typing loses
  // nothing. Completion and confirmed Dismiss clear the stored draft.
  const DRAFT_SAVE_DEBOUNCE_MS = 300;
  let draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingDraftSave: WizardDraft | null = null;
  // Latched once the draft is cleared (answers sent / set dismissed) so no
  // later save or unmount flush can resurrect it.
  let draftResolved = false;
  // The first effect run only captures the initial (restored) state — skip
  // it so merely rendering the wizard never writes a draft.
  let draftEffectPrimed = false;

  function cancelPendingDraftSave() {
    if (draftSaveTimer !== null) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
    pendingDraftSave = null;
  }

  /** Delete the stored draft and stop persisting — the set is resolved. */
  function resolveDraft() {
    if (!draftStorageKey) return;
    draftResolved = true;
    cancelPendingDraftSave();
    clearWizardDraft(draftStorageKey);
  }

  $effect(() => {
    const key = draftStorageKey;
    if (!key) return;
    // Deep read so any selection/text/skipped/step mutation re-runs this.
    const snapshot: WizardDraft = {
      idx,
      answers: answers.map((a) => ({ sel: [...a.sel], text: a.text, skipped: a.skipped })),
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
      if (completed) return;
      completed = true;
      resolveDraft();
      onComplete?.(buildAnswers());
      return;
    }
    idx += 1;
  }

  function selectOption(oi: number) {
    if (optionsLocked || completed) return;
    if (isMulti) {
      draft.sel = draft.sel.includes(oi) ? draft.sel.filter((x) => x !== oi) : [...draft.sel, oi];
      draft.skipped = false;
      return;
    }
    draft.sel = [oi];
    draft.skipped = false;
    advance();
  }

  function handleNext() {
    if (completed) return;
    if (nextDisabled) return;
    advance();
  }

  function handleSkip() {
    if (completed) return;
    draft.sel = [];
    draft.text = '';
    draft.skipped = true;
    advance();
  }

  function handleBack() {
    if (completed) return;
    idx = Math.max(idx - 1, 0);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    handleNext();
  }
</script>

<div
  class="min-w-0 overflow-hidden rounded-(--radius-large) border-0 bg-card"
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
    <div
      class="flex min-h-7 min-w-0 items-center gap-2 px-3 pt-3 sm:px-4"
      data-question-wizard-header
    >
      {#if multiStep}
        <span class="shrink-0 type-caption text-subtle" data-question-step-counter
          >{m.chat_questionWizard_stepCounter_label({
            current: idx + 1,
            total: questions.length,
          })}</span
        >
      {/if}
      <p class="min-w-0 flex-1 truncate type-caption text-subtle" data-question-header-title>
        {current.header}
      </p>
      <span class="flex shrink-0 items-center gap-1" data-question-header-actions>
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
          <h2 class="type-title font-medium text-foreground">{current.question}</h2>

          <div class="flex flex-col divide-y divide-border">
            {#each current.options as option, oi (oi)}
              {@const selected = draft.sel.includes(oi)}
              <button
                type="button"
                aria-pressed={selected}
                disabled={optionsLocked || completed}
                data-question-option
                data-selected={selected}
                class="flex min-w-0 w-full items-start gap-2.5 border-0 bg-transparent px-2 py-2.5 text-left font-[inherit] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring {selected
                  ? 'bg-accent cursor-pointer'
                  : optionsLocked
                    ? 'opacity-50 cursor-default'
                    : 'cursor-pointer hover:bg-accent/50 active:bg-accent'}"
                onclick={() => selectOption(oi)}
              >
                {#if isMulti}
                  <span
                    aria-hidden="true"
                    data-option-indicator
                    class="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-(--radius-small) border box-border {selected
                      ? 'border-primary'
                      : 'border-input'}"
                  >
                    {#if selected}
                      <span class="inline-flex size-full items-center justify-center bg-primary">
                        <Fa icon={faCheck} class="text-[9px] text-primary-foreground a11y-ignore" />
                      </span>
                    {/if}
                  </span>
                {/if}
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
              class="border-none bg-transparent type-body text-subtle cursor-pointer font-[inherit] px-2 py-1.5 rounded-(--radius-small) hover:text-foreground"
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
  onConfirm={async () => {
    confirmingDismiss = false;
    try {
      await onDismiss?.();
      // Only clear once the dismissal is confirmed — a rejected dismissal
      // (host rolls back + toasts) re-surfaces the wizard with the draft.
      resolveDraft();
    } catch {
      // Host surfaces the failure; the draft stays for the retry.
    }
  }}
  onCancel={() => (confirmingDismiss = false)}
/>

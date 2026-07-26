<!--
  Sequential Agent Q&A wizard rendered in the composer slot (pixel mock t2:
  borderless grey well with a green attention border — no card chrome). Walks
  the pending questions one at a time; choose-one advances on selection,
  multi-select keeps a Next button, Enter in the free-form field advances,
  Skip clears + advances, Back returns with the previous answer pre-selected.
  Ignore collapses the well to a compact re-expandable banner (transient —
  the host owns the collapse flag; nothing is persisted). On the last
  question Send hands the full answers array to `onComplete`.
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
  faCircleQuestion,
  faChevronLeft,
  faArrowRight,
  faArrowUp,
  faCheck,
  faPen,
} from '@fortawesome/free-solid-svg-icons';
  import { fade } from 'svelte/transition';
  import Button from '$lib/components/ui/button/button.svelte';

  interface Props {
    questions: Question[];
    /** Host-owned Ignore state — true renders the compact banner. */
    collapsed?: boolean;
    onToggleCollapsed?: (collapsed: boolean) => void;
    onComplete?: (answers: QuestionAnswer[]) => void;
  }

  let { questions, collapsed = false, onToggleCollapsed, onComplete }: Props = $props();

  interface DraftAnswer {
    sel: number[];
    text: string;
    skipped: boolean;
  }

  let idx = $state(0);
  // Intentional initial capture: the host remounts the wizard ({#key} on the
  // question-bearing message id) whenever a different question set pends.
  // svelte-ignore state_referenced_locally
  let answers = $state<DraftAnswer[]>(
    questions.map(() => ({ sel: [], text: '', skipped: false })),
  );

  const current = $derived(questions[idx]);
  const draft = $derived(answers[idx]);
  const isLast = $derived(idx === questions.length - 1);
  const isMulti = $derived(!!current?.multiSelect);
  // Single-select mid-flow advances on selection — no Next button.
  const showNext = $derived(isMulti || isLast);
  const nextDisabled = $derived(
    (isMulti || isLast) && draft.sel.length === 0 && !draft.text.trim(),
  );

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
    if (isMulti) {
      draft.sel = draft.sel.includes(oi)
        ? draft.sel.filter((x) => x !== oi)
        : [...draft.sel, oi];
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
  class="rounded-lg border border-primary/50 bg-muted/55 dark:bg-muted"
  data-question-wizard
>
  {#if collapsed}
    <!-- Ignore-collapsed banner: click to re-expand -->
    <button
      type="button"
      class="flex w-full items-center gap-2.5 px-3.5 py-2.25 cursor-pointer rounded-lg bg-transparent border-none text-left font-[inherit] hover:bg-primary/5"
      onclick={() => onToggleCollapsed?.(false)}
    >
      <Fa icon={faCircleQuestion} class="text-xs text-primary" />
      <span class="text-xs font-medium text-foreground">Agent Has Questions</span>
      <span
        class="text-[0.7rem] font-medium px-1.75 py-px rounded-full bg-primary/12 border border-primary/35 text-foreground"
      >
        {questions.length}
      </span>
      <span class="ml-auto text-[0.7rem] text-subtle">Click to expand</span>
    </button>
  {:else}
    <!-- Header row -->
    <div class="flex items-center gap-2.5 px-3.5 pt-2.5">
      <Fa icon={faCircleQuestion} class="text-xs text-primary" />
      <span class="text-xs font-medium text-foreground">Agent Has Questions</span>
      <span class="text-xs text-subtle">{idx + 1} of {questions.length}</span>
      <span class="flex items-center gap-1">
        {#each questions as _, i (i)}
          <span
            class="w-3.5 h-1 rounded-[2px] {i < idx
              ? 'bg-primary/40'
              : i === idx
                ? 'bg-primary'
                : 'bg-muted-foreground/25'}"
          ></span>
        {/each}
      </span>
      {#if isMulti}
        <span class="text-[0.7rem] px-1.75 py-px rounded-full bg-secondary text-subtle">
          select all that apply
        </span>
      {/if}
      <button
        type="button"
        class="ml-auto border-none bg-transparent text-xs text-subtle cursor-pointer font-[inherit] px-1.5 py-0.5 rounded-(--radius) hover:text-foreground"
        onclick={() => onToggleCollapsed?.(true)}
      >
        Ignore
      </button>
    </div>

    {#key idx}
      <div in:fade={{ duration: stepDuration }}>
        <!-- Question body -->
        <div class="flex flex-col gap-2.5 px-3.5 pt-2.5 pb-2">
          <div class="flex flex-col gap-0.75">
            <span class="text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-subtle">
              {current.header}
            </span>
            <span class="text-[0.9rem] font-medium text-foreground tracking-[-0.01em]">
              {current.question}
            </span>
          </div>

          <div class="flex flex-col gap-1.5">
            {#each current.options as option, oi (option.label)}
              {@const selected = draft.sel.includes(oi)}
              <button
                type="button"
                class="flex items-start gap-2.5 rounded-(--radius) px-2.5 py-2 cursor-pointer text-left font-[inherit] {selected
                  ? 'border border-primary bg-primary/10'
                  : 'border border-transparent bg-background shadow-xs dark:border-border/60 dark:bg-background/40 hover:border-primary hover:bg-primary/6'}"
                onclick={() => selectOption(oi)}
              >
                {#if isMulti}
                  <span
                    class="inline-flex items-center justify-center w-[15px] h-[15px] rounded-[4px] mt-0.5 shrink-0 box-border {selected
                      ? 'bg-primary'
                      : 'border border-ghost'}"
                  >
                    {#if selected}
                      <Fa icon={faCheck} class="text-[9px] text-primary-foreground" />
                    {/if}
                  </span>
                {/if}
                <span class="flex flex-col gap-px">
                  <span class="text-[0.8125rem] font-medium text-foreground">{option.label}</span>
                  {#if option.description}
                    <span class="text-xs text-subtle leading-normal">{option.description}</span>
                  {/if}
                </span>
                {#if !isMulti}
                  <Fa icon={faArrowRight} class="ml-auto self-center text-[10px] text-ghost" />
                {/if}
              </button>
            {/each}
          </div>

          <!-- Always-visible free-form "Other" input -->
          <div
            class="flex items-center gap-2 pl-2.5 pr-1.5 py-1 rounded-(--radius) bg-background/70 dark:bg-background/50"
          >
            <Fa icon={faPen} class="text-[10px] text-ghost" />
            <input
              bind:value={draft.text}
              onkeydown={handleKeydown}
              placeholder="Or type your own answer…"
              class="flex-1 border-none outline-none bg-transparent text-[0.8125rem] font-[inherit] text-foreground py-1"
            />
            <span class="text-[0.7rem] text-ghost pr-1.5">↵</span>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center gap-2 px-3.5 pt-0.5 pb-3">
          <button
            type="button"
            class="inline-flex items-center gap-1.25 border-none bg-transparent text-xs font-[inherit] px-2 py-1 rounded-(--radius) {idx === 0
              ? 'text-ghost opacity-50 cursor-default'
              : 'text-subtle cursor-pointer hover:text-foreground'}"
            disabled={idx === 0}
            onclick={handleBack}
          >
            <Fa icon={faChevronLeft} class="text-[9px]" />
            Back
          </button>
          {#if !isMulti && !isLast}
            <span class="text-[0.7rem] text-ghost">
              Selecting an option moves to the next question
            </span>
          {/if}
          <span class="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              class="border-none bg-transparent text-xs text-subtle cursor-pointer font-[inherit] px-2 py-1 rounded-(--radius) hover:text-foreground"
              onclick={handleSkip}
            >
              Skip
            </button>
            {#if showNext}
              <Button size="sm" disabled={nextDisabled} onclick={handleNext}>
                {isLast ? 'Send' : 'Next'}
                <Fa icon={isLast ? faArrowUp : faArrowRight} class="text-[10px]" />
              </Button>
            {/if}
          </span>
        </div>
      </div>
    {/key}
  {/if}
</div>

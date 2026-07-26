<!--
  Quiet in-transcript rendering of an Agent Q&A question resource block
  (application/vnd.intent.question+json). Styled after the pixel mock's t2
  "grey well" direction — no card chrome, all colors via tokens. The
  interactive answering wizard lives in the composer slot (separate
  component); this card only presents the question content. Once ANY later
  user message exists after the question-bearing assistant message, the host
  passes `resolved` and the card renders inactive (dimmed, no attention
  border) — answers live in the user's plain-text reply right below.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCircleQuestion, faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
  import type { Question } from '$shared/types/question-resource';

  interface Props {
    question: Question;
    /** True once a later user message supersedes this question. */
    resolved?: boolean;
  }

  let { question, resolved = false }: Props = $props();

  let explanationExpanded = $state(false);
</script>

<div
  class="rounded-lg {resolved
    ? 'border border-border/60 bg-muted/30 opacity-70'
    : 'border border-primary/50 bg-muted/55 dark:bg-muted'}"
  data-attachment-id={question.attachmentId}
>
  <!-- Header row -->
  <div class="flex items-center gap-2.5 px-3.5 pt-2.5">
    <Fa
      icon={faCircleQuestion}
      class="text-xs {resolved ? 'text-subtle' : 'text-primary'}"
    />
    <span class="text-xs font-medium text-foreground">
      {resolved ? 'Agent asked' : 'Agent Has Questions'}
    </span>
    {#if question.multiSelect}
      <span class="text-[0.7rem] px-1.75 py-px rounded-full bg-secondary text-subtle">
        select all that apply
      </span>
    {/if}
  </div>

  <!-- Question body -->
  <div class="flex flex-col gap-2.5 px-3.5 pt-2.5 pb-3">
    <div class="flex flex-col gap-0.75">
      <span class="text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-subtle">
        {question.header}
      </span>
      <span class="text-[0.9rem] font-medium text-foreground tracking-[-0.01em]">
        {question.question}
      </span>
    </div>

    {#if question.explanation}
      <button
        type="button"
        class="flex items-start gap-1.5 text-left text-xs text-subtle hover:text-foreground cursor-pointer bg-transparent border-none p-0 font-[inherit]"
        onclick={() => (explanationExpanded = !explanationExpanded)}
      >
        <Fa
          icon={explanationExpanded ? faChevronUp : faChevronDown}
          class="text-[9px] mt-1 shrink-0"
        />
        {#if explanationExpanded}
          <span class="leading-relaxed whitespace-pre-wrap">{question.explanation}</span>
        {:else}
          <span>Why is this being asked?</span>
        {/if}
      </button>
    {/if}

    <div class="flex flex-col gap-1.5">
      {#each question.options as option (option.label)}
        <div
          class="flex items-start gap-2.5 rounded-(--radius) px-2.5 py-2 {resolved
            ? 'border border-border/40 bg-background/30'
            : 'border border-transparent bg-background shadow-xs dark:border-border/60 dark:bg-background/40'}"
        >
          <span class="flex flex-col gap-px">
            <span class="text-[0.8125rem] font-medium text-foreground">{option.label}</span>
            {#if option.description}
              <span class="text-xs text-subtle leading-normal">{option.description}</span>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </div>
</div>


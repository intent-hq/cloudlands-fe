<script lang="ts">
  import { tick, type Snippet } from 'svelte';

  let {
    expanded = false,
    active = true,
    maxHeight,
    question,
    children,
  }: {
    expanded?: boolean;
    active?: boolean;
    maxHeight?: number;
    question?: Snippet;
    children: Snippet;
  } = $props();

  let root = $state<HTMLDivElement>();
  let questionElement = $state<HTMLDivElement>();
  let composerElement = $state<HTMLDivElement>();
  let wasExpanded = false;

  $effect.pre(() => {
    const opening = expanded;
    const changed = opening !== wasExpanded;
    wasExpanded = opening;
    if (!changed || !active) return;
    const focused = document.activeElement;
    const ownsFocus = root?.contains(focused) || focused === document.body;
    if (!ownsFocus) return;
    void tick().then(() => {
      if (expanded !== opening || !active) return;
      const target = opening
        ? (questionElement?.querySelector<HTMLElement>('[role="radio"], [role="checkbox"]') ??
          questionElement?.querySelector<HTMLElement>('textarea, button'))
        : (composerElement?.querySelector<HTMLElement>('[contenteditable="true"]') ??
          composerElement?.querySelector<HTMLElement>('textarea, input:not([type="hidden"])') ??
          composerElement?.querySelector<HTMLElement>('button'));
      target?.focus({ preventScroll: true });
    });
  });
</script>

<div
  bind:this={root}
  class="question-composer relative grid w-full min-w-0"
  data-testid="question-composer"
  data-expanded={expanded}
>
  {#if question}
    <div
      bind:this={questionElement}
      class={expanded
        ? 'question-layer relative z-20 col-start-1 row-start-1 w-full min-w-0 self-center px-3 py-3'
        : 'w-full min-w-0'}
      style:--question-max-height={maxHeight === undefined
        ? undefined
        : `${Math.max(0, maxHeight)}px`}
      data-testid="question-wizard-slot"
    >
      {@render question()}
    </div>
  {/if}
  <div
    bind:this={composerElement}
    class="w-full min-w-0 transition-[filter,opacity] duration-spring-moderate ease-spring-moderate motion-reduce:transition-none"
    class:composer-behind-question={expanded}
    inert={expanded}
    aria-hidden={expanded ? 'true' : undefined}
    data-testid="question-composer-input"
  >
    {@render children()}
  </div>
</div>

<style>
  .composer-behind-question {
    grid-area: 1 / 1;
    align-self: end;
    filter: blur(3px);
    opacity: 0.5;
    pointer-events: none;
    user-select: none;
  }

  .question-layer :global([data-question-wizard]) {
    margin-inline: auto;
  }

  @container style(--motion-reduced: 1) {
    .question-composer > div {
      transition: none;
    }
  }
</style>

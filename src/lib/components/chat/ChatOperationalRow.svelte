<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TransitionConfig } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import {
    CHAT_OPERATIONAL_CHEVRON_CLASS,
    CHAT_OPERATIONAL_LEADING_CLASS,
    CHAT_OPERATIONAL_CONTAINER_CLASS,
    CHAT_OPERATIONAL_ROW_CLASS,
    CHAT_OPERATIONAL_SUMMARY_CLASS,
    CHAT_OPERATIONAL_TRAILING_CLASS,
    safeOperationalDetailsTransition,
  } from './operational-disclosure-row';

  interface Props {
    leading: Snippet;
    summary: Snippet;
    trailing?: Snippet;
    showChevron?: boolean;
    details?: Snippet;
    interactive?: boolean;
    expanded?: boolean;
    controls?: string;
    ariaLabel?: string;
    title?: string;
    summaryTitle?: string;
    onclick?: (event: MouseEvent) => void;
    onkeydown?: (event: KeyboardEvent) => void;
    detailsId?: string;
    detailsClass?: string;
    detailsTransition?: (node: Element) => TransitionConfig;
    detailsMotion?: string;
    detailsInert?: boolean;
    detailsAriaHidden?: boolean;
    triggerElement?: HTMLButtonElement;
    detailsElement?: HTMLElement;
    adjacentOperationalRow?: boolean;
    streaming?: boolean;
    toolIcon?: boolean;
    testId?: string;
    disclosureTestId?: string;
    summaryTestId?: string;
    toolUseId?: string;
    toolCallId?: string;
    conversationLayer?: string;
    class?: string;
  }

  let {
    leading,
    summary,
    trailing,
    showChevron = true,
    details,
    interactive = false,
    expanded = false,
    controls,
    ariaLabel,
    title,
    summaryTitle,
    onclick,
    onkeydown,
    detailsId,
    detailsClass = '',
    detailsTransition = safeOperationalDetailsTransition,
    detailsMotion,
    detailsInert = false,
    detailsAriaHidden,
    triggerElement = $bindable(),
    detailsElement = $bindable(),
    adjacentOperationalRow = false,
    streaming = false,
    toolIcon = false,
    testId,
    disclosureTestId,
    summaryTestId,
    toolUseId,
    toolCallId,
    conversationLayer,
    class: className = '',
  }: Props = $props();
</script>

<div
  class="{CHAT_OPERATIONAL_CONTAINER_CLASS} {className}"
  data-chat-operational-row
  data-operational-row-container
  data-adjacent-operational-row={adjacentOperationalRow || undefined}
  data-testid={testId}
  data-tool-use-id={toolUseId}
  data-tool-call-id={toolCallId}
  data-conversation-layer={conversationLayer}
>
  <div class={CHAT_OPERATIONAL_ROW_CLASS} data-operational-disclosure-row data-compact-tool-row>
    {#if interactive}
      <button
        bind:this={triggerElement}
        type="button"
        class="col-span-2 flex min-w-0 w-full cursor-pointer items-center gap-[var(--operational-leading-gap)] border-0 bg-transparent p-0 text-left focus-visible:underline focus-visible:underline-offset-2 focus-visible:outline-none"
        data-testid={disclosureTestId}
        aria-label={ariaLabel}
        aria-expanded={expanded}
        aria-controls={controls}
        title={title ?? ariaLabel}
        {onclick}
        {onkeydown}
      >
        <span
          class="{CHAT_OPERATIONAL_LEADING_CLASS} {streaming ? 'animate-pulse' : ''}"
          data-operational-leading
          data-operational-icon-box
          data-tool-icon={toolIcon || undefined}>{@render leading()}</span
        >
        <span
          class="{CHAT_OPERATIONAL_SUMMARY_CLASS} flex-1"
          data-operational-summary
          data-tool-sentence={toolIcon || undefined}
          data-testid={summaryTestId}
          title={summaryTitle}>{@render summary()}</span
        >
      </button>
    {:else}
      <div
        class="{CHAT_OPERATIONAL_LEADING_CLASS} {streaming ? 'animate-pulse' : ''}"
        data-operational-leading
        data-operational-icon-box
        data-tool-icon={toolIcon || undefined}
      >
        {@render leading()}
      </div>
      <span
        class={CHAT_OPERATIONAL_SUMMARY_CLASS}
        data-operational-summary
        data-tool-sentence={toolIcon || undefined}
        data-testid={summaryTestId}
        aria-label={ariaLabel}
        title={summaryTitle ?? ariaLabel}>{@render summary()}</span
      >
    {/if}
    {#if trailing || (interactive && showChevron)}
      <span class={CHAT_OPERATIONAL_TRAILING_CLASS} data-operational-trailing>
        {@render trailing?.()}
        {#if interactive && showChevron}
          <span data-operational-chevron>
            <Fa
              icon={faChevronDown}
              size={16}
              class="{CHAT_OPERATIONAL_CHEVRON_CLASS} {expanded ? '' : '-rotate-90'}"
            />
          </span>
        {/if}
      </span>
    {/if}
  </div>

  {#if details}
    <div
      bind:this={detailsElement}
      id={detailsId}
      class={detailsClass}
      data-operational-expanded-content
      data-response-group-motion={detailsMotion}
      inert={detailsInert}
      aria-hidden={detailsAriaHidden}
      transition:detailsTransition
    >
      {@render details()}
    </div>
  {/if}
</div>

<style>
  .tool-call-container {
    contain: layout style;
  }
</style>

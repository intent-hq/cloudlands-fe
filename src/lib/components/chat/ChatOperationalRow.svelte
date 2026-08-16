<script lang="ts">
  import type { Snippet } from 'svelte';
  import { safeSlide } from '$lib/utils/animations';
  import {
    CHAT_OPERATIONAL_LEADING_CLASS,
    CHAT_OPERATIONAL_ROW_CLASS,
    CHAT_OPERATIONAL_SUMMARY_CLASS,
    OPERATIONAL_ROW_CONTAINER_CLASS,
  } from './operational-disclosure-row';

  interface Props {
    leading: Snippet;
    summary: Snippet;
    trailing?: Snippet;
    details?: Snippet;
    interactive?: boolean;
    expanded?: boolean;
    controls?: string;
    ariaLabel?: string;
    title?: string;
    onclick?: (event: MouseEvent) => void;
    onkeydown?: (event: KeyboardEvent) => void;
    detailsId?: string;
    detailsClass?: string;
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
    details,
    interactive = false,
    expanded = false,
    controls,
    ariaLabel,
    title,
    onclick,
    onkeydown,
    detailsId,
    detailsClass = '',
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
  class="{OPERATIONAL_ROW_CONTAINER_CLASS} {adjacentOperationalRow ? 'mt-1' : ''} {className}"
  data-chat-operational-row
  data-adjacent-operational-row={adjacentOperationalRow || undefined}
  data-testid={testId}
  data-tool-use-id={toolUseId}
  data-tool-call-id={toolCallId}
  data-conversation-layer={conversationLayer}
>
  <div class={CHAT_OPERATIONAL_ROW_CLASS} data-operational-disclosure-row data-compact-tool-row>
    {#if interactive}
      <button
        type="button"
        class="col-span-2 flex min-w-0 w-full cursor-pointer items-center gap-[var(--operational-leading-gap)] border-0 bg-transparent p-0 text-left focus-visible:outline-none"
        data-testid={disclosureTestId}
        aria-label={ariaLabel}
        aria-expanded={expanded}
        aria-controls={controls}
        {title}
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
          data-testid={summaryTestId}>{@render summary()}</span
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
        title={ariaLabel}>{@render summary()}</span
      >
    {/if}
    {@render trailing?.()}
  </div>

  {#if details}
    <div
      id={detailsId}
      class={detailsClass}
      data-operational-expanded-content
      transition:safeSlide={{ duration: 150 }}
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

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ImmediateMotionConfig as TransitionConfig, SpringTierName } from '$lib/motion';
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
  import { searchDisclosureEvents } from './chat-search-disclosure';
  import { animatedHeight } from '$lib/motion';
  import { Button } from '$lib/components/ui/button';

  interface Props {
    leading: Snippet;
    summary: Snippet;
    trailing?: Snippet;
    showChevron?: boolean;
    preview?: Snippet;
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
    previewClass?: string;
    detailsClass?: string;
    previewTransition?: (
      node: Element,
      params?: { tier?: SpringTierName; y?: number },
      options?: { direction?: 'in' | 'out' | 'both' },
    ) => TransitionConfig;
    detailsTransition?: (node: Element) => TransitionConfig;
    animateDetailsHeight?: boolean;
    detailsMotion?: string;
    detailsInert?: boolean;
    detailsAriaHidden?: boolean;
    triggerElement?: HTMLButtonElement | null;
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
    searchDisclosureId?: string;
    summarySearchPath?: string;
    onSearchExpand?: () => void;
    onSearchRestore?: () => void;
    class?: string;
  }

  let {
    leading,
    summary,
    trailing,
    showChevron = true,
    preview,
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
    previewClass = '',
    detailsClass = '',
    previewTransition,
    detailsTransition = safeOperationalDetailsTransition,
    animateDetailsHeight = false,
    detailsMotion,
    detailsInert = false,
    detailsAriaHidden,
    triggerElement = $bindable(null),
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
    searchDisclosureId,
    summarySearchPath,
    onSearchExpand,
    onSearchRestore,
    class: className = '',
  }: Props = $props();

  // Delegates to the consumer transition when provided; the zero-duration
  // fallback keeps removal synchronous for rows without preview motion.
  function previewContentTransition(
    node: Element,
    params?: { tier?: SpringTierName; y?: number },
    options?: { direction?: 'in' | 'out' | 'both' },
  ): TransitionConfig {
    if (!previewTransition) return { duration: 0 };
    return previewTransition(node, params, options);
  }
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
  data-chat-search-disclosure-id={searchDisclosureId}
  data-chat-search-expanded={searchDisclosureId ? expanded : undefined}
  use:searchDisclosureEvents={{ onExpand: onSearchExpand, onRestore: onSearchRestore }}
>
  <div class={CHAT_OPERATIONAL_ROW_CLASS} data-operational-disclosure-row data-compact-tool-row>
    {#if interactive}
      <Button
        variant="plain"
        bind:ref={triggerElement}
        type="button"
        truncateLabel={false}
        labelClass="type-body"
        class="type-body col-span-2 flex h-auto min-w-0 w-full cursor-pointer items-center justify-start gap-[var(--operational-leading-gap)] border-0 bg-transparent p-0 text-left focus-visible:underline focus-visible:underline-offset-2"
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
          data-chat-search-block-path={summarySearchPath}
          title={summaryTitle}>{@render summary()}</span
        >
      </Button>
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
        data-chat-search-block-path={summarySearchPath}
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
              class="{CHAT_OPERATIONAL_CHEVRON_CLASS} {expanded ? '' : 'rotate-90'}"
            />
          </span>
        {/if}
      </span>
    {/if}
  </div>

  {#if preview}
    <div class={previewClass} data-operational-preview-content out:previewContentTransition>
      {@render preview()}
    </div>
  {/if}

  {#if details && animateDetailsHeight}
    <div
      bind:this={detailsElement}
      id={expanded ? detailsId : undefined}
      class={detailsClass}
      data-operational-expanded-content={expanded ? '' : undefined}
      data-response-group-motion="animated-height"
      inert={!expanded || detailsInert}
      aria-hidden={detailsAriaHidden ?? !expanded}
      use:animatedHeight={expanded}
    >
      {#if expanded}
        <div>{@render details()}</div>
      {/if}
    </div>
  {:else if details}
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

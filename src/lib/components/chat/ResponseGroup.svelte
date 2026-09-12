<!--
  ResponseGroup.svelte

  A collapsible group UI component that renders named sections in agent responses.
  Shows a sleek, minimal trigger row with summary stats (tool calls, text, agents)
  and tool category icons when collapsed.
  Auto-expands while streaming and auto-collapses when done, with user toggle override.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import type { Snippet } from 'svelte';
  import { flushSync, onDestroy } from 'svelte';
  import type { TransitionConfig } from 'svelte/transition';
  import type { ContentBlock } from '$shared/types';
  import { getContentBlockText } from '$shared/utils/content-block-helpers';
  import { m } from '$shared/paraglide/messages.js';
  import CylinderScroller from './CylinderScroller.svelte';
  import InlineMarkdownSnippet from './InlineMarkdownSnippet.svelte';
  import { getResponseGroupPreviewBlock } from './response-group-blocks';
  import { faArrowsInLineVertical, faArrowsOutLineVertical } from '$lib/icons/phosphor-icons';
  import {
    OPERATIONAL_GROUP_CONTENT_CLASS,
    CHAT_OPERATIONAL_ICON_CLASS,
    getOperationalGroupContentSpacingClass,
    OPERATIONAL_PRIMARY_CLASS,
    OPERATIONAL_SECONDARY_CLASS,
  } from './operational-disclosure-row';
  import ChatOperationalRow from './ChatOperationalRow.svelte';
  import { safeDisclosureTransition } from './disclosure-motion';

  interface Props {
    name: string;
    isStreaming?: boolean;
    isTerminal?: boolean;
    /** True when the owning message is the conversation's final assistant message. */
    isLastConversationMessage?: boolean;
    children: Snippet;
    currentChild?: Snippet;
    currentChildKey?: string;
    blocks?: ContentBlock[];
    reasoningPhase?: boolean;
    adjacentOperationalRow?: boolean;
    followedByOperationalRow?: boolean;
    searchPath?: string;
    class?: string;
  }

  let {
    name,
    isStreaming = false,
    isTerminal = false,
    isLastConversationMessage = false,
    children,
    currentChild,
    currentChildKey,
    blocks,
    reasoningPhase = false,
    adjacentOperationalRow = false,
    followedByOperationalRow = false,
    searchPath,
    class: className = '',
  }: Props = $props();

  const usesLegacyLifecycle = $derived(
    !reasoningPhase ||
      (blocks?.some((block) => block.type === 'tool_result') === true &&
        !blocks.some((block) => block.type === 'thinking')),
  );

  function automaticExpanded(
    currentlyStreaming: boolean,
    currentlyTerminal: boolean,
    hasCurrentChild: boolean,
  ): boolean {
    if (!currentlyStreaming) return currentlyTerminal && isLastConversationMessage;
    if (!usesLegacyLifecycle && currentlyTerminal) return true;
    return reasoningPhase ? false : !hasCurrentChild;
  }

  // svelte-ignore state_referenced_locally -- intentional initial seed; the streaming-edge effect below manages transitions.
  let isExpanded = $state(automaticExpanded(isStreaming, isTerminal, Boolean(currentChild)));
  let isClosing = $state(false);
  let isInitialized = false;
  let desiredExpanded = false;
  let prevStreaming = false;
  let prevTerminal = false;
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let contentEl: HTMLElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  const instanceId = $props.id();
  const detailsId = `response-group-details-${instanceId}`;
  let searchOwnsExpansion = false;
  let disclosureOverride: 'automatic' | 'expanded-live' | 'expanded-completed' | 'collapsed' =
    'automatic';

  function setExpanded(nextExpanded: boolean) {
    desiredExpanded = nextExpanded;
    if (nextExpanded) {
      isClosing = false;
      isExpanded = true;
      return;
    }

    if (!isExpanded) return;
    if (contentEl?.contains(document.activeElement)) triggerEl?.focus({ preventScroll: true });
    flushSync(() => {
      isClosing = true;
    });
    isExpanded = false;
  }

  function clearCollapseTimer() {
    if (!collapseTimer) return;
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }

  function scheduleCollapse() {
    clearCollapseTimer();
    if (disclosureOverride === 'collapsed' || !desiredExpanded) return;
    collapseTimer = setTimeout(() => {
      setExpanded(false);
      collapseTimer = null;
    }, 800);
  }

  $effect(() => {
    const currentlyStreaming = isStreaming;
    const currentlyTerminal = isTerminal;
    const hasCurrentChild = Boolean(currentChild);
    if (!isInitialized) {
      isInitialized = true;
      desiredExpanded = isExpanded;
      prevStreaming = currentlyStreaming;
      prevTerminal = currentlyTerminal;
      if (disclosureOverride === 'automatic') {
        setExpanded(automaticExpanded(currentlyStreaming, currentlyTerminal, hasCurrentChild));
      }
      return;
    }

    if (currentlyStreaming) {
      if (!prevStreaming) searchOwnsExpansion = false;
      if (!prevStreaming && disclosureOverride === 'expanded-completed') {
        disclosureOverride = 'automatic';
      }
      if (!searchOwnsExpansion && disclosureOverride === 'automatic') {
        setExpanded(automaticExpanded(currentlyStreaming, currentlyTerminal, hasCurrentChild));
      }
      clearCollapseTimer();
    } else if (prevStreaming && !currentlyStreaming) {
      if (!usesLegacyLifecycle) {
        clearCollapseTimer();
        if (!searchOwnsExpansion && disclosureOverride === 'automatic') {
          setExpanded(currentlyTerminal);
        } else if (disclosureOverride === 'expanded-live') {
          disclosureOverride = 'expanded-completed';
        }
      } else if (currentlyTerminal) {
        clearCollapseTimer();
        if (disclosureOverride !== 'collapsed') setExpanded(true);
      } else {
        scheduleCollapse();
      }
    } else if (prevTerminal && !currentlyTerminal) {
      if (searchOwnsExpansion || disclosureOverride === 'expanded-completed') {
        clearCollapseTimer();
      } else {
        scheduleCollapse();
      }
    } else if (!prevTerminal && currentlyTerminal) {
      clearCollapseTimer();
      if (!searchOwnsExpansion && disclosureOverride === 'automatic') {
        setExpanded(true);
      }
    } else if (
      !searchOwnsExpansion &&
      disclosureOverride !== 'expanded-completed' &&
      !currentlyTerminal
    ) {
      setExpanded(false);
    }
    prevStreaming = currentlyStreaming;
    prevTerminal = currentlyTerminal;
  });

  onDestroy(() => {
    clearCollapseTimer();
  });

  function toggle() {
    clearCollapseTimer();

    searchOwnsExpansion = false;
    const nextExpanded = !desiredExpanded;
    disclosureOverride = nextExpanded
      ? isStreaming
        ? 'expanded-live'
        : 'expanded-completed'
      : 'collapsed';
    setExpanded(nextExpanded);
  }

  function expandForSearch() {
    if (desiredExpanded) return;
    clearCollapseTimer();
    searchOwnsExpansion = true;
    setExpanded(true);
  }

  function restoreSearchExpansion() {
    if (!searchOwnsExpansion) return;
    searchOwnsExpansion = false;
    if (usesLegacyLifecycle) {
      if (isStreaming && disclosureOverride === 'automatic') {
        setExpanded(!currentChild);
        return;
      }
      setExpanded(false);
      return;
    }
    if (disclosureOverride === 'collapsed') setExpanded(false);
    else if (
      disclosureOverride === 'expanded-live' ||
      disclosureOverride === 'expanded-completed'
    ) {
      setExpanded(true);
    } else if (disclosureOverride === 'automatic') {
      setExpanded(automaticExpanded(isStreaming, isTerminal, Boolean(currentChild)));
    }
  }

  // Keep the collapsed row to one inert, current inline summary.
  // Keep normal named groups to one inline summary. Reasoning phases match the
  // standard reasoning disclosure and reveal their description only when open.
  const textSnippet = $derived.by(() => {
    if (reasoningPhase) return '';
    const previewBlock = getResponseGroupPreviewBlock(blocks);
    return previewBlock ? getContentBlockText(previewBlock).trim() : '';
  });
  const displayName = $derived(
    reasoningPhase
      ? name.trim() ||
          (isStreaming
            ? m.chat_thinkingBlock_thinking_label()
            : m.chat_thinkingBlock_reasoning_label())
      : name,
  );
  const accessibleSummary = $derived(textSnippet ? `${displayName}: ${textSnippet}` : displayName);
  const groupContentClass = $derived(
    `${OPERATIONAL_GROUP_CONTENT_CLASS} ${getOperationalGroupContentSpacingClass(blocks)}`,
  );

  // Disclosure motion for the streaming preview. When the preview leaves
  // because the group expanded, the details body mounts in the same tick with
  // its own disclosure intro — skip the preview outro so two containers never
  // animate height against the followed bottom at once. The terminal
  // stream-end auto-expand needs its own gate: the outro config is captured
  // during the template flush, before the streaming-edge effect flips
  // isExpanded, so mirror that effect's decision from the already-updated
  // props instead.
  function previewTransition(
    node: Element,
    params: { duration?: number; y?: number } = {},
    options: { direction?: 'in' | 'out' | 'both' } = {},
  ): TransitionConfig {
    if (isExpanded || (!isStreaming && isTerminal && disclosureOverride !== 'collapsed')) {
      return { duration: 0 };
    }
    return safeDisclosureTransition(node, params, options);
  }
</script>

{#snippet leading()}
  <span class="flex" data-response-group-disclosure-icon>
    <Fa
      icon={isExpanded ? faArrowsOutLineVertical : faArrowsInLineVertical}
      size={16}
      class={CHAT_OPERATIONAL_ICON_CLASS}
    />
  </span>
{/snippet}

{#snippet summary()}
  <span class="font-normal {OPERATIONAL_PRIMARY_CLASS}" data-testid="response-group-name"
    >{displayName}</span
  >{#if textSnippet && !isExpanded && (!isStreaming || !currentChild)}<InlineMarkdownSnippet
      content={textSnippet}
      class="ml-2.5 font-normal {OPERATIONAL_SECONDARY_CLASS}"
      testId="response-group-snippet"
    />{/if}
{/snippet}

{#snippet preview()}
  <CylinderScroller isActive={isStreaming} constrained={false}>
    <div class="relative flex flex-col gap-0" data-response-group-content>
      <span
        class="operational-group-guide pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-border"
        data-operational-expanded-guide
        aria-hidden="true"
      ></span>
      {#key currentChildKey}
        <div data-response-group-preview-child transition:safeDisclosureTransition>
          {@render currentChild?.()}
        </div>
      {/key}
    </div>
  </CylinderScroller>
{/snippet}

{#snippet details()}
  <CylinderScroller isActive={isStreaming} constrained={false}>
    <div class="relative flex flex-col gap-0" data-response-group-content>
      <span
        class="operational-group-guide pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-border"
        data-operational-expanded-guide
        aria-hidden="true"
      ></span>
      {@render children()}
    </div>
  </CylinderScroller>
{/snippet}

<ChatOperationalRow
  {leading}
  {summary}
  preview={!isExpanded && isStreaming && currentChild ? preview : undefined}
  details={isExpanded ? details : undefined}
  interactive
  showChevron={false}
  expanded={isExpanded}
  controls={detailsId}
  ariaLabel={accessibleSummary}
  title={accessibleSummary}
  summaryTitle={accessibleSummary}
  onclick={toggle}
  {detailsId}
  previewClass={OPERATIONAL_GROUP_CONTENT_CLASS}
  detailsClass={groupContentClass}
  {previewTransition}
  detailsTransition={safeDisclosureTransition}
  detailsMotion="height-opacity-y"
  detailsInert={isClosing}
  detailsAriaHidden={isClosing || undefined}
  bind:triggerElement={triggerEl}
  bind:detailsElement={contentEl}
  {adjacentOperationalRow}
  streaming={isStreaming}
  testId="response-group"
  disclosureTestId="response-group-disclosure"
  summaryTestId="response-group-summary"
  class={isExpanded && !followedByOperationalRow ? `${className} mb-3` : className}
  searchDisclosureId={searchPath ? `group:${searchPath}` : undefined}
  summarySearchPath={searchPath ? `${searchPath}:summary` : undefined}
  onSearchExpand={expandForSearch}
  onSearchRestore={restoreSearchExpansion}
/>

<style>
  .operational-group-guide {
    left: calc(var(--operational-row-inline-padding) + var(--operational-leading-half-slot-size));
  }

  :global(.operational-group-child-row) {
    padding-inline-start: calc(
      var(--operational-leading-half-slot-size) + var(--operational-leading-gap)
    );
  }
</style>

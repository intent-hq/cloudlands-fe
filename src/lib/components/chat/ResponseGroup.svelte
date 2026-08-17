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
  import { onDestroy } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import { getContentBlockText } from '$shared/utils/content-block-helpers';
  import CylinderScroller from './CylinderScroller.svelte';
  import InlineMarkdownSnippet from './InlineMarkdownSnippet.svelte';
  import { getResponseGroupPreviewBlock } from './response-group-blocks';
  import { faArrowsInLineVertical } from '$lib/icons/phosphor-icons';
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
    /** When true, the group stays expanded after streaming ends (e.g., last group in response) */
    isLast?: boolean;
    children: Snippet;
    blocks?: ContentBlock[];
    adjacentOperationalRow?: boolean;
    class?: string;
  }

  let {
    name,
    isStreaming = false,
    isLast = false,
    children,
    blocks,
    adjacentOperationalRow = false,
    class: className = '',
  }: Props = $props();

  // svelte-ignore state_referenced_locally -- intentional initial seed; the streaming-edge effect below manages transitions.
  let isExpanded = $state(isStreaming || (isLast && !isStreaming));
  let isClosing = $state(false);
  let isInitialized = false;
  let desiredExpanded = false;
  let prevStreaming = false;
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let contentEl: HTMLElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  const instanceId = $props.id();
  const detailsId = `response-group-details-${instanceId}`;
  let userCollapsed = false;

  function setExpanded(nextExpanded: boolean) {
    desiredExpanded = nextExpanded;
    if (nextExpanded) {
      isClosing = false;
      isExpanded = true;
      return;
    }

    if (!isExpanded) return;
    if (contentEl?.contains(document.activeElement)) triggerEl?.focus({ preventScroll: true });
    isClosing = true;
    isExpanded = false;
  }

  $effect(() => {
    const currentlyStreaming = isStreaming;
    if (!isInitialized) {
      isInitialized = true;
      desiredExpanded = isExpanded;
      prevStreaming = currentlyStreaming;
      return;
    }

    if (currentlyStreaming && !prevStreaming) {
      if (!userCollapsed) setExpanded(true);
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
    } else if (prevStreaming && !currentlyStreaming) {
      if (!userCollapsed && !isLast) {
        collapseTimer = setTimeout(() => {
          setExpanded(false);
          collapseTimer = null;
        }, 800);
      }
    }
    prevStreaming = currentlyStreaming;
  });

  onDestroy(() => {
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
  });

  function toggle() {
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }

    const nextExpanded = !desiredExpanded;
    userCollapsed = !nextExpanded;
    setExpanded(nextExpanded);
  }

  // Keep the collapsed row to one inert, current inline summary.
  const textSnippet = $derived.by(() => {
    const previewBlock = getResponseGroupPreviewBlock(blocks);
    return previewBlock ? getContentBlockText(previewBlock).trim() : '';
  });
  const accessibleSummary = $derived(textSnippet ? `${name}: ${textSnippet}` : name);
  const groupContentClass = $derived(
    `${OPERATIONAL_GROUP_CONTENT_CLASS} ${getOperationalGroupContentSpacingClass(blocks)}`,
  );
</script>

{#snippet leading()}
  <Fa icon={faArrowsInLineVertical} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
{/snippet}

{#snippet summary()}
  <span class="font-normal {OPERATIONAL_PRIMARY_CLASS}" data-testid="response-group-name"
    >{name}</span
  >{#if textSnippet && !isExpanded}<InlineMarkdownSnippet
      content={textSnippet}
      class="ml-2.5 font-normal {OPERATIONAL_SECONDARY_CLASS}"
      testId="response-group-snippet"
    />{/if}
{/snippet}

{#snippet details()}
  <CylinderScroller isActive={isStreaming} constrained={false}>
    <div class="flex flex-col gap-0" data-response-group-content>
      {@render children()}
    </div>
  </CylinderScroller>
{/snippet}

<ChatOperationalRow
  {leading}
  {summary}
  details={isExpanded ? details : undefined}
  interactive
  expanded={isExpanded}
  controls={detailsId}
  ariaLabel={accessibleSummary}
  title={accessibleSummary}
  summaryTitle={accessibleSummary}
  onclick={toggle}
  {detailsId}
  detailsClass={groupContentClass}
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
  class={className}
/>

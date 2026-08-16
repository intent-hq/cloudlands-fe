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
  import { onDestroy, tick } from 'svelte';
  import type { ContentBlock } from '$shared/types';
  import { getContentBlockText } from '$shared/utils/content-block-helpers';
  import CylinderScroller from './CylinderScroller.svelte';
  import InlineMarkdownSnippet from './InlineMarkdownSnippet.svelte';
  import { getResponseGroupPreviewBlock } from './response-group-blocks';
  import { faArrowsInLineVertical } from '$lib/icons/phosphor-icons';
  import {
    OPERATIONAL_EXPANDED_CONTENT_CLASS,
    OPERATIONAL_EXPANDED_GUIDE_CLASS,
    OPERATIONAL_ICON_BOX_CLASS,
    OPERATIONAL_ICON_CLASS,
    OPERATIONAL_PRIMARY_CLASS,
    OPERATIONAL_ROW_LINE_CLASS,
    OPERATIONAL_SECONDARY_CLASS,
    OPERATIONAL_ROW_TONE_CLASS,
    OPERATIONAL_SUMMARY_CLASS,
  } from './operational-disclosure-row';

  interface Props {
    name: string;
    isStreaming?: boolean;
    /** When true, the group stays expanded after streaming ends (e.g., last group in response) */
    isLast?: boolean;
    children: Snippet;
    blocks?: ContentBlock[];
    class?: string;
  }

  let {
    name,
    isStreaming = false,
    isLast = false,
    children,
    blocks,
    class: className = '',
  }: Props = $props();

  const DISCLOSURE_MOTION_DURATION = 220;
  // svelte-ignore state_referenced_locally -- intentional initial seed; the streaming-edge effect below manages transitions.
  let isExpanded = $state(isStreaming || (isLast && !isStreaming));
  let isClosing = $state(false);
  let isInitialized = false;
  let desiredExpanded = false;
  let prevStreaming = false;
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let contentEl: HTMLElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  let activeAnimation: Animation | null = null;
  let motionGeneration = 0;
  const instanceId = $props.id();
  const detailsId = `response-group-details-${instanceId}`;
  let userCollapsed = false;

  function prefersReducedMotion(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );
  }

  async function setExpanded(nextExpanded: boolean, animate = true) {
    desiredExpanded = nextExpanded;
    const generation = ++motionGeneration;
    activeAnimation?.cancel();
    if (contentEl) contentEl.style.overflow = '';
    activeAnimation = null;

    if (nextExpanded) {
      isClosing = false;
      const wasExpanded = isExpanded;
      isExpanded = true;
      await tick();
      const element = contentEl;
      if (
        wasExpanded ||
        generation !== motionGeneration ||
        !animate ||
        prefersReducedMotion() ||
        !element?.animate
      ) {
        return;
      }

      const targetHeight = Math.max(element.offsetHeight, element.scrollHeight, 0);
      element.style.overflow = 'hidden';
      const animation = element.animate(
        [
          { height: '0px', opacity: 0, transform: 'translateY(-4px)' },
          { height: `${targetHeight}px`, opacity: 1, transform: 'translateY(0)' },
        ],
        {
          duration: DISCLOSURE_MOTION_DURATION,
          easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
        },
      );
      activeAnimation = animation;
      try {
        await animation.finished;
      } catch {
        // A new toggle cancels the superseded animation.
      }
      if (generation === motionGeneration) {
        element.style.overflow = '';
        activeAnimation = null;
      }
      return;
    }

    if (!isExpanded) return;
    const element = contentEl;
    if (element?.contains(document.activeElement)) triggerEl?.focus();
    isClosing = true;
    if (!animate || prefersReducedMotion() || !element?.animate) {
      isExpanded = false;
      isClosing = false;
      return;
    }

    const startHeight = Math.max(element.offsetHeight, element.scrollHeight, 0);
    element.style.overflow = 'hidden';
    const animation = element.animate(
      [
        { height: `${startHeight}px`, opacity: 1, transform: 'translateY(0)' },
        { height: '0px', opacity: 0, transform: 'translateY(-4px)' },
      ],
      {
        duration: DISCLOSURE_MOTION_DURATION,
        easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
        fill: 'forwards',
      },
    );
    activeAnimation = animation;
    try {
      await animation.finished;
    } catch {
      // A new toggle cancels the superseded animation.
    }
    if (generation === motionGeneration) {
      isExpanded = false;
      isClosing = false;
      activeAnimation = null;
    }
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
      if (!userCollapsed) void setExpanded(true);
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
    } else if (prevStreaming && !currentlyStreaming) {
      if (!userCollapsed && !isLast) {
        collapseTimer = setTimeout(() => {
          void setExpanded(false);
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
    activeAnimation?.cancel();
  });

  function toggle() {
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }

    const nextExpanded = !desiredExpanded;
    userCollapsed = !nextExpanded;
    void setExpanded(nextExpanded);
  }

  // Keep the collapsed row to one inert, current inline summary.
  const textSnippet = $derived.by(() => {
    const previewBlock = getResponseGroupPreviewBlock(blocks);
    return previewBlock ? getContentBlockText(previewBlock).trim() : '';
  });
</script>

<div class="min-w-0 max-w-full overflow-hidden {className}">
  <button
    bind:this={triggerEl}
    type="button"
    class="{OPERATIONAL_ROW_TONE_CLASS} {OPERATIONAL_ROW_LINE_CLASS} cursor-pointer rounded-md border-none bg-transparent text-left focus-visible:outline-none"
    data-operational-disclosure-row
    onclick={toggle}
    aria-expanded={isExpanded}
    aria-controls={detailsId}
  >
    <span class={OPERATIONAL_ICON_BOX_CLASS} data-operational-icon-box aria-hidden="true">
      <Fa icon={faArrowsInLineVertical} size={18} class={OPERATIONAL_ICON_CLASS} />
    </span>
    <!-- Name and snippet share one line box so their text baselines coincide;
         a flex sibling with `truncate` (overflow: hidden) would synthesize its
         baseline from the box edge and sit visibly raised. -->
    <span class={OPERATIONAL_SUMMARY_CLASS} data-testid="response-group-summary">
      <span class="font-normal {OPERATIONAL_PRIMARY_CLASS}" data-testid="response-group-name"
        >{name}</span
      >{#if textSnippet && !isExpanded}<InlineMarkdownSnippet
          content={textSnippet}
          class="ml-2.5 font-normal {OPERATIONAL_SECONDARY_CLASS}"
          testId="response-group-snippet"
        />{/if}
    </span>
  </button>

  {#if isExpanded}
    <div
      bind:this={contentEl}
      id={detailsId}
      class="{OPERATIONAL_EXPANDED_CONTENT_CLASS} relative"
      data-operational-expanded-content
      data-response-group-motion="height-opacity-y"
      inert={isClosing}
      aria-hidden={isClosing ? 'true' : undefined}
    >
      <span class={OPERATIONAL_EXPANDED_GUIDE_CLASS} data-operational-expanded-guide></span>
      <CylinderScroller isActive={isStreaming} constrained={false}>
        <div class="flex flex-col gap-1.5">
          {@render children()}
        </div>
      </CylinderScroller>
    </div>
  {/if}
</div>

<style>
  @keyframes slideInX {
    from {
      opacity: 0;
      transform: translateX(-8px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .icon-animate-in {
    animation: slideInX 200ms ease-out both;
  }
</style>

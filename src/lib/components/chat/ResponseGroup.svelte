<!--
  ResponseGroup.svelte

  A collapsible group UI component that renders named sections in agent responses.
  Shows a sleek, minimal trigger row with summary stats (tool calls, text, agents)
  and tool category icons when collapsed.
  Auto-expands while streaming and auto-collapses when done, with user toggle override.
-->
<script lang="ts">
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import { faRectangleList } from '@fortawesome/free-solid-svg-icons';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';
  import { classifyTool, CATEGORY_ICONS, type ToolCategory } from './tool-classifier';
  import type { ContentBlock } from '$shared/types';
  import CylinderScroller from './CylinderScroller.svelte';

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

  // State model: two independent booleans
  // - isExpanded: user wants full content (no cylinder)
  // - showCylinder: cylinder preview is visible (during/after streaming)
  let isExpanded = $state(isLast && !isStreaming);
  let showCylinder = $state(isLast && !isStreaming);
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let contentEl: HTMLElement | undefined = $state();

  // Track previous streaming state to detect streaming→not-streaming edge
  let prevStreaming = $state(false);

  $effect(() => {
    const currentlyStreaming = isStreaming;

    if (currentlyStreaming) {
      showCylinder = true;
      prevStreaming = true;
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
    } else if (prevStreaming && !currentlyStreaming) {
      prevStreaming = false;

      if (isLast) {
        // Last group stays fully expanded after streaming ends
        isExpanded = true;
        showCylinder = true;
      } else {
        isExpanded = false;
        // After streaming ends, collapse after delay
        collapseTimer = setTimeout(() => {
          showCylinder = false;
          collapseTimer = null;
        }, 800);
      }
    }
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

    const el = contentEl;
    if (el) {
      // Capture current height before toggle. Guard against non-finite values
      // (some browser/element states can yield NaN/undefined for these).
      const startHeight = Number.isFinite(el.offsetHeight) ? el.offsetHeight : 0;

      // Toggle state
      isExpanded = !isExpanded;
      if (!isExpanded) showCylinder = false;

      // After Svelte updates the DOM, animate from old height to new height
      requestAnimationFrame(() => {
        const endHeight = Number.isFinite(el.scrollHeight) ? el.scrollHeight : 0;

        // Only animate if heights differ significantly and both are finite
        if (
          Number.isFinite(startHeight) &&
          Number.isFinite(endHeight) &&
          Math.abs(startHeight - endHeight) > 10
        ) {
          el.animate(
            [
              { height: `${startHeight}px`, overflow: 'hidden' },
              { height: `${endHeight}px`, overflow: 'hidden' },
            ],
            {
              duration: 250,
              easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
              fill: 'none',
            },
          );
        }
      });
    } else {
      isExpanded = !isExpanded;
      if (!isExpanded) showCylinder = false;
    }
  }

  // Compute stats from blocks
  const stats = $derived.by(() => {
    if (!blocks || blocks.length === 0)
      return { toolCalls: 0, agents: 0, icons: [] as IconDefinition[] };

    let toolCalls = 0;
    let agents = 0;
    const categorySet = new Set<ToolCategory>();

    for (const block of blocks) {
      if (block.type === 'tool_use') {
        toolCalls++;
        const display = classifyTool(block.name || '', (block.input as Record<string, any>) || {});
        categorySet.add(display.category);
        if (display.category === 'agent') agents++;
      }
    }

    const icons = [...categorySet].map((cat) => CATEGORY_ICONS[cat]).filter(Boolean);
    return { toolCalls, agents, icons };
  });

  // Custom collapse transition that reads the element's CURRENT offsetHeight
  // (constrained by the cylinder) instead of the full content height.
  function collapseFromCurrent(node: HTMLElement, { duration = 300, easing = cubicOut } = {}) {
    // Coerce any non-finite measurement to 0. parseFloat('') returns NaN,
    // and offsetHeight can be undefined on non-HTMLElement nodes; either
    // would otherwise produce `NaNpx` keyframe values.
    const safe = (n: number): number => (Number.isFinite(n) ? n : 0);
    const currentHeight = safe(node.offsetHeight);
    const style = getComputedStyle(node);
    const paddingTop = safe(parseFloat(style.paddingTop));
    const paddingBottom = safe(parseFloat(style.paddingBottom));
    const marginTop = safe(parseFloat(style.marginTop));
    const marginBottom = safe(parseFloat(style.marginBottom));

    return {
      duration,
      easing,
      css: (t: number) => {
        const tt = Number.isFinite(t) ? t : 0;
        return `
          overflow: hidden;
          height: ${tt * currentHeight}px;
          padding-top: ${tt * paddingTop}px;
          padding-bottom: ${tt * paddingBottom}px;
          margin-top: ${tt * marginTop}px;
          margin-bottom: ${tt * marginBottom}px;
          opacity: ${Math.min(1, tt * 2)};
        `;
      },
    };
  }

  // Extract snippet from first text block for collapsed preview
  const textSnippet = $derived.by(() => {
    if (!blocks) return '';
    const firstText = blocks.find((b) => b.type === 'text' && (b.text || b.content));
    if (!firstText) return '';
    const raw = (firstText.text || firstText.content || '').trim();
    // Strip any HTML/XML-like tags (group tags, markdown artifacts)
    const cleaned = raw.replace(/<[^>]+>/g, '').trim();
    // Take first ~80 chars, break at word boundary
    if (cleaned.length <= 80) return cleaned;
    const truncated = cleaned.substring(0, 200);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 40 ? truncated.substring(0, lastSpace) : truncated) + '…';
  });
</script>

<div class={className}>
  <button
    type="button"
    class="flex items-center gap-2.5 w-full py-1 px-1 border-none cursor-pointer text-left text-subtle text-base transition-colors duration-150 rounded-md"
    onclick={toggle}
    aria-expanded={isExpanded}
  >
    <div
      class="flex items-center justify-center shrink-0 transition-opacity duration-300 {isStreaming
        ? 'opacity-70'
        : ''}"
    >
      <Fa icon={faRectangleList} size={12} class="text-ghost" />
    </div>
    <span class="font-semibold text-foreground shrink-0">{name}</span>
    {#if textSnippet}
      <span class="text-sm text-subtle truncate min-w-0">{textSnippet}</span>
    {/if}
    <div class="flex items-center gap-1.5 ml-auto shrink-0 opacity-40">
      {#each stats.icons.slice(0, 5) as icon, i (icon)}
        <span class="icon-animate-in" style="animation-delay: {i * 50}ms">
          <Fa {icon} size={10} />
        </span>
      {/each}
    </div>
  </button>

  {#if isExpanded || showCylinder}
    <div
      bind:this={contentEl}
      class="pl-4.5 border-l border-muted-foreground/15 ml-2"
      out:collapseFromCurrent={{ duration: 300 }}
    >
      <CylinderScroller isActive={isStreaming && !isExpanded} constrained={!isExpanded}>
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

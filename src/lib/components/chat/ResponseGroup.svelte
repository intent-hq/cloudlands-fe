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
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';
  import { classifyTool, CATEGORY_ICONS, type ToolCategory } from './tool-classifier';
  import type { ContentBlock, ToolUseBlock } from '$shared/types';
  import { getContentBlockText } from '$shared/utils/content-block-helpers';
  import CylinderScroller from './CylinderScroller.svelte';
  import AgentPreviewToolLabel from './AgentPreviewToolLabel.svelte';
  import { getResponseGroupPreviewBlock } from './response-group-blocks';

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
  // - showCylinder: cylinder preview is visible (during/after streaming).
  //   For the last group (or while streaming) it stays true on collapse, so
  //   "collapse" lands on the semi-open preview instead of fully closing.
  // svelte-ignore state_referenced_locally -- intentional initial seed; the streaming-edge effect below manages transitions.
  let isExpanded = $state(isLast && !isStreaming);
  // svelte-ignore state_referenced_locally -- intentional initial seed; the streaming-edge effect below manages transitions.
  let showCylinder = $state(isLast && !isStreaming);
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let contentEl: HTMLElement | undefined = $state();
  // Tracks a manual collapse so the streaming-end effect doesn't force the
  // last group back to fully expanded (non-reactive by design).
  let userCollapsed = false;

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
        // Last group can never fully close; if the user collapsed it
        // mid-stream, land on semi-open instead of force-expanding
        showCylinder = true;
        if (!userCollapsed) isExpanded = true;
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
      applyToggle();

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
      applyToggle();
    }
  }

  function applyToggle() {
    isExpanded = !isExpanded;
    userCollapsed = !isExpanded;
    // Last/streaming groups can never fully close — collapsing them lands
    // on the semi-open cylinder preview
    if (!isExpanded) showCylinder = isLast || isStreaming;
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

  // Keep collapsed groups lightweight: render one inert, current summary
  // instead of retaining every detailed tool and its focus targets.
  const previewBlock = $derived(getResponseGroupPreviewBlock(blocks));
  const previewText = $derived(previewBlock ? getContentBlockText(previewBlock) : '');
</script>

<div class={className}>
  <button
    type="button"
    class="type-caption flex w-full cursor-pointer items-center gap-2.5 rounded-md border-none py-1 text-left text-muted-foreground/60 transition-colors duration-[var(--motion-fast)] hover:text-muted-foreground focus-visible:text-muted-foreground"
    onclick={toggle}
    aria-expanded={isExpanded}
  >
    <!-- Name and snippet share one line box so their text baselines coincide;
         a flex sibling with `truncate` (overflow: hidden) would synthesize its
         baseline from the box edge and sit visibly raised. -->
    <span class="min-w-0 truncate">
      <span class="text-foreground">{name}</span>{#if textSnippet && !isExpanded}<span
          class="ml-2.5 text-muted-foreground">{textSnippet}</span
        >{/if}
    </span>
    <div class="ml-auto flex shrink-0 items-center gap-1.5 opacity-30">
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
      class="border-l border-muted-foreground/10 pl-4.5"
      out:collapseFromCurrent={{ duration: 300 }}
    >
      <CylinderScroller isActive={isStreaming && !isExpanded} constrained={!isExpanded}>
        <div class="flex flex-col gap-1.5">
          {#if isExpanded}
            {@render children()}
          {:else if previewBlock?.type === 'tool_use'}
            <div
              class="type-caption min-w-0 py-0.5 text-muted-foreground"
              data-response-group-preview
            >
              <AgentPreviewToolLabel toolUse={previewBlock as ToolUseBlock} animate={isStreaming} />
            </div>
          {:else if previewText}
            <div
              class="type-caption whitespace-pre-wrap py-0.5 text-muted-foreground"
              data-response-group-preview
              aria-live={isStreaming ? 'polite' : undefined}
            >
              {previewText}
            </div>
          {/if}
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

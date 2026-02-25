<!--
  ResponseGroup.svelte

  A collapsible group UI component that renders named sections in agent responses.
  Shows a sleek, minimal trigger row with summary stats (tool calls, text, agents)
  and tool category icons when collapsed.
  Auto-expands while streaming and auto-collapses when done, with user toggle override.
-->
<script lang="ts">
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import { faChevronRight, faRectangleList } from '@fortawesome/free-solid-svg-icons';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import type { Snippet } from 'svelte';
  import { classifyTool, CATEGORY_ICONS, type ToolCategory } from './tool-classifier';
  import type { ContentBlock } from '$shared/types';

  interface Props {
    name: string;
    isStreaming?: boolean;
    children: Snippet;
    blocks?: ContentBlock[];
    class?: string;
  }

  let { name, isStreaming = false, children, blocks, class: className = '' }: Props = $props();

  // Auto-expand while streaming, collapse when done
  let isExpanded = $state(false);

  // Track if user has manually toggled
  let userToggled = $state(false);

  $effect(() => {
    if (!userToggled) {
      isExpanded = isStreaming;
    }
  });

  function toggle() {
    userToggled = true;
    isExpanded = !isExpanded;
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
    class="flex items-center gap-2.5 w-full py-1 px-1 border-none cursor-pointer text-left text-muted-foreground text-base transition-colors duration-150 rounded-md"
    onclick={toggle}
    aria-expanded={isExpanded}
  >
    <div class="flex items-center justify-center shrink-0 {isStreaming ? 'animate-pulse' : ''}">
      <Fa icon={faRectangleList} size={12} class="text-muted-foreground/50" />
    </div>
    <span class="font-semibold text-foreground/80 shrink-0">{name}</span>
    {#if !isExpanded && textSnippet}
      <span class="text-sm text-muted-foreground/50 truncate min-w-0">{textSnippet}</span>
    {/if}
    {#if stats.icons.length > 0}
      <div class="flex items-center gap-1.5 ml-0.75 opacity-40">
        {#each stats.icons.slice(0, 5) as icon}
          <Fa {icon} size={10} />
        {/each}
      </div>
    {/if}
    <!-- <div
      class="flex items-center justify-center shrink-0 ml-auto transition-transform duration-200 {isExpanded
        ? 'rotate-90'
        : 'rotate-180'}"
    >
      <Fa icon={faChevronRight} size={9} class="text-muted-foreground/50" />
    </div> -->
  </button>

  {#if isExpanded}
    <div
      class="pl-4.5 border-l border-muted-foreground/15 ml-2 flex flex-col gap-1.5"
      transition:slide={{ duration: 200, easing: cubicOut }}
    >
      {@render children()}
    </div>
  {/if}
</div>

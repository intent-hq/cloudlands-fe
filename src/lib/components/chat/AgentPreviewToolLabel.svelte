<script lang="ts">
  /**
   * AgentPreviewToolLabel
   *
   * Compact icon + label preview for a tool_use block, mirroring the icon
   * logic used by ToolCall.svelte. Used in agent preview surfaces
   * (AgentCard, AgentPeekCard) instead of the old 🔧 emoji fallback.
   */
  import type { ToolUseBlock } from '$shared/types';
  import Fa from 'svelte-fa';
  import McpIcon from '$lib/components/settings/mcp/McpIcon.svelte';
  import { classifyTool } from '$lib/utils/tool-classifier';
  import { renderInlineMarkdownPlainText } from './inline-markdown-snippet';
  import { m } from '$shared/paraglide/messages.js';

  /** MCP sources that have brand icons in McpIcon (mirrors ToolCall.svelte) */
  const BRANDED_MCP_ICONS = new Set([
    'figma',
    'sentry',
    'playwright',
    'github',
    'linear',
    'slack',
    'context7',
  ]);

  interface Props {
    toolUse: ToolUseBlock;
    /** Pulse the icon to indicate the tool is actively running */
    animate?: boolean;
    /** Icon pixel size (applies to McpIcon; Fa uses xs) */
    iconSize?: number;
    showIcon?: boolean;
    class?: string;
  }

  let {
    toolUse,
    animate = false,
    iconSize = 12,
    showIcon = true,
    class: className = '',
  }: Props = $props();

  const toolDisplay = $derived(
    classifyTool(toolUse.name, (toolUse.input as Record<string, any>) || {}),
  );

  const rawLabel = $derived.by(() => {
    const parts = [toolDisplay.verb, toolDisplay.subject, toolDisplay.path].filter(Boolean);
    const text = parts.join(' ').trim();
    return text || toolDisplay.verb || m.chat_previewToolLabel_tool_fallback();
  });
  let label = $state('');

  $effect(() => {
    const value = rawLabel;
    let cancelled = false;
    void renderInlineMarkdownPlainText(value).then((cleaned) => {
      if (!cancelled) label = cleaned;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

<!-- No usable label yet (e.g. workspace_api summary still streaming): render nothing -->
{#if !toolDisplay.hidden}
  <span
    class="inline-flex w-full min-w-0 items-center {showIcon ? 'gap-1.5' : ''} {className}"
    title={label}
  >
    {#if showIcon}
      <span
        class="agent-preview-tool-icon inline-flex shrink-0 items-center justify-center text-inherit opacity-[inherit] {animate
          ? 'animate-pulse'
          : ''}"
        style="width: {iconSize}px; height: {iconSize}px;"
        data-testid="agent-preview-tool-icon"
      >
        {#if toolDisplay.mcpSource && BRANDED_MCP_ICONS.has(toolDisplay.mcpSource)}
          <McpIcon iconName={toolDisplay.mcpSource} label={toolDisplay.mcpSource} size={iconSize} />
        {:else}
          <Fa icon={toolDisplay.icon} class="h-full! w-full! text-inherit opacity-[inherit]" />
        {/if}
      </span>
    {/if}
    <span
      class="min-w-0 flex-1 truncate text-inherit opacity-[inherit]"
      data-testid="agent-preview-tool-text">{label}</span
    >
  </span>
{/if}

<style>
  .agent-preview-tool-icon :global(svg) {
    width: 100%;
    height: 100%;
    color: inherit;
    opacity: inherit;
  }
</style>

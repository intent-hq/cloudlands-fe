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
  import { classifyTool } from './tool-classifier';
  import { m } from '$shared/paraglide/messages.js';

  /** MCP sources that have brand icons in McpIcon (mirrors ToolCall.svelte) */
  const BRANDED_MCP_ICONS = new Set([
    'figma', 'sentry', 'playwright', 'github', 'linear',
    'slack', 'context7',
  ]);

  interface Props {
    toolUse: ToolUseBlock;
    /** Pulse the icon to indicate the tool is actively running */
    animate?: boolean;
    /** Icon pixel size (applies to McpIcon; Fa uses xs) */
    iconSize?: number;
    class?: string;
  }

  let {
    toolUse,
    animate = false,
    iconSize = 12,
    class: className = '',
  }: Props = $props();

  const toolDisplay = $derived(
    classifyTool(toolUse.name, (toolUse.input as Record<string, any>) || {}),
  );

  const label = $derived.by(() => {
    const parts = [toolDisplay.verb, toolDisplay.subject].filter(Boolean);
    const text = parts.join(' ').trim();
    return text || toolDisplay.verb || m.chat_previewToolLabel_tool_fallback();
  });
</script>

<!-- No usable label yet (e.g. workspace_api summary still streaming): render nothing -->
{#if !toolDisplay.hidden}
<span class="inline-flex items-center gap-1.5 min-w-0 {className}">
  {#if toolDisplay.mcpSource && BRANDED_MCP_ICONS.has(toolDisplay.mcpSource)}
    <span
      class="shrink-0 inline-flex items-center justify-center {animate
        ? 'animate-pulse'
        : ''}"
      style="width: {iconSize}px; height: {iconSize}px;"
    >
      <McpIcon iconName={toolDisplay.mcpSource} label={toolDisplay.mcpSource} size={iconSize} />
    </span>
  {:else}
    <Fa
      icon={toolDisplay.icon}
      size="xs"
      class="shrink-0 text-ghost {animate ? 'animate-pulse' : ''}"
    />
  {/if}
  <span class="truncate">{label}</span>
  {#if toolDisplay.path}
    <span class="text-subtle truncate min-w-0">{toolDisplay.path}</span>
  {/if}
</span>
{/if}

<script lang="ts">
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import type { ToolUseBlock } from '$shared/types';
  import {
  faCheckCircle,
  faExclamationTriangle,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import ToolDetails from './ToolDetails.svelte';
  import { parseToolResult } from './tool-result-parser';
  import {
  classifyTool,
  isContextEngineTool,
} from './tool-classifier';
  import ContextEngineToolCall from './ContextEngineToolCall.svelte';
  import { noteUrl } from '$shared/constants/intent-links';
  import { handleIntentLink } from '$lib/utils/workspaces-link-handler';
  import { getPanelIdFromEvent } from '$lib/components/layout/panel-system/panel-context';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import McpIcon from '$lib/components/settings/mcp/McpIcon.svelte';

  import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';

  import { isGenericAgentName } from '$lib/utils/agent-name-generator';
  import {
  openWorkspaceFile,
  openWorkspaceNote,
} from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';

  /** MCP sources that have brand icons in McpIcon */
  const BRANDED_MCP_ICONS = new Set([
    'figma', 'sentry', 'playwright', 'github', 'linear',
    'slack', 'context7',
  ]);

  interface Props {
    toolUse: ToolUseBlock;
    toolState?: 'running' | 'completed' | 'error';
    result?: any;
    workspaceId?: string;
  }

  let { toolUse, toolState = 'completed', result = null, workspaceId }: Props = $props();

  // Check if this is a context engine tool (special Augment branding)
  const isContextEngine = $derived(isContextEngineTool(toolUse.name));

  // PERF: Parse result for rich preview - memoized with $derived
  const parsedResult = $derived(
    result ? parseToolResult(toolUse.name, toolUse.input, result) : null,
  );

  // PERF: Classify tool - memoized with $derived
  // Pass result to extract metadata (e.g., note title) for better display
  const baseToolDisplay = $derived(classifyTool(toolUse.name, toolUse.input || {}, result));

  // Enhance tool display with parsed result data for task updates and delegate-task
  // This gives us better header text like "Mark spec done" instead of "Update task"
  const toolDisplay = $derived.by(() => {
    if (parsedResult?.type === 'task-update') {
      if (parsedResult.taskTitle && parsedResult.taskStatus) {
        return {
          ...baseToolDisplay,
          verb: 'Mark',
          subject: `${parsedResult.taskTitle} ${parsedResult.taskStatus}`,
        };
      } else if (parsedResult.taskStatus) {
        // We have status but no title - show generic message
        return {
          ...baseToolDisplay,
          verb: 'Mark task',
          subject: parsedResult.taskStatus,
        };
      }
    }
    // For delegate-task, prefer the task name from the result (more accurate)
    if (parsedResult?.type === 'delegate-task' && parsedResult.delegatedTaskName) {
      return {
        ...baseToolDisplay,
        verb: 'Delegate',
        subject: parsedResult.delegatedTaskName,
      };
    }
    return baseToolDisplay;
  });

  // For agent-message tools, get the target agent's display name
  const isAgentMessage = $derived(
    parsedResult?.type === 'agent-message' && parsedResult?.toAgentId,
  );
  const targetAgentName = $derived.by(() => {
    if (!isAgentMessage || !parsedResult?.toAgentId) return null;
    const state = appStore.state;
    const workspaceId = selectActiveWorkspaceId.select(state);
    const session = workspaceId
      ? selectAgentSession.select(state, parsedResult.toAgentId)
      : undefined;
    if (session?.name && !isGenericAgentName(session.name)) {
      return session.name;
    }
    // Fallback to shortened ID
    return `Agent ${parsedResult.toAgentId.substring(0, 8)}`;
  });

  let expanded = $state(false);
  // Allow expansion for all completed or errored tools so users can always
  // inspect input details and results (even when there's no rich parsed result)
  const isExpandable = $derived(toolState === 'completed' || toolState === 'error');

  // Transition function for expand/collapse animation
  function expand(node: Element) {
    return slide(node, { duration: 150 });
  }


</script>

<!-- Special rendering for Augment Context Engine tools -->
{#if isContextEngine}
  <ContextEngineToolCall {toolUse} {toolState} {result} />
{:else}
  <div
    class="tool-call-container group relative w-full text-base rounded-md transition-all duration-150 ease-out overflow-hidden block font-family-child"
  >
    <!-- Running state: animate-pulse on the icon indicates running state -->
    <div class="flex items-center w-full min-w-0 gap-2 px-1 py-0.5 relative min-h-6">
      <!-- Category icon: show MCP brand logo for known MCPs, otherwise generic FA icon -->
      {#if toolDisplay.mcpSource && BRANDED_MCP_ICONS.has(toolDisplay.mcpSource)}
        <div class="w-4 shrink-0 flex items-center justify-center {toolState === 'running' ? 'animate-pulse' : ''}">
          <McpIcon iconName={toolDisplay.mcpSource} label={toolDisplay.mcpSource} size={14} />
        </div>
      {:else}
        <Fa icon={toolDisplay.icon} size="xs" class="w-4 text-ghost shrink-0 {toolState === 'running' ? 'animate-pulse' : ''}" />
      {/if}

      <!-- Clickable text area for expand/collapse -->
      <button
        class="flex items-center gap-[0.5ch] min-w-0 overflow-hidden bg-transparent border-0 p-0 {isExpandable
          ? 'cursor-pointer'
          : ''} text-left"
        style="flex: 0 0.01 auto;"
        onclick={() => {
          if (isExpandable) expanded = !expanded;
        }}
      >
        {#if isAgentMessage && parsedResult?.toAgentId}
          <!-- Agent message: show avatar + name + message preview -->
          <span class="text-subtle whitespace-nowrap shrink-0">Message</span>
          <AuggieAvatar agentId={parsedResult.toAgentId} size={16} class="shrink-0" />
          <span
            class="text-foreground font-medium whitespace-nowrap shrink-0 max-w-[120px] truncate"
          >
            {targetAgentName}
          </span>
          {#if parsedResult.messageContent}
            <span class="text-subtle whitespace-nowrap truncate min-w-0">
              "{parsedResult.messageContent.slice(0, 30)}{parsedResult.messageContent.length > 30
                ? '...'
                : ''}"
            </span>
          {/if}
        {:else}
          <!-- Standard tool display -->
          <!-- Verb (never truncates) -->
          <span class="text-subtle whitespace-nowrap shrink-0">
            {toolDisplay.verb}
          </span>

          <!-- Subject (truncates) - separate from button if it's a note link or file link -->
          {#if toolDisplay.subject && !toolDisplay.noteId && !toolDisplay.filePath}
            <span class="text-subtle whitespace-nowrap truncate min-w-0">
              {toolDisplay.subject}
            </span>
          {/if}
        {/if}
      </button>

      <!-- Note link - separate from button so it can be clickable independently -->
      {#if toolDisplay.subject && toolDisplay.noteId}
        <a
          href={noteUrl(toolDisplay.noteId)}
          class="text-muted-foreground whitespace-nowrap truncate min-w-0 hover:text-foreground hover:underline"
          style="flex: 0 0.01 auto;"
          onclick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const openInAdjacentPanel = e.metaKey || e.ctrlKey;
            if (openInAdjacentPanel) {
              const sourcePanelId = getPanelIdFromEvent(e);
              if (workspaceId && toolDisplay.noteId) {
                appStore.dispatch(
                  openWorkspaceNote(workspaceId, toolDisplay.noteId, {
                    openInAdjacentPanel,
                    sourcePanelId,
                  }),
                );
              }
            } else {
              await handleIntentLink(noteUrl(toolDisplay.noteId!));
            }
          }}
        >
          {toolDisplay.subject}
        </a>
      {/if}

      <!-- File link - separate from button so it can be clickable independently -->
      <!-- Directories are shown as non-clickable text (no viewer for folders) -->
      {#if toolDisplay.subject && toolDisplay.filePath && !toolDisplay.noteId}
        {#if toolDisplay.isDirectory}
          <span class="flex items-baseline gap-[0.5ch] shrink min-w-0 overflow-hidden text-left">
            <span class="text-subtle truncate" style="flex: 0 0.01 auto;">
              {toolDisplay.subject}
            </span>
            {#if toolDisplay.path}
              <span class="flex-1 text-subtle truncate min-w-0 text-sm -mb-px pl-1">
                {toolDisplay.path}
              </span>
            {/if}
          </span>
        {:else}
          <button
            type="button"
            class="group/button flex items-baseline gap-[0.5ch] shrink min-w-0 overflow-hidden bg-transparent border-0 p-0 cursor-pointer hover:text-foreground text-left"
            onclick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const openInAdjacentPanel = e.metaKey || e.ctrlKey;
              const sourcePanelId = getPanelIdFromEvent(e);
              if (workspaceId && toolDisplay.filePath) {
                appStore.dispatch(
                  openWorkspaceFile(workspaceId, toolDisplay.filePath, {
                    line: toolDisplay.fileLine ?? undefined,
                    openInAdjacentPanel,
                    sourcePanelId,
                  }),
                );
              }
            }}
          >
            <span
              class="text-subtle truncate group-hover/button:underline" style="flex: 0 0.01 auto;"
            >
              {toolDisplay.subject}
            </span>
            {#if toolDisplay.path}
              <span class="flex-1 text-subtle truncate min-w-0 text-sm -mb-px pl-1">
                {toolDisplay.path}
              </span>
            {/if}
          </button>
        {/if}
      {/if}

      <!-- Path (muted, truncated, takes remaining space) - only when NOT a file link -->
      {#if toolDisplay.path && !toolDisplay.filePath}
        <span class="flex-1 text-subtle truncate min-w-0 text-sm -mb-px pl-1">
          {toolDisplay.path}
        </span>
      {/if}

      <!-- Status indicator and chevron -->
      <div class="ml-auto flex items-center gap-2 shrink-0">
        {#if toolState === 'running'}
          <!-- No spinner — the animate-pulse on the icon indicates running state -->
        {:else if toolState === 'completed' && expanded}
          <Fa icon={faCheckCircle} size="xs" class="text-emerald-500 opacity-60" />
        {:else if toolState === 'error'}
          <Fa icon={faExclamationTriangle} size="xs" class="text-red-500" />
        {/if}


      </div>
    </div>

  </div>

  <!-- Inline image preview for Figma screenshots (always visible, not just when expanded) -->
  {#if !expanded && parsedResult?.type === 'figma' && parsedResult.figmaScreenshot && toolState === 'completed'}
    <button
      type="button"
      class="block w-full px-2 pb-1 cursor-pointer bg-transparent border-0 p-0 text-left"
      onclick={() => { if (isExpandable) expanded = !expanded; }}
    >
      <div class="overflow-hidden rounded border border-border/40">
        <img
          src={`data:${parsedResult.figmaScreenshotMimeType || 'image/png'};base64,${parsedResult.figmaScreenshot}`}
          alt="Figma design"
          class="w-full h-auto object-contain bg-white"
          style="max-height: 200px; max-width: 400px"
        />
      </div>
    </button>
  {/if}

  {#if expanded}
    <div class="ml-1" transition:expand>
      <ToolDetails input={toolUse.input} {result} {parsedResult} isError={toolState === 'error'} {workspaceId} />
    </div>
  {/if}
{/if}

<style>
  /* PERF: Tool call container uses CSS containment for rendering isolation */
  .tool-call-container {
    contain: layout style;
  }
</style>

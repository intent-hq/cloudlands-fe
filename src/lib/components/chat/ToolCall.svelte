<script lang="ts">
  import type { ToolUseBlock } from '$shared/types';
  import Fa from 'svelte-fa';
  import { safeSlide } from '$lib/utils/animations';
  import ToolDetails from './ToolDetails.svelte';
  import { parseToolResult } from './tool-result-parser';
  import { classifyTool, isContextEngineTool } from './tool-classifier';
  import ContextEngineToolCall from './ContextEngineToolCall.svelte';
  import { noteUrl } from '$shared/constants/intent-links';
  import { handleIntentLink } from '$lib/utils/workspaces-link-handler';
  import { getPanelIdFromEvent } from '$lib/components/layout/panel-system/panel-context';
  import McpIcon from '$lib/components/settings/mcp/McpIcon.svelte';
  import { openWorkspaceFile } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import {
    COMPACT_TOOL_ICON_BOX_CLASS,
    COMPACT_TOOL_ROW_CLASS,
    COMPACT_TOOL_SENTENCE_CLASS,
    COMPACT_TOOL_TRAILING_CLASS,
    OPERATIONAL_ROW_CONTAINER_CLASS,
  } from './operational-disclosure-row';
  import { buildToolDisplayModel } from './tool-display-model';

  /** MCP sources that have brand icons in McpIcon */
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
    toolState?: 'running' | 'completed' | 'error';
    result?: any;
    workspaceId?: string;
  }

  let { toolUse, toolState = 'completed', result = null, workspaceId }: Props = $props();

  // Check if this is a context engine tool (special Augment branding)
  const isContextEngine = $derived(isContextEngineTool(toolUse.name));

  // PERF: Parse result for rich preview - memoized with $derived
  const parsedResult = $derived(
    result ? parseToolResult(toolUse.name, toolUse.input || {}, result) : null,
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
          verb: m.chat_toolCall_mark_label(),
          subject: `${parsedResult.taskTitle} ${parsedResult.taskStatus}`,
        };
      } else if (parsedResult.taskStatus) {
        // We have status but no title - show generic message
        return {
          ...baseToolDisplay,
          verb: m.chat_toolCall_markTask_label(),
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

  const displayModel = $derived(
    buildToolDisplayModel({
      toolName: toolUse.name,
      display: toolDisplay,
      input: toolUse.input || {},
      result,
      parsedResult,
      toolState,
    }),
  );

  let expanded = $state(false);
  const isExpandable = $derived(displayModel.hasDetails);
  const detailsId = $derived(`tool-details-${toolUse.id}`);

  function toggleExpanded() {
    if (isExpandable) expanded = !expanded;
  }

  function handleDisclosureKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleExpanded();
  }

  // Transition function for expand/collapse animation
  function expand(node: Element) {
    return safeSlide(node, { duration: 150 });
  }
</script>

<!-- Special rendering for Augment Context Engine tools -->
{#if isContextEngine}
  <ContextEngineToolCall {toolUse} {toolState} {result} />
{:else if !toolDisplay.hidden}
  <div
    class={OPERATIONAL_ROW_CONTAINER_CLASS}
    data-tool-use-id={toolUse.id}
    data-tool-call-id={toolUse.toolCallId || undefined}
    data-conversation-layer="tool-activity"
  >
    <!-- Running state: animate-pulse on the icon indicates running state -->
    <div class={COMPACT_TOOL_ROW_CLASS} data-operational-disclosure-row data-compact-tool-row>
      <!-- Category icon: show MCP brand logo for known MCPs, otherwise generic FA icon -->
      {#if toolDisplay.mcpSource && BRANDED_MCP_ICONS.has(toolDisplay.mcpSource)}
        <div
          class="{COMPACT_TOOL_ICON_BOX_CLASS} {toolState === 'running' ? 'animate-pulse' : ''}"
          data-tool-icon
        >
          <McpIcon iconName={toolDisplay.mcpSource} label={toolDisplay.mcpSource} size={15} />
        </div>
      {:else}
        <div
          class="{COMPACT_TOOL_ICON_BOX_CLASS} {toolState === 'running' ? 'animate-pulse' : ''}"
          data-tool-icon
        >
          <Fa icon={toolDisplay.icon} size={14} class="h-3.5! w-3.5!" />
        </div>
      {/if}

      {#if isExpandable}
        <button
          type="button"
          class="{COMPACT_TOOL_SENTENCE_CLASS} cursor-pointer"
          data-testid="tool-call-summary"
          data-tool-sentence
          aria-label={displayModel.accessibleSentence}
          aria-expanded={expanded}
          aria-controls={detailsId}
          title={m.chat_toolCall_technicalDetails_label()}
          onclick={toggleExpanded}
          onkeydown={handleDisclosureKeydown}>{displayModel.sentence}</button
        >
      {:else}
        <span
          class={COMPACT_TOOL_SENTENCE_CLASS}
          data-testid="tool-call-summary"
          data-tool-sentence
          aria-label={displayModel.accessibleSentence}
          title={displayModel.accessibleSentence}>{displayModel.sentence}</span
        >
      {/if}

      {#if displayModel.status === 'success'}
        <span
          class="{COMPACT_TOOL_TRAILING_CLASS} text-success"
          data-testid="tool-call-status"
          data-tool-status="success">{m.chat_toolCall_success_label()}</span
        >
      {:else if displayModel.status === 'error'}
        <span
          class="{COMPACT_TOOL_TRAILING_CLASS} text-destructive"
          data-testid="tool-call-status"
          data-tool-status="error">{m.chat_toolCall_failed_label()}</span
        >
      {:else if toolDisplay.noteId}
        <a
          href={noteUrl(toolDisplay.noteId)}
          data-testid="tool-call-note-link"
          class="{COMPACT_TOOL_TRAILING_CLASS} hover:underline"
          aria-label={displayModel.accessibleSentence}
          onclick={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const openInAdjacentPanel = e.metaKey || e.ctrlKey;
            await handleIntentLink(noteUrl(toolDisplay.noteId!), {
              workspaceId,
              sourcePanelId: getPanelIdFromEvent(e),
              openInAdjacentPanel,
            });
          }}
        >
          {m.chat_toolClassifier_open_label()}
        </a>
      {:else if toolDisplay.filePath && !toolDisplay.isDirectory}
        <button
          type="button"
          data-testid="tool-call-file-link"
          class="{COMPACT_TOOL_TRAILING_CLASS} cursor-pointer border-0 bg-transparent p-0 hover:underline"
          aria-label={displayModel.accessibleSentence}
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
          {m.chat_toolClassifier_open_label()}
        </button>
      {/if}
    </div>
  </div>

  <!-- Inline image preview for Figma screenshots (always visible, not just when expanded) -->
  {#if !expanded && parsedResult?.type === 'figma' && parsedResult.figmaScreenshot && toolState === 'completed'}
    <button
      type="button"
      class="block w-full px-2 pb-1 cursor-pointer bg-transparent border-0 p-0 text-left"
      onclick={() => {
        if (isExpandable) expanded = !expanded;
      }}
    >
      <div class="overflow-hidden rounded border border-border/40">
        <img
          src={`data:${parsedResult.figmaScreenshotMimeType || 'image/png'};base64,${parsedResult.figmaScreenshot}`}
          alt={m.chat_toolCall_figmaDesign_alt()}
          class="w-full h-auto object-contain bg-white"
          style="max-height: 200px; max-width: 400px"
        />
      </div>
    </button>
  {/if}

  {#if expanded}
    <div id={detailsId} class="ml-1" transition:expand>
      <ToolDetails
        input={toolUse.input}
        {result}
        {parsedResult}
        isError={toolState === 'error'}
        {workspaceId}
        suppressOkOnlyResult={displayModel.isOkOnlyWorkspaceResult}
      />
    </div>
  {/if}
{/if}

<style>
  /* PERF: Tool call container uses CSS containment for rendering isolation */
  .tool-call-container {
    contain: layout style;
  }
</style>

<script lang="ts">
  import type { ToolUseBlock } from '$shared/types';
  import Fa from 'svelte-fa';
  import { faEye, faHand } from '$lib/icons/phosphor-icons';
  import ToolDetails from './ToolDetails.svelte';
  import { parseToolResult } from './tool-result-parser';
  import { classifyTool, isContextEngineTool } from './tool-classifier';
  import ContextEngineToolCall from './ContextEngineToolCall.svelte';
  import { noteUrl } from '$shared/constants/intent-links';
  import { handleIntentLink } from '$lib/utils/workspaces-link-handler';
  import { getPanelIdFromEvent } from '$lib/components/layout/panel-system/panel-context';
  import { openWorkspaceFile } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    COMPACT_TOOL_TRAILING_CLASS,
    OPERATIONAL_INLINE_DETAILS_CLASS,
  } from './operational-disclosure-row';
  import { buildToolDisplayModel } from './tool-display-model';
  import ToolStatusIcon from './ToolStatusIcon.svelte';
  import ChatOperationalRow from './ChatOperationalRow.svelte';
  import { resolveToolLeadingIcon } from './tool-leading-icon';

  interface Props {
    toolUse: ToolUseBlock;
    toolState?: 'running' | 'completed' | 'error';
    result?: any;
    workspaceId?: string;
    adjacentOperationalRow?: boolean;
  }

  let {
    toolUse,
    toolState = 'completed',
    result = null,
    workspaceId,
    adjacentOperationalRow = false,
  }: Props = $props();

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
  const leadingIcon = $derived.by(() => {
    const action = toolUse.input?.action ?? toolUse.input?.method;
    const actions = Array.isArray(toolUse.input?.actions)
      ? toolUse.input.actions
          .map((item) =>
            typeof item === 'object' && item ? (item as { action?: unknown }).action : null,
          )
          .filter((item): item is string => typeof item === 'string')
      : undefined;
    const kind = resolveToolLeadingIcon({
      toolName: toolUse.name,
      category: toolDisplay.category,
      action: actions?.length ? actions : typeof action === 'string' ? action : undefined,
      toolKind: toolUse.metadata?.toolKind,
    });
    return kind === 'eye' ? faEye : faHand;
  });

  // Check if tool event is truly empty: completed successfully with no meaningful
  // content (whitespace-only, empty array/object, null/undefined) and no input params
  const isEmptyEvent = $derived.by(() => {
    if (toolState === 'error' || toolState === 'running') return false;
    if (toolDisplay.hidden) return false; // Already handled by hidden flag
    if (displayModel.isOkOnlyWorkspaceResult) return false; // ok-only mutations are intentionally content-free

    // Check if result is empty
    const resultIsEmpty =
      result === null ||
      result === undefined ||
      (typeof result === 'string' && result.trim() === '') ||
      (Array.isArray(result) && result.length === 0) ||
      (typeof result === 'object' && !Array.isArray(result) && Object.keys(result).length === 0);

    // Check if input has any non-internal params
    const inputIsEmpty = !Object.keys(toolUse.input || {}).some((key) => !key.startsWith('_'));

    return resultIsEmpty && inputIsEmpty && !displayModel.sentence;
  });

  // Should render: not hidden, not empty
  const shouldRender = $derived(!toolDisplay.hidden && !isEmptyEvent);

  let expanded = $state(false);
  const isExpandable = $derived(displayModel.hasDetails);
  const hasTrailing = $derived(
    displayModel.status === 'success' ||
      displayModel.status === 'error' ||
      Boolean(toolDisplay.noteId),
  );
  const detailsId = $derived(`tool-details-${toolUse.id}`);

  function toggleExpanded() {
    if (isExpandable) expanded = !expanded;
  }

  function handleDisclosureKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleExpanded();
  }

  function openFile(event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!workspaceId || !toolDisplay.filePath) return;
    appStore.dispatch(
      openWorkspaceFile(workspaceId, toolDisplay.filePath, {
        line: toolDisplay.fileLine ?? undefined,
        openInAdjacentPanel: event.metaKey || event.ctrlKey,
        sourcePanelId: getPanelIdFromEvent(event),
      }),
    );
  }
</script>

{#snippet leading()}
  <Fa icon={leadingIcon} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
{/snippet}

{#snippet summary()}
  {#each displayModel.sentenceSegments as segment}
    {#if segment.kind === 'file'}
      {#if workspaceId && isExpandable}
        <span
          role="button"
          tabindex="0"
          data-testid="tool-call-file-link"
          class="min-w-0 cursor-pointer truncate whitespace-pre font-normal underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
          data-tool-secondary
          aria-label={displayModel.accessibleSentence}
          onclick={(event) => {
            event.stopPropagation();
            openFile(event);
          }}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              openFile(event);
            }
          }}>{segment.text}</span
        >
      {:else if workspaceId}
        <button
          type="button"
          data-testid="tool-call-file-link"
          class="min-w-0 truncate whitespace-pre border-0 bg-transparent p-0 text-left font-normal underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
          data-tool-secondary
          aria-label={displayModel.accessibleSentence}
          onclick={openFile}>{segment.text}</button
        >
      {:else}
        <span
          data-testid="tool-call-file-name"
          class="min-w-0 truncate whitespace-pre font-normal"
          data-tool-secondary>{segment.text}</span
        >
      {/if}
    {:else}
      <span
        class="shrink-0 whitespace-pre font-normal"
        data-tool-primary={segment.kind === 'primary' ? '' : undefined}
        data-tool-secondary={segment.kind === 'secondary' ? '' : undefined}>{segment.text}</span
      >
    {/if}
  {/each}
{/snippet}

{#snippet trailing()}
  {#if displayModel.status === 'success'}
    <ToolStatusIcon status="completed" />
  {:else if displayModel.status === 'error'}
    <ToolStatusIcon status="error" />
  {:else if toolDisplay.noteId}
    <a
      href={noteUrl(toolDisplay.noteId)}
      data-testid="tool-call-note-link"
      class="{COMPACT_TOOL_TRAILING_CLASS} hover:underline"
      aria-label={displayModel.accessibleSentence}
      onclick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const openInAdjacentPanel = event.metaKey || event.ctrlKey;
        await handleIntentLink(noteUrl(toolDisplay.noteId!), {
          workspaceId,
          sourcePanelId: getPanelIdFromEvent(event),
          openInAdjacentPanel,
        });
      }}
    >
      {m.chat_toolClassifier_open_label()}
    </a>
  {/if}
{/snippet}

{#snippet details()}
  <ToolDetails
    input={toolUse.input}
    {result}
    {parsedResult}
    isError={toolState === 'error'}
    {workspaceId}
    suppressOkOnlyResult={displayModel.isOkOnlyWorkspaceResult}
  />
{/snippet}

<!-- Special rendering for Augment Context Engine tools -->
{#if isContextEngine}
  <ContextEngineToolCall {toolUse} {toolState} {result} {adjacentOperationalRow} />
{:else if shouldRender}
  <ChatOperationalRow
    {leading}
    {summary}
    trailing={hasTrailing ? trailing : undefined}
    showChevron={false}
    details={expanded ? details : undefined}
    interactive={isExpandable}
    {expanded}
    controls={detailsId}
    ariaLabel={displayModel.accessibleSentence}
    title={isExpandable
      ? m.chat_toolCall_technicalDetails_label()
      : displayModel.accessibleSentence}
    summaryTitle={displayModel.accessibleSentence}
    onclick={toggleExpanded}
    onkeydown={handleDisclosureKeydown}
    {detailsId}
    detailsClass={OPERATIONAL_INLINE_DETAILS_CLASS}
    {adjacentOperationalRow}
    streaming={toolState === 'running'}
    toolIcon
    disclosureTestId="tool-call-disclosure"
    summaryTestId="tool-call-summary"
    toolUseId={toolUse.id}
    toolCallId={toolUse.toolCallId || undefined}
    conversationLayer="tool-activity"
  />

  <!-- Inline image preview for Figma screenshots (always visible, not just when expanded) -->
  {#if !expanded && parsedResult?.type === 'figma' && parsedResult.figmaScreenshot && toolState === 'completed'}
    <button
      type="button"
      class="block w-full px-2 pb-1 cursor-pointer bg-transparent border-0 p-0 text-left"
      onclick={() => {
        if (isExpandable) expanded = !expanded;
      }}
    >
      <div class="overflow-hidden rounded border border-border">
        <img
          src={`data:${parsedResult.figmaScreenshotMimeType || 'image/png'};base64,${parsedResult.figmaScreenshot}`}
          alt={m.chat_toolCall_figmaDesign_alt()}
          class="w-full h-auto object-contain bg-white"
          style="max-height: 200px; max-width: 400px"
        />
      </div>
    </button>
  {/if}
{/if}

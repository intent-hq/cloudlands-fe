<script lang="ts">
  import type { ContentBlock, ToolUseBlock, MessageRole } from '$shared/types';
  import { dedupeAgentVideoContentBlocks, normalizeAgentVideoContentBlocks } from '$shared/types';
  import {
    classifyToolResults,
    findToolResult,
    getStandaloneToolResultPresentation,
    getToolResultPayload,
    getToolResultText,
    isStandaloneToolResult,
  } from './tool-result-pairing';
  import { isHydrationPending, mergeHydratedContent } from './block-hydration';
  import { messageBlockHydrationRequested } from '$store/renderer/slices/chat-state/chat-state-slice';
  import { selectHydratedBlocks } from '$store/renderer/slices/chat-state/chat-state-selectors';
  import { getProposalFromBlock } from '$shared/types/proposal-resource';
  import { isQuestionResourceBlock } from '$shared/types/question-resource';
  import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
  import { getContentBlockText } from '$shared/utils/content-block-helpers';
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import ToolCall from './ToolCall.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import ReasoningHistoryBlock from './ReasoningHistoryBlock.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import AugmentCodeSnippet from '$lib/components/editor/AugmentCodeSnippet.svelte';
  import ChatDiffViewer from './ChatDiffViewer.svelte';
  import { PatchBlockContent } from '$features/file-tracking/components/diff';
  import DigestCard from './DigestCard.svelte';
  import DetectedScriptsCard from './DetectedScriptsCard.svelte';
  import ChatWorkspaceCard from './ChatWorkspaceCard.svelte';
  import ChatImageBlock from './ChatImageBlock.svelte';
  import ChatVideoBlock from './ChatVideoBlock.svelte';
  import ChatReferenceBlock from './ChatReferenceBlock.svelte';
  import DiagramRenderer from '$lib/components/diagrams/DiagramRenderer.svelte';
  import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';
  import ChatCliBlock from './ChatCliBlock.svelte';
  import ChatAgentActionBlock from './ChatAgentActionBlock.svelte';
  import InlineProposal from './proposals/InlineProposal.svelte';
  import {
    parseAgentMessage,
    parseSuggestedPrompts,
    parseSuggestedPromptsFromContentBlocks,
    groupParsedBlocks,
    groupContentBlocks,
    filterWorkspaceCardsCoveredByIds,
    type ParsedContent,
    type RenderBlock,
    type ContentBlockGroup,
    type RenderContentBlock,
  } from '$lib/utils/messageParser';
  import ResponseGroup from './ResponseGroup.svelte';
  import {
    getOperationalClusterSpacingClass,
    isAdjacentOperationalClusterRow,
    isOperationalClusterBlock,
    NESTED_REASONING_SECTION_SEAM_CLASS,
    OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS,
    OPERATIONAL_GROUP_CHILD_CONTENT_CLASS,
    OPERATIONAL_GROUP_CHILD_ROW_CLASS,
  } from './operational-disclosure-row';
  import {
    dedupeKeys,
    getResponseGroupBlockKeys,
    isNestedReasoningSectionBoundary,
    isNestedReasoningSectionStart,
    normalizeResponseGroups,
    shouldRenderResponseGroupInline,
  } from './response-group-blocks';
  import { chatSearchBlockPath } from './chat-search';
  import NavLink from './NavLink.svelte';

  import { createLogger } from '$lib/utils/client-logger';
  import { fly } from 'svelte/transition';
  import { m } from '$shared/paraglide/messages.js';

  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('MessageContent');

  interface Props {
    content: ContentBlock[];
    isStreaming?: boolean;
    workspaceId?: string;
    role?: MessageRole;
    /** Agent session id; with `messageId`, enables lazy block hydration (§5.5). */
    agentId?: string;
    /** Persisted message id owning `content` (hydration fetch/merge key). */
    messageId?: string;
    /** True when this message is the conversation's final assistant message. */
    isLastConversationMessage?: boolean;
  }

  let {
    content,
    isStreaming = false,
    workspaceId,
    role = 'assistant',
    agentId,
    messageId,
    isLastConversationMessage = false,
  }: Props = $props();

  // Lazy full-block hydration (§5.5 slim projection → v7.2
  // agent.getMessageBlock): substitute cached full blocks for slim-truncated
  // ones before any downstream derivation. Init-time subscription (agentId is
  // stable per component instance); under-budget content passes through with
  // referential identity intact.
  // svelte-ignore state_referenced_locally -- intentional initial snapshot; keyed component identity is fixed.
  const hydratedBlocks$ = selectHydratedBlocks(agentId ?? '');
  const hydratedContent = $derived(
    mergeHydratedContent(content || [], messageId, $hydratedBlocks$),
  );

  function hydrateImageBlock(blockId: string | undefined) {
    if (!agentId || !messageId || !blockId) return;
    appStore.dispatch(messageBlockHydrationRequested(agentId, messageId, blockId));
  }

  function imageHydrationLoading(blockId: string | undefined): boolean {
    return blockId ? isHydrationPending($hydratedBlocks$, messageId, [blockId]) : false;
  }

  // Filter out empty text blocks and deduplicate tool_use blocks by ID.
  // Deduplication: when a skeleton tool_use (vague label) and its follow-up
  // (descriptive label) both exist with the same ID, keep only the last one.
  // Also strip suggested prompts before checking - they're rendered separately in ChatPanel
  const blocks = $derived.by(() => {
    // Collapse duplicate §7.1 resource blocks (daemon-attached canonical +
    // FE-lifted fallback for the same logical resource) so exactly one card
    // renders per resource, preferring the daemon-canonical variant.
    const parsedPromptBlocks = parseSuggestedPromptsFromContentBlocks(hydratedContent, {
      isStreaming,
    });
    const filtered = dedupeAgentVideoContentBlocks(
      normalizeAgentVideoContentBlocks(
        dedupeResourceBlocks(parsedPromptBlocks.contentBlocks),
        role,
        workspaceId,
      ),
    ).filter((block) => {
      // Agent Q&A questions are wizard-only: they never render in the
      // transcript (pending or resolved), so strip them here.
      if (isQuestionResourceBlock(block)) {
        return false;
      }
      if (block.type === 'text') {
        const text = block.text || '';
        const { cleanedContent } = parseSuggestedPrompts(text);
        return cleanedContent.trim().length > 0;
      }
      return true;
    });

    // Deduplicate tool_use blocks: if multiple blocks share the same ID,
    // keep only the last occurrence (which has the real input parameters).
    const toolUseLastIndex = new Map<string, number>();
    for (let i = 0; i < filtered.length; i++) {
      const block = filtered[i];
      if (block.type === 'tool_use' && block.id) {
        toolUseLastIndex.set(block.id, i);
      }
    }

    // Only filter if there are actual duplicates
    if (toolUseLastIndex.size === 0) return filtered;

    return filtered.filter((block, index) => {
      if (block.type === 'tool_use' && block.id) {
        // Keep only the last occurrence of each tool_use ID
        return toolUseLastIndex.get(block.id) === index;
      }
      return true;
    });
  });

  // Group content blocks by <group:Name> tags at the ContentBlock level.
  const groupedBlocks = $derived(
    normalizeResponseGroups(groupContentBlocks(blocks, isStreaming), isStreaming),
  );

  function isVisibleGroupChild(block: RenderContentBlock): boolean {
    return (
      block.type !== 'tool_result' ||
      isStandaloneToolResult(toolResultClassification, block as ContentBlock)
    );
  }

  const toolResultClassification = $derived.by(() => classifyToolResults(groupedBlocks));
  const toolResultsMap = $derived(toolResultClassification.resultsMap);

  // Compute tool states based on results
  const toolStates = $derived.by(() => {
    const states = new Map<string, 'running' | 'completed' | 'error'>();
    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseBlock;
        const result = findToolResult(toolResultsMap, toolBlock);
        if (result) {
          // Check both snake_case and camelCase for error flag
          const isError = result.is_error || result.isError;
          // Also detect errors from the result payload text (§7.1 `output`,
          // legacy `content` fallback; e.g., "Error:" prefix or "Tool Error:")
          // Note: We no longer check for ❌ emoji as it may be used as a visual indicator in content
          const contentText = getToolResultText(result);
          const hasErrorInContent =
            // i18n-ignore (wire-content sniffing of tool result payloads, not rendered)
            contentText.startsWith('Error:') || contentText.includes('Tool Error:');
          states.set(toolBlock.id, isError || hasErrorInContent ? 'error' : 'completed');
        } else if (!isStreaming) {
          // Not streaming and no result - mark as completed
          states.set(toolBlock.id, 'completed');
        } else {
          // Still streaming
          states.set(toolBlock.id, 'running');
        }
      }
    }
    return states;
  });

  // Collect from the source content so a bulk-op proposal's covered workspace
  // cards stay suppressed and do not duplicate the inline proposal's list.
  const bulkProposalWorkspaceIds = $derived.by(() =>
    collectBulkProposalWorkspaceIds(hydratedContent),
  );

  // Pre-compute parsed content for all text blocks - memoized via $derived
  // This avoids calling parseAgentMessage in the template loop on every render
  // Keys are "blockIndex" for top-level text blocks and "blockIndex-childIndex" for children inside groups
  const parsedContentMap = $derived.by(() => {
    if (isStreaming) return new Map<string, RenderBlock[]>();

    const map = new Map<string, RenderBlock[]>();
    groupedBlocks.forEach((block, index) => {
      if (block.type === 'text') {
        const contentBlock = block as ContentBlock;
        if (contentBlock.text) {
          const { cleanedContent } = parseSuggestedPrompts(contentBlock.text);
          const parsed = parseAgentMessage(cleanedContent, workspaceId);
          map.set(
            String(index),
            filterWorkspaceCardsCoveredByIds(groupParsedBlocks(parsed), bulkProposalWorkspaceIds),
          );
        }
      } else if (block.type === 'content_group') {
        const group = block as ContentBlockGroup;
        group.children.forEach((child, childIndex) => {
          if (child.type === 'text' && child.text) {
            const { cleanedContent } = parseSuggestedPrompts(child.text);
            const parsed = parseAgentMessage(cleanedContent, workspaceId);
            map.set(
              `${index}-${childIndex}`,
              filterWorkspaceCardsCoveredByIds(groupParsedBlocks(parsed), bulkProposalWorkspaceIds),
            );
          }
        });
      }
    });
    return map;
  });

  // Handle file opening
  function handleOpenFile(detail: {
    path: string;
    line?: number;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
  }) {
    logger.info('Opening file from message content', detail);
    if (!workspaceId) return;
    appStore.dispatch(
      openWorkspaceFile(workspaceId, detail.path, {
        line: detail.line,
        openInAdjacentPanel: detail.openInAdjacentPanel ?? false,
        sourcePanelId: detail.sourcePanelId,
      }),
    );
  }

  // Handle diagram binding clicks (file, note, etc.)
  function handleDiagramBindingClick(e: MouseEvent, binding: { type: string; target: string }) {
    logger.info('Diagram binding clicked', binding);
    const openInAdjacentPanel = e.metaKey || e.ctrlKey;
    const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    if (binding.type === 'file') {
      handleOpenFile({ path: binding.target, openInAdjacentPanel, sourcePanelId });
    } else if (binding.type === 'note') {
      if (!workspaceId) return;
      appStore.dispatch(
        openWorkspaceNote(workspaceId, binding.target, { openInAdjacentPanel, sourcePanelId }),
      );
    }
  }

  type NavLinkBlock = ContentBlock & {
    kind?: 'nav-link';
    target: string;
    label?: string;
  };

  function isNavLinkBlock(block: ContentBlock): block is NavLinkBlock {
    const candidate = block as NavLinkBlock;
    return (
      (candidate.kind === 'nav-link' || candidate.type === 'nav-link') &&
      typeof candidate.target === 'string'
    );
  }

  function addBulkProposalWorkspaceIds(block: ContentBlock, ids: Set<string>) {
    const proposal = getProposalFromBlock(block);
    if (proposal?.kind !== 'bulk-op') return;
    if (
      proposal.payload.operation !== 'workspace.bulkArchive' &&
      proposal.payload.operation !== 'workspace.bulkDelete'
    ) {
      return;
    }

    proposal.payload.ids.forEach((id: string) => ids.add(id));
  }

  function collectBulkProposalWorkspaceIds(blocks: RenderContentBlock[]): Set<string> {
    const ids = new Set<string>();
    blocks.forEach((block) => {
      if (block.type === 'content_group') {
        (block as ContentBlockGroup).children.forEach((child) =>
          addBulkProposalWorkspaceIds(child, ids),
        );
      } else {
        addBulkProposalWorkspaceIds(block as ContentBlock, ids);
      }
    });
    return ids;
  }

  /**
   * Generate a stable unique key for a render content block.
   * Handles both regular ContentBlocks and ContentBlockGroups.
   */
  function getBlockKey(block: RenderContentBlock, index: number): string {
    if (block.type === 'content_group') {
      const group = block as ContentBlockGroup;
      return `group-${index}-${group.sourceName ?? group.name}`;
    }
    const contentBlock = block as ContentBlock;
    if (isNavLinkBlock(contentBlock)) return `nav-link-${index}-${contentBlock.target}`;
    if (contentBlock.id) return contentBlock.id;
    if (contentBlock.type === 'text') {
      const text = contentBlock.text || '';
      const hash = text
        .slice(0, 50)
        .split('')
        .reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0);
      return `text-${index}-${hash}`;
    }
    if (contentBlock.type === 'tool_result' && contentBlock.tool_use_id) {
      return `result-${contentBlock.tool_use_id}`;
    }
    return `${contentBlock.type}-${index}`;
  }

  // Pre-compute block keys for stable iteration, ensuring uniqueness
  const blockKeys = $derived(
    dedupeKeys(groupedBlocks.map((block, index) => getBlockKey(block, index))),
  );

  function isVisibleTopLevelBlock(block: RenderContentBlock): boolean {
    if (block.type === 'content_group') return true;
    const contentBlock = block as ContentBlock;
    if (isNavLinkBlock(contentBlock)) {
      return true;
    }
    if (contentBlock.type === 'text') {
      const text = contentBlock.text || (contentBlock as any).content || '';
      return parseSuggestedPrompts(text).cleanedContent.trim().length > 0;
    }
    if (contentBlock.type === 'image') {
      return Boolean((contentBlock.data || contentBlock.dataTruncated) && contentBlock.mimeType);
    }
    if (contentBlock.type === 'video') return Boolean(contentBlock.source);
    if (getProposalFromBlock(contentBlock)) return true;
    if (contentBlock.type === 'tool_result') {
      return isStandaloneToolResult(toolResultClassification, contentBlock);
    }
    return contentBlock.type === 'tool_use' || contentBlock.type === 'thinking';
  }

  const lastVisibleTopLevelBlockIndex = $derived.by(() => {
    for (let i = groupedBlocks.length - 1; i >= 0; i--) {
      if (isVisibleTopLevelBlock(groupedBlocks[i])) return i;
    }
    return -1;
  });
</script>

{#snippet renderParsedContentBlock(parsedBlock: ParsedContent, insetProse = false)}
  {#if insetProse}
    <div class={OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}>
      {@render renderParsedContentBlockBody(parsedBlock, insetProse)}
    </div>
  {:else}
    {@render renderParsedContentBlockBody(parsedBlock, insetProse)}
  {/if}
{/snippet}

{#snippet renderParsedContentBlockBody(parsedBlock: ParsedContent, insetProse: boolean)}
  {#if parsedBlock.type === 'augment_code_snippet'}
    <AugmentCodeSnippet
      code={parsedBlock.content}
      language={parsedBlock.metadata?.language}
      path={parsedBlock.metadata?.path}
      mode={parsedBlock.metadata?.mode}
      onOpenFile={handleOpenFile}
    />
  {:else if parsedBlock.type === 'diff'}
    <ChatDiffViewer diff={parsedBlock.content} filePath={parsedBlock.metadata?.path} />
  {:else if parsedBlock.type === 'commit_message'}
    <div class="commit-message-block p-3 my-2 rounded-md bg-background border border-border">
      <div class="type-caption mb-1.5 font-medium text-subtle">
        {m.chat_messageContent_generatedCommitMessage_label()}
      </div>
      <div class="type-code whitespace-pre-wrap text-foreground">
        {parsedBlock.content}
      </div>
    </div>
  {:else if parsedBlock.type === 'diagram' && parsedBlock.metadata?.diagramData}
    <div class="diagram-block my-2">
      <DiagramRenderer
        diagram={parsedBlock.metadata.diagramData as DiagramPrimitive}
        editable={false}
        onBindingClick={handleDiagramBindingClick}
      />
    </div>
  {:else if parsedBlock.type === 'patch' && parsedBlock.metadata?.patchData}
    {@const patchData = parsedBlock.metadata.patchData}
    <PatchBlockContent
      patches={[{ filePath: patchData.filePath, diff: patchData.diff }]}
      label={patchData.description || patchData.filePath}
    />
  {:else if parsedBlock.type === 'reference' && parsedBlock.metadata?.referenceData}
    <ChatReferenceBlock
      reference={parsedBlock.metadata.referenceData}
      onOpenFile={handleOpenFile}
    />
  {:else if parsedBlock.type === 'cli' && parsedBlock.metadata?.cliData}
    <ChatCliBlock command={parsedBlock.metadata.cliData.command} />
  {:else if parsedBlock.type === 'agent_action' && parsedBlock.metadata?.agentActionData}
    <ChatAgentActionBlock goal={parsedBlock.metadata.agentActionData.goal} />
  {:else if parsedBlock.type === 'detected_scripts' && parsedBlock.metadata?.detectedScriptsData}
    <DetectedScriptsCard scripts={parsedBlock.metadata.detectedScriptsData} />
  {:else if parsedBlock.type === 'workspace_card' && parsedBlock.metadata?.workspaceCardData}
    <ChatWorkspaceCard workspaceIds={parsedBlock.metadata.workspaceCardData.workspaceIds} />
  {:else if parsedBlock.type === 'nav_link' && parsedBlock.metadata?.navLinkData}
    <NavLink
      target={parsedBlock.metadata.navLinkData.target}
      label={parsedBlock.metadata.navLinkData.label}
      {workspaceId}
    />
  {:else if parsedBlock.type === 'video' && parsedBlock.metadata?.videoData}
    {@const video = parsedBlock.metadata.videoData}
    <ChatVideoBlock source={video.source} name={video.name} poster={video.poster} />
  {:else if parsedBlock.type === 'digest'}
    <DigestCard digest={parsedBlock.content || ''} />
  {:else if parsedBlock.type === 'mermaid'}
    <div class="mermaid-block my-2">
      <MermaidRenderer code={parsedBlock.content || ''} />
    </div>
  {:else if parsedBlock.type === 'code'}
    <CodeBlock
      code={parsedBlock.content || ''}
      language={parsedBlock.metadata?.language || 'plaintext'}
    />
  {:else}
    <div data-assistant-prose={insetProse ? 'static-markdown' : undefined}>
      <MarkdownViewer
        content={parsedBlock.content || ''}
        {isStreaming}
        {workspaceId}
        taskBlockRenderMode="content"
        chatImageThumbnails
        onFileClick={(path, options) => handleOpenFile({ path, ...options })}
      />
    </div>
  {/if}
{/snippet}

{#snippet renderContentBlock(
  block: ContentBlock,
  parsedKey: string,
  blockIndex: number,
  nested = false,
  adjacentOperationalRow = false,
  reasoningHistory = false,
  searchPath: string | undefined = undefined,
)}
  {@const proposal = getProposalFromBlock(block)}
  {#if proposal !== null}
    {#if proposal && agentId && workspaceId && messageId}
      <InlineProposal {agentId} {workspaceId} {messageId} {proposal} />
    {/if}
  {:else if isNavLinkBlock(block)}
    <div class="w-full" in:fly={{ y: 10, duration: 200 }}>
      <NavLink target={block.target} label={block.label} {workspaceId} />
    </div>
  {:else if block.type === 'text' && block.text}
    {@const parsedContent = parsedContentMap.get(parsedKey) || []}
    <div class="w-full" in:fly={{ y: 10, duration: 200 }}>
      {#if isStreaming}
        <!-- During streaming, use simple text display to avoid expensive markdown processing -->
        <div
          class="streaming-text whitespace-pre-wrap {nested
            ? ''
            : OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}"
          data-assistant-prose={nested ? undefined : 'static-streaming'}
        >
          {block.text}
        </div>
      {:else if parsedContent.length > 0}
        <!-- Render parsed content blocks -->
        {#each parsedContent as renderBlock, parsedBlockIndex (`${parsedKey}-parsed-${parsedBlockIndex}`)}
          {@render renderParsedContentBlock(renderBlock as ParsedContent, !nested)}
        {/each}
      {:else}
        <!-- Only render fallback if text has content after stripping suggested prompts -->
        {@const cleanedText = parseSuggestedPrompts(block.text).cleanedContent}
        {#if cleanedText.trim()}
          <div
            class={nested ? undefined : OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}
            data-assistant-prose={nested ? undefined : 'static-fallback'}
          >
            <MarkdownViewer
              content={cleanedText}
              {isStreaming}
              {workspaceId}
              taskBlockRenderMode="content"
              chatImageThumbnails
              onFileClick={(path, options) => handleOpenFile({ path, ...options })}
            />
          </div>
        {/if}
      {/if}
    </div>
  {:else if block.type === 'image' && (block.data || block.dataTruncated) && block.mimeType}
    <div class="w-full" in:fly={{ y: 10, duration: 200 }}>
      <ChatImageBlock
        data={block.data}
        mimeType={block.mimeType}
        dataTruncated={block.dataTruncated === true}
        dataIsThumbnail={block.dataIsThumbnail === true}
        hydrationLoading={imageHydrationLoading(block.id)}
        onHydrate={agentId && messageId && block.id ? () => hydrateImageBlock(block.id) : undefined}
      />
    </div>
  {:else if block.type === 'video' && block.source}
    <ChatVideoBlock
      source={block.source}
      name={block.fileName}
      poster={typeof block.metadata?.poster === 'string' ? block.metadata.poster : undefined}
    />
  {:else if block.type === 'tool_use'}
    {@const toolBlock = block as ToolUseBlock}
    {@const toolResult = findToolResult(toolResultsMap, toolBlock)}
    {@const toolState = toolStates.get(toolBlock.id) || 'completed'}
    {@const resultContent = getToolResultPayload(toolResult)}
    <div class="w-full" in:fly={{ y: 10, duration: 200 }}>
      <ToolCall
        toolUse={toolBlock}
        {toolState}
        result={resultContent}
        resultBlock={toolResult}
        {workspaceId}
        {adjacentOperationalRow}
        {agentId}
        {messageId}
      />
    </div>
  {:else if block.type === 'tool_result' && isStandaloneToolResult(toolResultClassification, block)}
    {@const resultPresentation = getStandaloneToolResultPresentation(block)}
    <div class="border border-border rounded-md" in:fly={{ y: 10, duration: 200 }}>
      <div class="px-3 py-2 bg-muted/50 border-b border-border">
        <span class="type-caption text-subtle">{m.chat_messageContent_toolResult_label()}</span>
      </div>
      <div class="p-3" data-tool-result-payload data-chat-search-block-path={searchPath}>
        {#if typeof resultPresentation.payload === 'string'}
          <CodeBlock code={resultPresentation.payload} />
        {:else if Array.isArray(resultPresentation.payload)}
          <!-- Recursively render nested content blocks -->
          {#each resultPresentation.payload as any[] as nestedBlock, nestedIndex (`nested-${blockIndex}-${nestedIndex}-${nestedBlock.id ?? nestedBlock.type}`)}
            {#if nestedBlock.type === 'text' && nestedBlock.text}
              <div class="w-full">
                <MarkdownViewer
                  content={nestedBlock.text}
                  {workspaceId}
                  taskBlockRenderMode="content"
                  chatImageThumbnails
                  onFileClick={(path, options) => handleOpenFile({ path, ...options })}
                />
              </div>
            {:else if nestedBlock.type === 'image' && nestedBlock.data && nestedBlock.mimeType}
              <ChatImageBlock
                data={nestedBlock.data}
                mimeType={nestedBlock.mimeType}
                alt={m.chat_messageContent_toolResultImage_alt()}
              />
            {:else if nestedBlock.type === 'video' && nestedBlock.source}
              <ChatVideoBlock
                source={nestedBlock.source}
                name={nestedBlock.fileName}
                poster={typeof nestedBlock.metadata?.poster === 'string'
                  ? nestedBlock.metadata.poster
                  : undefined}
              />
            {:else if nestedBlock.type === 'tool_use'}
              {@const nestedToolBlock = nestedBlock as ToolUseBlock}
              {@const nestedToolResult = findToolResult(toolResultsMap, nestedToolBlock)}
              {@const nestedToolState = toolStates.get(nestedToolBlock.id) || 'completed'}
              {@const nestedResultContent = getToolResultPayload(nestedToolResult)}
              <ToolCall
                toolUse={nestedToolBlock}
                toolState={nestedToolState}
                result={nestedResultContent}
                {workspaceId}
              />
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  {:else if block.type === 'thinking'}
    {#if reasoningHistory}
      <ReasoningHistoryBlock
        content={getContentBlockText(block) || m.chat_shared_processing_fallback()}
        {workspaceId}
        {adjacentOperationalRow}
      />
    {:else}
      <ThinkingBlock
        content={getContentBlockText(block) || m.chat_shared_processing_fallback()}
        isStreaming={isStreaming && !nested && blockIndex === groupedBlocks.length - 1}
        {workspaceId}
        {adjacentOperationalRow}
      />
    {/if}
  {/if}
{/snippet}

{#snippet renderResponseGroupChild(
  group: ContentBlockGroup,
  groupIndex: number,
  childBlock: ContentBlock,
  childIndex: number,
  nested: boolean = true,
)}
  {@const reasoningSectionStart = isNestedReasoningSectionStart(group, childIndex)}
  {@const reasoningSectionBoundary = isNestedReasoningSectionBoundary(
    group,
    childIndex,
    isVisibleGroupChild,
  )}
  <div
    class={`${
      reasoningSectionBoundary
        ? NESTED_REASONING_SECTION_SEAM_CLASS
        : getOperationalClusterSpacingClass(
            group.children,
            childIndex,
            isVisibleGroupChild,
            group.isReasoningPhase,
          )
    } ${
      nested
        ? isOperationalClusterBlock(childBlock)
          ? OPERATIONAL_GROUP_CHILD_ROW_CLASS
          : OPERATIONAL_GROUP_CHILD_CONTENT_CLASS
        : ''
    }`}
    style:padding-left={nested && !isOperationalClusterBlock(childBlock)
      ? 'calc(var(--operational-row-inline-padding) + var(--operational-leading-slot-size) + var(--operational-leading-gap))'
      : undefined}
    data-message-content-block={childBlock.type}
    data-chat-search-block-path={childBlock.type === 'tool_result'
      ? undefined
      : chatSearchBlockPath(groupIndex, childIndex)}
    data-response-group-child
    data-reasoning-section-start={reasoningSectionStart || undefined}
    data-reasoning-section-boundary={reasoningSectionBoundary || undefined}
  >
    {@render renderContentBlock(
      childBlock,
      `${groupIndex}-${childIndex}`,
      groupIndex,
      nested,
      isAdjacentOperationalClusterRow(group.children, childIndex, isVisibleGroupChild),
      group.isReasoningPhase,
      chatSearchBlockPath(groupIndex, childIndex),
    )}
  </div>
{/snippet}

<div class="flex flex-col gap-0" style="contain: layout style paint;" data-operational-stack>
  {#each groupedBlocks as block, blockIndex (blockKeys[blockIndex])}
    {#if block.type === 'content_group'}
      {@const group = block as ContentBlockGroup}
      {@const childKeys = getResponseGroupBlockKeys(group.children)}
      {#if shouldRenderResponseGroupInline(group)}
        {#each group.children as childBlock, childIndex (childKeys[childIndex])}
          {#if isVisibleGroupChild(childBlock)}
            {@render renderResponseGroupChild(group, blockIndex, childBlock, childIndex, false)}
          {/if}
        {/each}
      {:else}
        <div
          class={getOperationalClusterSpacingClass(
            groupedBlocks,
            blockIndex,
            isVisibleTopLevelBlock,
          )}
          data-operational-cluster-row={block.type}
          data-message-content-block={block.type}
        >
          <ResponseGroup
            name={group.name}
            isStreaming={group.isStreaming}
            isTerminal={blockIndex === lastVisibleTopLevelBlockIndex}
            {isLastConversationMessage}
            blocks={group.children.filter(isVisibleGroupChild)}
            searchPath={chatSearchBlockPath(blockIndex)}
            reasoningPhase={group.isReasoningPhase}
            adjacentOperationalRow={isAdjacentOperationalClusterRow(
              groupedBlocks,
              blockIndex,
              isVisibleTopLevelBlock,
            )}
          >
            {#snippet children()}
              {#each group.children as childBlock, childIndex (childKeys[childIndex])}
                {#if isVisibleGroupChild(childBlock)}
                  {@render renderResponseGroupChild(group, blockIndex, childBlock, childIndex)}
                {/if}
              {/each}
            {/snippet}
          </ResponseGroup>
        </div>
      {/if}
    {:else if block.type !== 'tool_result' || isStandaloneToolResult(toolResultClassification, block)}
      <div
        class={getOperationalClusterSpacingClass(groupedBlocks, blockIndex, isVisibleTopLevelBlock)}
        data-operational-cluster-row={isOperationalClusterBlock(block) ? block.type : undefined}
        data-message-content-block={block.type}
        data-chat-search-block-path={block.type === 'text'
          ? chatSearchBlockPath(blockIndex)
          : undefined}
      >
        {@render renderContentBlock(
          block as ContentBlock,
          String(blockIndex),
          blockIndex,
          false,
          isAdjacentOperationalClusterRow(groupedBlocks, blockIndex, isVisibleTopLevelBlock),
          false,
          chatSearchBlockPath(blockIndex),
        )}
      </div>
    {/if}
  {/each}
</div>

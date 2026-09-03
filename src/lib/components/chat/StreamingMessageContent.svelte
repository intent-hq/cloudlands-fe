<script lang="ts">
  import type { ContentBlock, ToolUseBlock, Proposal, MessageRole } from '$shared/types';
  import {
    dedupeAgentVideoContentBlocks,
    isProposal,
    normalizeAgentVideoContentBlocks,
  } from '$shared/types';
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
  import { getProposalFromResourceBlock } from '$shared/types/proposal-resource';
  import { isQuestionResourceBlock } from '$shared/types/question-resource';
  import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
  import { getContentBlockText } from '$shared/utils/content-block-helpers';
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import ToolCall from './ToolCall.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import AugmentCodeSnippet from '$lib/components/editor/AugmentCodeSnippet.svelte';
  import DigestCard from './DigestCard.svelte';
  import DetectedScriptsCard from './DetectedScriptsCard.svelte';
  import ChatDiffViewer from './ChatDiffViewer.svelte';
  import ChatWorkspaceCard from './ChatWorkspaceCard.svelte';
  import ChatImageBlock from './ChatImageBlock.svelte';
  import ChatVideoBlock from './ChatVideoBlock.svelte';
  import ChatReferenceBlock from './ChatReferenceBlock.svelte';
  import { PatchBlockContent } from '$features/file-tracking/components/diff';
  import DiagramRenderer from '$lib/components/diagrams/DiagramRenderer.svelte';
  import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';
  import ChatCliBlock from './ChatCliBlock.svelte';
  import ChatAgentActionBlock from './ChatAgentActionBlock.svelte';
  import SetupScriptCard from './SetupScriptCard.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import ReasoningHistoryBlock from './ReasoningHistoryBlock.svelte';
  import ExecutionPlanCard from './ExecutionPlanCard.svelte';
  import NavLink from './NavLink.svelte';
  import {
    parseAgentMessage,
    parseSuggestedPrompts,
    parseSuggestedPromptsFromContentBlocks,
    groupParsedBlocks,
    groupContentBlocks,
    filterWorkspaceCardsCoveredByIds,
    type RenderBlock,
    type ParsedContent,
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
  import { AuggieTextParser } from '$lib/utils/auggie-text-parser';
  import { createLogger } from '$lib/utils/client-logger';
  import { m } from '$shared/paraglide/messages.js';
  import { onDestroy } from 'svelte';
  import flatstr from 'flatstr';

  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('StreamingMessageContent');

  interface Props {
    content: ContentBlock[];
    isStreaming?: boolean;
    hideToolCalls?: boolean;
    hideSetupScripts?: boolean;
    workspaceId?: string;
    role?: MessageRole;
    /** Agent session id; with `messageId`, enables lazy block hydration (§5.5). */
    agentId?: string;
    /** Persisted message id owning `content` (hydration fetch/merge key). */
    messageId?: string;
    /** True when this message is the conversation's final assistant message. */
    isLastConversationMessage?: boolean;
    onSetupScriptGenerated?: (script: {
      name: string;
      description: string;
      content: string;
    }) => void;
  }

  let {
    content,
    isStreaming = false,
    hideToolCalls = false,
    hideSetupScripts = false,
    workspaceId,
    role = 'assistant',
    agentId,
    messageId,
    isLastConversationMessage = false,
    onSetupScriptGenerated,
  }: Props = $props();

  // Lazy full-block hydration (§5.5 slim projection → v7.2
  // agent.getMessageBlock): substitute cached full blocks for slim-truncated
  // ones before any downstream derivation. Init-time subscription (agentId is
  // stable per component instance); under-budget content passes through with
  // referential identity intact — live-streamed blocks are never truncated,
  // so the merge is a no-op mid-turn.
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

  // OPTIMIZATION: Use $derived instead of $effect to avoid triggering re-renders
  let cleanupFunctions: Array<() => void> = [];

  // Cleanup on component destroy
  onDestroy(() => {
    cleanupFunctions.forEach((cleanup) => cleanup());
    cleanupFunctions = [];
  });

  /**
   * Set of block keys that have already been animated.
   * Prevents the slide-up animation from replaying when Svelte
   * recreates DOM elements due to reactive content updates.
   */
  const animatedKeys = new Set<string>();

  /**
   * Svelte action that adds the slide-up animation class once per unique
   * block key, then removes it after the animation completes. Uses a
   * persistent Set to track which keys have already animated, so even if
   * Svelte recreates the DOM element the animation won't replay.
   */
  function animateIn(node: HTMLElement, params: { animate: boolean; key: string }) {
    if (!params.animate || animatedKeys.has(params.key)) return {};

    // Mark as animated immediately
    animatedKeys.add(params.key);

    node.classList.add('content-block--animate-in');

    function onEnd() {
      node.classList.remove('content-block--animate-in');
      node.removeEventListener('animationend', onEnd);
    }

    node.addEventListener('animationend', onEnd);

    return {
      destroy() {
        node.removeEventListener('animationend', onEnd);
      },
    };
  }

  // Use $derived.by for synchronous computation without side effects
  let blocks = $derived.by(() => {
    // Collapse duplicate §7.1 resource blocks (daemon-attached canonical +
    // FE-lifted fallback for the same logical resource) so exactly one card
    // renders per resource, preferring the daemon-canonical variant.
    // Agent Q&A questions are wizard-only and proposals are tray-only
    // (PROTOCOL §5.5): neither ever renders in the transcript, in any
    // state, so strip both up front.
    const parsedPromptBlocks = parseSuggestedPromptsFromContentBlocks(hydratedContent, {
      isStreaming,
    });
    const rawBlocks = dedupeAgentVideoContentBlocks(
      normalizeAgentVideoContentBlocks(
        dedupeResourceBlocks(parsedPromptBlocks.contentBlocks),
        role,
        workspaceId,
      ),
    ).filter((block) => !isQuestionResourceBlock(block) && getProposalFromBlock(block) === null);

    // DEBUG: Log content block types for tool call visibility debugging
    if (isStreaming) {
      const blockTypes = rawBlocks.map((b) => b.type);
      const hasToolUse = blockTypes.includes('tool_use');
      if (hasToolUse) {
        logger.debug('[StreamingMessageContent] blocks derived - has tool_use', {
          blockCount: rawBlocks.length,
          blockTypes,
          hideToolCalls,
        });
      }
    }

    let filtered: ContentBlock[];
    if (!isStreaming) {
      // Not streaming - do full processing
      // Filter empty text blocks and optionally hide tool activity.
      filtered = rawBlocks.filter((block) => {
        // Filter out tool_use blocks if hideToolCalls is true
        if (hideToolCalls && block.type === 'tool_use') {
          return false;
        }

        // Filter out empty text blocks (prevents blank spots in chat history)
        // Also strip suggested prompts before checking - they're rendered separately in ChatPanel
        if (block.type === 'text') {
          const text = block.text || (block as any).content || '';
          const { cleanedContent } = parseSuggestedPrompts(text);
          if (!cleanedContent.trim()) {
            return false;
          }
        }

        if (hideToolCalls && block.type === 'tool_result') return false;
        return true;
      });
    } else {
      // Streaming with content blocks - filter empty text blocks and optionally tool calls
      filtered = rawBlocks.filter((block) => {
        // Filter out tool calls if requested
        if (hideToolCalls && (block.type === 'tool_use' || block.type === 'tool_result')) {
          return false;
        }
        // Filter out empty text blocks during streaming (prevents spacing issues between tool calls)
        // Also strip suggested prompts before checking - they're rendered separately in ChatPanel
        if (block.type === 'text') {
          const text = block.text || (block as any).content || '';
          const { cleanedContent } = parseSuggestedPrompts(text);
          if (!cleanedContent.trim()) {
            return false;
          }
        }
        return true;
      });
    }

    // Deduplicate tool_use blocks: if skeleton + follow-up both exist with same ID,
    // keep only the last one (which has descriptive input parameters).
    const toolUseLastIndex = new Map<string, number>();
    for (let i = 0; i < filtered.length; i++) {
      const block = filtered[i];
      if (block.type === 'tool_use' && block.id) {
        toolUseLastIndex.set(block.id, i);
      }
    }
    if (toolUseLastIndex.size === 0) return filtered;
    return filtered.filter((block, index) => {
      if (block.type === 'tool_use' && block.id) {
        return toolUseLastIndex.get(block.id) === index;
      }
      return true;
    });
  });

  // Group content blocks by <group:Name> tags at the ContentBlock level.
  let groupedBlocks = $derived(
    normalizeResponseGroups(groupContentBlocks(blocks, isStreaming), isStreaming),
  );

  // Track tool states
  let toolStates = $state<Map<string, 'running' | 'completed' | 'error'>>(new Map());

  let toolResultClassification = $derived.by(() => classifyToolResults(groupedBlocks));
  let toolResultsMap = $derived(toolResultClassification.resultsMap);

  // Update tool states based on content
  $effect(() => {
    // Set tool states based on whether they have results
    const newToolStates = new Map<string, 'running' | 'completed' | 'error'>();

    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseBlock;
        // If there's a result for this tool, mark as completed/error
        // If streaming is done but no result, mark as completed (result may have been lost)
        // Otherwise mark as running. Look up by both the addressable block id
        // and the provider toolCallId (when present) to align with PROTOCOL.md
        // tool-call pairing.
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
          newToolStates.set(toolBlock.id, isError || hasErrorInContent ? 'error' : 'completed');
        } else if (!isStreaming) {
          // Streaming finished but no result - mark as completed anyway
          newToolStates.set(toolBlock.id, 'completed');
        } else {
          newToolStates.set(toolBlock.id, 'running');
        }
      }
    }

    // Update state with new maps to trigger reactivity
    toolStates = newToolStates;
  });

  // No need for manual markdown processing - MarkdownViewer handles it

  // Handle file opening from AugmentCodeSnippet
  function handleOpenFile(detail: {
    path: string;
    line?: number;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
  }) {
    logger.info('Opening file from code snippet', detail);
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

  function getProposalFromBlock(block: ContentBlock): Proposal | null {
    if (isProposal(block.proposal)) return block.proposal;
    const candidate = {
      kind: block.kind,
      payload: block.payload ?? {},
      preview: block.preview,
      applyToolCallId: block.applyToolCallId,
    };
    if (isProposal(candidate)) return candidate;
    // Standalone proposal-resource block (PROTOCOL §7.1): the daemon lifts a
    // proposal-MIME resource item out of a completed tool's output into a
    // top-level `{ type: "resource", resource: {…} }` block.
    return getProposalFromResourceBlock(block);
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

  // Collected from the pre-strip content: proposal blocks never render in
  // the transcript, but a bulk-op proposal's covered workspace cards stay
  // suppressed so the prose does not duplicate the tray's list.
  let bulkProposalWorkspaceIds = $derived.by(() =>
    collectBulkProposalWorkspaceIds(hydratedContent),
  );
  // Parse text blocks to extract augment_code_snippet blocks, digests, and setup scripts
  // PERFORMANCE: Memoize results to avoid re-parsing on every render
  type ParsedTextResult = {
    blocks: RenderBlock[];
    setupScript: { name: string; description: string; content: string } | null;
  };

  // Cache for parsed text blocks - parsing also resolves workspace-relative media.
  let parsedTextCache = new Map<string, ParsedTextResult>();
  const MAX_CACHE_SIZE = 100;

  function parseTextBlock(text: string): ParsedTextResult {
    const cacheKey = JSON.stringify([workspaceId ?? null, flatstr(text)]);
    // Check cache first
    const cached = parsedTextCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Extract setup script if present
    const setupScript = AuggieTextParser.extractSetupScript(text);
    // Strip suggested prompts (they're rendered separately in ChatPanel)
    const { cleanedContent: contentWithoutSuggestions } = parseSuggestedPrompts(text);
    // Parse the content - this handles digests inline as 'digest' type blocks
    const parsed = parseAgentMessage(contentWithoutSuggestions, workspaceId);
    // Group parsed blocks to wrap group_start/group_end markers into GroupedBlock objects
    const grouped = groupParsedBlocks(parsed);
    const result = { blocks: grouped, setupScript };

    // Cache the result (flatten accumulated streaming text so the Map retains flat strings)
    parsedTextCache.set(cacheKey, result);

    // Limit cache size (LRU-style: remove oldest entries)
    if (parsedTextCache.size > MAX_CACHE_SIZE) {
      const firstKey = parsedTextCache.keys().next().value;
      if (firstKey !== undefined) {
        parsedTextCache.delete(firstKey);
      }
    }

    return result;
  }

  // Pre-compute parsed results for all text blocks to avoid parsing in template
  // This runs once when blocks change, not on every render
  // Keys are "blockIndex" for top-level text blocks and "blockIndex-childIndex" for children inside groups
  let parsedTextBlocks = $derived.by(() => {
    const results = new Map<string, ParsedTextResult>();
    groupedBlocks.forEach((block, index) => {
      if (block.type === 'text') {
        const textContent = (block as ContentBlock).text || (block as any).content || '';
        if (textContent) {
          const parsed = parseTextBlock(textContent);
          results.set(String(index), {
            ...parsed,
            blocks: filterWorkspaceCardsCoveredByIds(parsed.blocks, bulkProposalWorkspaceIds),
          });
        }
      } else if (block.type === 'content_group') {
        const group = block as ContentBlockGroup;
        group.children.forEach((child, childIndex) => {
          if (child.type === 'text') {
            const textContent = child.text || (child as any).content || '';
            if (textContent) {
              const parsed = parseTextBlock(textContent);
              results.set(`${index}-${childIndex}`, {
                ...parsed,
                blocks: filterWorkspaceCardsCoveredByIds(parsed.blocks, bulkProposalWorkspaceIds),
              });
            }
          }
        });
      }
    });
    return results;
  });

  // Clear animatedKeys when streaming ends to prevent unbounded growth
  // during long conversations (keys are only needed while streaming)
  let prevIsStreaming = false;
  $effect(() => {
    if (prevIsStreaming && !isStreaming) {
      animatedKeys.clear();
    }
    prevIsStreaming = isStreaming;
  });

  // Clear cache when component is destroyed
  onDestroy(() => {
    parsedTextCache.clear();
    animatedKeys.clear();
  });

  /**
   * Generate a stable unique key for a render content block.
   * Handles both regular ContentBlocks and ContentBlockGroups.
   */
  function getBlockKey(block: RenderContentBlock, index: number): string {
    // ContentBlockGroup: use group name + index
    if (block.type === 'content_group') {
      const group = block as ContentBlockGroup;
      return `group-${index}-${group.sourceName ?? group.name}`;
    }

    const contentBlock = block as ContentBlock;

    if (isNavLinkBlock(contentBlock)) {
      return `nav-link-${index}-${contentBlock.target}`;
    }

    // If block has an explicit ID, use it (tool_use blocks typically have IDs)
    if (contentBlock.id) {
      return contentBlock.id;
    }

    // For text blocks, use stable index-based key
    if (contentBlock.type === 'text') {
      return `text-${index}`;
    }

    // For thinking blocks
    if (contentBlock.type === 'thinking') {
      return `thinking-${index}`;
    }

    // For tool_result blocks, use the tool_use_id if available
    if (contentBlock.type === 'tool_result' && contentBlock.tool_use_id) {
      return `result-${contentBlock.tool_use_id}`;
    }

    // Fallback: type + index (should rarely be reached)
    return `${contentBlock.type}-${index}`;
  }

  // Pre-compute block keys for stable iteration, ensuring uniqueness
  let blockKeys = $derived(
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
    if (contentBlock.type === 'tool_result') {
      return isStandaloneToolResult(toolResultClassification, contentBlock);
    }
    return (
      contentBlock.type === 'tool_use' ||
      contentBlock.type === 'thinking' ||
      contentBlock.type === 'plan'
    );
  }

  function isVisibleGroupChild(block: ContentBlock): boolean {
    return block.type !== 'tool_result' || isStandaloneToolResult(toolResultClassification, block);
  }

  let lastVisibleTopLevelBlockIndex = $derived.by(() => {
    for (let i = groupedBlocks.length - 1; i >= 0; i--) {
      if (isVisibleTopLevelBlock(groupedBlocks[i])) return i;
    }
    return -1;
  });

  /**
   * Index of the last group child that actually renders. tool_result children
   * are skipped by the group render loop, and text children that are empty
   * after stripping suggested prompts render nothing — a hidden trailing
   * child must not steal the "last block" streaming flag from the final
   * visible one.
   */
  function lastRenderableChildIndex(children: ContentBlock[]): number {
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (!isVisibleGroupChild(child)) continue;
      if (child.type === 'text') {
        const text = child.text || (child as any).content || '';
        if (!parseSuggestedPrompts(text).cleanedContent.trim()) continue;
      }
      return i;
    }
    return -1;
  }
</script>

{#snippet renderParsedContentBlock(
  parsedBlock: ParsedContent,
  isLastBlock: boolean,
  insetProse = false,
)}
  {#if insetProse}
    <div class={OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}>
      {@render renderParsedContentBlockBody(parsedBlock, isLastBlock, insetProse)}
    </div>
  {:else}
    {@render renderParsedContentBlockBody(parsedBlock, isLastBlock, insetProse)}
  {/if}
{/snippet}

{#snippet renderParsedContentBlockBody(
  parsedBlock: ParsedContent,
  isLastBlock: boolean,
  insetProse: boolean,
)}
  {#if parsedBlock.type === 'augment_code_snippet'}
    <AugmentCodeSnippet
      code={parsedBlock.content}
      language={parsedBlock.metadata?.language}
      path={parsedBlock.metadata?.path}
      mode={parsedBlock.metadata?.mode}
      onOpenFile={handleOpenFile}
    />
  {:else if parsedBlock.type === 'digest'}
    <DigestCard digest={parsedBlock.content || ''} />
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
  {:else if parsedBlock.type === 'mermaid'}
    <div class="mermaid-block my-8">
      <MermaidRenderer code={parsedBlock.content || ''} />
    </div>
  {:else if parsedBlock.type === 'patch' && parsedBlock.metadata?.patchData}
    {@const patchData = parsedBlock.metadata.patchData}
    <PatchBlockContent
      patches={[{ filePath: patchData.filePath, diff: patchData.diff }]}
      label={patchData.description || patchData.filePath}
    />
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
  {:else if parsedBlock.type === 'reference' && parsedBlock.metadata?.referenceData}
    <ChatReferenceBlock
      reference={parsedBlock.metadata.referenceData}
      onOpenFile={handleOpenFile}
    />
  {:else if parsedBlock.type === 'cli' && parsedBlock.metadata?.cliData}
    {@const cliData = parsedBlock.metadata.cliData}
    <ChatCliBlock command={cliData.command} />
  {:else if parsedBlock.type === 'agent_action' && parsedBlock.metadata?.agentActionData}
    <ChatAgentActionBlock goal={parsedBlock.metadata.agentActionData.goal} />
  {:else if parsedBlock.type === 'code'}
    <CodeBlock
      code={parsedBlock.content || ''}
      language={parsedBlock.metadata?.language || 'plaintext'}
    />
  {:else if parsedBlock.type === 'text'}
    <div data-assistant-prose={insetProse ? 'streaming-markdown' : undefined}>
      <MarkdownViewer
        content={parsedBlock.content || ''}
        isStreaming={isStreaming && isLastBlock}
        {workspaceId}
        taskBlockRenderMode="content"
        chatImageThumbnails
        onFileClick={(path, options) => handleOpenFile({ path, ...options })}
      />
    </div>
  {:else}
    <div data-assistant-prose={insetProse ? 'streaming-fallback' : undefined}>
      <MarkdownViewer
        content={parsedBlock.content || ''}
        isStreaming={isStreaming && isLastBlock}
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
  isLastBlock: boolean,
  nested = false,
  adjacentOperationalRow = false,
  reasoningHistory = false,
  searchPath: string | undefined = undefined,
)}
  {#if isNavLinkBlock(block)}
    <div class="w-full">
      <NavLink target={block.target} label={block.label} {workspaceId} />
    </div>
  {:else if block.type === 'text' && (block.text || (block as any).content)}
    {@const textContent = block.text || (block as any).content || ''}
    {@const parsedResult = parsedTextBlocks.get(parsedKey) || {
      blocks: [],
      setupScript: null,
    }}
    <div class="w-full">
      <!-- Show setup script card if present (unless hidden) -->
      {#if parsedResult.setupScript && !hideSetupScripts}
        <SetupScriptCard
          name={parsedResult.setupScript.name}
          description={parsedResult.setupScript.description}
          content={parsedResult.setupScript.content}
          onUseScript={onSetupScriptGenerated}
        />
      {/if}
      {#if parsedResult.blocks.length > 0}
        {#each parsedResult.blocks as renderBlock, parsedBlockIndex (`${parsedKey}-parsed-${parsedBlockIndex}`)}
          {@render renderParsedContentBlock(
            renderBlock as ParsedContent,
            isLastBlock && parsedBlockIndex === parsedResult.blocks.length - 1,
            !nested,
          )}
        {/each}
      {:else}
        <!-- Only render fallback if text has content after stripping suggested prompts -->
        <!-- (suggested prompts are rendered separately; empty blocks should be hidden) -->
        {@const cleanedText = parseSuggestedPrompts(textContent).cleanedContent}
        {#if cleanedText.trim()}
          <div
            class={nested ? undefined : OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}
            data-assistant-prose={nested ? undefined : 'streaming-plain'}
          >
            <MarkdownViewer
              content={cleanedText}
              isStreaming={isStreaming && isLastBlock}
              {workspaceId}
              taskBlockRenderMode="content"
              chatImageThumbnails
              onFileClick={(path, options) => handleOpenFile({ path, ...options })}
            />
          </div>
        {/if}
      {/if}
    </div>
  {:else if block.type === 'tool_use'}
    {@const toolBlock = block as ToolUseBlock}
    {@const toolResultBlock = findToolResult(toolResultsMap, toolBlock)}
    {@const resultContent = getToolResultPayload(toolResultBlock)}
    <div class="relative w-full min-w-0">
      <ToolCall
        toolUse={toolBlock}
        toolState={toolStates.get(toolBlock.id) || 'running'}
        result={resultContent}
        resultBlock={toolResultBlock}
        {workspaceId}
        {adjacentOperationalRow}
        {agentId}
        {messageId}
      />
      {#if Array.isArray(resultContent)}
        {#each resultContent as nestedBlock, nestedIndex (`${toolBlock.id}-image-${nestedIndex}`)}
          {#if nestedBlock?.type === 'image' && typeof nestedBlock.data === 'string' && typeof nestedBlock.mimeType === 'string'}
            <ChatImageBlock
              data={nestedBlock.data}
              mimeType={nestedBlock.mimeType}
              alt={m.chat_chatMessage_attachedImage_alt({ number: String(nestedIndex + 1) })}
            />
          {:else if nestedBlock?.type === 'video' && nestedBlock.source}
            <ChatVideoBlock
              source={nestedBlock.source}
              name={nestedBlock.fileName}
              poster={typeof nestedBlock.metadata?.poster === 'string'
                ? nestedBlock.metadata.poster
                : undefined}
            />
          {/if}
        {/each}
      {/if}
    </div>
  {:else if block.type === 'tool_result' && isStandaloneToolResult(toolResultClassification, block)}
    {@const resultPresentation = getStandaloneToolResultPresentation(block)}
    <div class="border border-border rounded-md">
      <div class="px-3 py-2 bg-muted/50 border-b border-border">
        <span class="type-caption text-subtle">{m.chat_messageContent_toolResult_label()}</span>
      </div>
      <div class="p-3" data-tool-result-payload data-chat-search-block-path={searchPath}>
        {#if typeof resultPresentation.payload === 'string'}
          <CodeBlock code={resultPresentation.payload} />
        {:else if Array.isArray(resultPresentation.payload)}
          {#each resultPresentation.payload as any[] as nestedBlock, nestedIndex (`nested-${parsedKey}-${nestedIndex}-${nestedBlock.id ?? nestedBlock.type}`)}
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
  {:else if block.type === 'plan' && block.entries}
    <ExecutionPlanCard entries={block.entries} />
  {:else if block.type === 'thinking'}
    <!-- Daemon-emitted thinking blocks carry `text` (PROTOCOL §7.1); the legacy
         <think>-tag parser path in messageParser emits `content`. -->
    {#if reasoningHistory}
      <ReasoningHistoryBlock
        content={getContentBlockText(block) || m.chat_shared_processing_fallback()}
        isStreaming={isStreaming && isLastBlock}
        {workspaceId}
        {adjacentOperationalRow}
      />
    {:else}
      <ThinkingBlock
        content={getContentBlockText(block) || m.chat_shared_processing_fallback()}
        isStreaming={isStreaming && isLastBlock}
        {workspaceId}
        {adjacentOperationalRow}
      />
    {/if}
  {:else if block.type === 'image' && (block.data || block.dataTruncated) && block.mimeType}
    <ChatImageBlock
      data={block.data}
      mimeType={block.mimeType}
      dataTruncated={block.dataTruncated === true}
      dataIsThumbnail={block.dataIsThumbnail === true}
      hydrationLoading={imageHydrationLoading(block.id)}
      onHydrate={agentId && messageId && block.id ? () => hydrateImageBlock(block.id) : undefined}
    />
  {:else if block.type === 'video' && block.source}
    <ChatVideoBlock
      source={block.source}
      name={block.fileName}
      poster={typeof block.metadata?.poster === 'string' ? block.metadata.poster : undefined}
    />
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
    class="content-block content-block--{childBlock.type} {reasoningSectionBoundary
      ? NESTED_REASONING_SECTION_SEAM_CLASS
      : getOperationalClusterSpacingClass(
          group.children,
          childIndex,
          isVisibleGroupChild,
          group.isReasoningPhase,
        )} {nested
      ? isOperationalClusterBlock(childBlock)
        ? OPERATIONAL_GROUP_CHILD_ROW_CLASS
        : OPERATIONAL_GROUP_CHILD_CONTENT_CLASS
      : ''}"
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
      group.isStreaming &&
        groupIndex === groupedBlocks.length - 1 &&
        childIndex === lastRenderableChildIndex(group.children),
      nested,
      isAdjacentOperationalClusterRow(group.children, childIndex, isVisibleGroupChild),
      group.isReasoningPhase,
      chatSearchBlockPath(groupIndex, childIndex),
    )}
  </div>
{/snippet}

<div
  class="relative flex flex-col gap-0"
  class:streaming={isStreaming}
  style="contain: layout style paint;"
  data-tool-executing={[...toolStates.values()].some((s) => s === 'running')}
  data-operational-stack
>
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
          class="content-block content-block--group {getOperationalClusterSpacingClass(
            groupedBlocks,
            blockIndex,
            isVisibleTopLevelBlock,
          )}"
          data-message-content-block="content_group"
          use:animateIn={{ animate: isStreaming, key: blockKeys[blockIndex] }}
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
    {:else if isVisibleTopLevelBlock(block)}
      <div
        class="content-block content-block--{isNavLinkBlock(block as ContentBlock)
          ? 'nav-link'
          : block.type} {getOperationalClusterSpacingClass(
          groupedBlocks,
          blockIndex,
          isVisibleTopLevelBlock,
        )}"
        data-operational-cluster-row={isOperationalClusterBlock(block) ? block.type : undefined}
        data-message-content-block={block.type}
        data-chat-search-block-path={block.type === 'text'
          ? chatSearchBlockPath(blockIndex)
          : undefined}
        use:animateIn={{ animate: isStreaming, key: blockKeys[blockIndex] }}
      >
        {@render renderContentBlock(
          block as ContentBlock,
          String(blockIndex),
          blockIndex === groupedBlocks.length - 1,
          false,
          isAdjacentOperationalClusterRow(groupedBlocks, blockIndex, isVisibleTopLevelBlock),
          false,
          chatSearchBlockPath(blockIndex),
        )}
      </div>
    {/if}
  {/each}

  <!-- Show streaming cursor if streaming but no content yet -->
  {#if isStreaming && groupedBlocks.length === 0}
    <div
      class="w-full {OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}"
      data-assistant-prose="streaming-empty"
    >
      <MarkdownViewer content="" isStreaming={true} {workspaceId} taskBlockRenderMode="content" />
    </div>
  {/if}
</div>

<style>
  /* PERF: Content blocks use containment for rendering isolation */
  .content-block {
    contain: layout style;
  }

  /* PERF: Tool use blocks are heavier - use stricter containment */
  .content-block--tool_use {
    contain: layout style paint;
  }

  @keyframes slideUpIn {
    from {
      transform: translateY(24px);
    }
    to {
      transform: translateY(0);
    }
  }

  .content-block--animate-in {
    animation: slideUpIn 250ms ease-out both;
  }
</style>

<script lang="ts">
  import type {
    ContentBlock,
    ToolUseBlock,
    ToolResultBlock,
    Proposal,
    ProposalActionDetail,
  } from '$shared/types';
  import { isProposal } from '$shared/types';
  import { getProposalFromResourceBlock } from '$shared/types/proposal-resource';
  import { dedupeResourceBlocks } from '$shared/types/resource-block-identity';
  import { resolveCard, type ResolvedCard } from './cards/card-registry';
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import ToolCall from './ToolCall.svelte';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import CodeBlock from '$lib/components/editor/CodeBlock.svelte';
  import AugmentCodeSnippet from '$lib/components/editor/AugmentCodeSnippet.svelte';
  import DigestCard from './DigestCard.svelte';
  import DetectedScriptsCard from './DetectedScriptsCard.svelte';
  import ChatDiffViewer from './ChatDiffViewer.svelte';
  import ChatWorkspaceCard from './ChatWorkspaceCard.svelte';
  import { PatchBlockContent } from '$lib/components/ui/diff';
  import DiagramRenderer from '$lib/components/diagrams/DiagramRenderer.svelte';
  import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';
  import Fa from 'svelte-fa';
  import { faCode, faTerminal, faRobot } from '@fortawesome/free-solid-svg-icons';
  import SetupScriptCard from './SetupScriptCard.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import ProposalCard from './proposals/ProposalCard.svelte';
  import { applySpecialistProposal } from './proposals/specialist-proposal-actions';
  import {
    applySettingsProposal,
    undoSettingsProposal,
  } from './proposals/settings-proposal-actions';
  import NavLink from './NavLink.svelte';
  import {
    parseAgentMessage,
    parseSuggestedPrompts,
    groupParsedBlocks,
    groupContentBlocks,
    filterWorkspaceCardsCoveredByIds,
    type RenderBlock,
    type ParsedContent,
    type ContentBlockGroup,
    type RenderContentBlock,
  } from '$lib/utils/messageParser';
  import ResponseGroup from './ResponseGroup.svelte';
  import { AuggieTextParser } from '$lib/utils/auggie-text-parser';
  import { createLogger } from '$lib/utils/client-logger';
  import { onDestroy } from 'svelte';
  import flatstr from 'flatstr';

  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { applyWorkspaceProposal } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('StreamingMessageContent');

  interface Props {
    content: ContentBlock[];
    isStreaming?: boolean;
    hideToolCalls?: boolean;
    hideSetupScripts?: boolean;
    workspaceId?: string;
    /** True once a later user message supersedes this message's question cards. */
    questionsResolved?: boolean;
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
    questionsResolved = false,
    onSetupScriptGenerated,
  }: Props = $props();

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
    const rawBlocks = dedupeResourceBlocks(content || []);

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
      // Filter out malformed tool_result blocks, empty text blocks, and optionally tool_use blocks
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

        if (block.type === 'tool_result') {
          // Also hide tool_result blocks if hideToolCalls is true
          if (hideToolCalls) {
            return false;
          }

          const resultBlock = block as ToolResultBlock;
          if (typeof resultBlock.content === 'string') {
            const contentStr = resultBlock.content;
            if (contentStr.includes('\u001b[') || contentStr.includes('🔧 Tool call:')) {
              return false;
            }
          }
        }
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

  // Group content blocks by <group:Name> tags at the ContentBlock level
  let groupedBlocks = $derived.by(() => {
    return groupContentBlocks(blocks, isStreaming);
  });

  // Track tool states
  let toolStates = $state<Map<string, 'running' | 'completed' | 'error'>>(new Map());

  // Update tool states based on content
  $effect(() => {
    // First pass: collect all tool results, indexed by every identifier the
    // result carries. Per PROTOCOL.md §7, tool_use blocks carry both an
    // addressable `id` (messageId:blockIndex) and a provider `toolCallId`, and
    // tool_result references the call via `tool_use_id` (canonically the
    // toolCallId). Indexing under both keys lets lookup by tool_use.id and
    // tool_use.toolCallId both resolve.
    const resultsMap = new Map<string, ToolResultBlock>();
    for (const block of blocks) {
      if (block.type === 'tool_result') {
        const resultBlock = block as ToolResultBlock;
        const resultRefs = [
          resultBlock.tool_use_id,
          (resultBlock as { toolCallId?: string }).toolCallId,
        ];
        for (const ref of resultRefs) {
          if (ref) resultsMap.set(ref, resultBlock);
        }
      }
    }

    // Second pass: match error results with empty tool_use_id to preceding tool_use
    // This handles the case where error results don't have proper IDs
    // SAFEGUARD: Only match if there's no other tool_use between the error and its target
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.type === 'tool_result') {
        const resultBlock = block as ToolResultBlock;
        const isError = resultBlock.is_error || (resultBlock as any).isError;
        // Only do position-based matching for error results with empty ID
        if (isError && !resultBlock.tool_use_id) {
          // Find the immediately preceding tool_use that doesn't have a result
          // Stop if we encounter another tool_use (to avoid misattribution)
          for (let j = i - 1; j >= 0; j--) {
            const prevBlock = blocks[j];
            if (prevBlock.type === 'tool_use') {
              const toolBlock = prevBlock as ToolUseBlock;
              if (!resultsMap.has(toolBlock.id)) {
                // Match this error result to the preceding tool_use
                resultsMap.set(toolBlock.id, resultBlock);
              }
              // Always break on first tool_use found - either we matched it or it
              // already has a result, in which case we can't safely attribute this error
              break;
            }
          }
        }
      }
    }

    // Third pass: set tool states based on whether they have results
    const newToolStates = new Map<string, 'running' | 'completed' | 'error'>();

    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseBlock;
        // If there's a result for this tool, mark as completed/error
        // If streaming is done but no result, mark as completed (result may have been lost)
        // Otherwise mark as running. Look up by both the addressable block id
        // and the provider toolCallId (when present) to align with PROTOCOL.md
        // tool-call pairing.
        const toolCallId = (toolBlock as { toolCallId?: string }).toolCallId;
        const result =
          resultsMap.get(toolBlock.id) ?? (toolCallId ? resultsMap.get(toolCallId) : undefined);
        if (result) {
          // Check both snake_case and camelCase for error flag
          const isError = result.is_error || (result as any).isError;
          // Also detect errors from content text (e.g., "Error:" prefix or "Tool Error:")
          // Note: We no longer check for ❌ emoji as it may be used as a visual indicator in content
          const contentText = typeof result.content === 'string' ? result.content : '';
          const hasErrorInContent =
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
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
  }) {
    logger.info('Opening file from code snippet', detail);
    if (!workspaceId) return;
    appStore.dispatch(
      openWorkspaceFile(workspaceId, detail.path, {
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
        (block as ContentBlockGroup).children.forEach((child) => addBulkProposalWorkspaceIds(child, ids));
      } else {
        addBulkProposalWorkspaceIds(block as ContentBlock, ids);
      }
    });
    return ids;
  }

  let bulkProposalWorkspaceIds = $derived.by(() => collectBulkProposalWorkspaceIds(groupedBlocks));

  function handleProposalApply(detail: ProposalActionDetail) {
    const { proposal } = detail;
    if (proposal.kind === 'workspace-create' || proposal.kind === 'bulk-op') {
      appStore.dispatch(
        applyWorkspaceProposal({
          proposal,
          editedFields: detail.editedFields,
          selectedBulkItemIds: detail.selectedBulkItemIds,
        }),
      );
      return;
    }

    if (applySpecialistProposal(detail)) return;
    applySettingsProposal(detail);
  }

  function handleProposalUndo(proposalId: string) {
    undoSettingsProposal(proposalId);
  }

  // Handlers handed to the MIME-keyed card registry when resolving a §7.1
  // resource block to its card component (ProposalCard, QuestionCard et al.).
  // $derived so question cards flip to resolved when a later user message lands.
  const cardHandlers = $derived({
    onProposalApply: handleProposalApply,
    onProposalUndo: handleProposalUndo,
    questionsResolved,
  });

  // Parse text blocks to extract augment_code_snippet blocks, digests, and setup scripts
  // PERFORMANCE: Memoize results to avoid re-parsing on every render
  type ParsedTextResult = {
    blocks: RenderBlock[];
    setupScript: { name: string; description: string; content: string } | null;
  };

  // Cache for parsed text blocks - keyed by text content
  let parsedTextCache = new Map<string, ParsedTextResult>();
  const MAX_CACHE_SIZE = 100;

  function parseTextBlock(text: string): ParsedTextResult {
    // Check cache first
    const cached = parsedTextCache.get(text);
    if (cached) {
      return cached;
    }

    // Extract setup script if present
    const setupScript = AuggieTextParser.extractSetupScript(text);
    // Strip suggested prompts (they're rendered separately in ChatPanel)
    const { cleanedContent: contentWithoutSuggestions } = parseSuggestedPrompts(text);
    // Parse the content - this handles digests inline as 'digest' type blocks
    const parsed = parseAgentMessage(contentWithoutSuggestions);
    // Group parsed blocks to wrap group_start/group_end markers into GroupedBlock objects
    const grouped = groupParsedBlocks(parsed);
    const result = { blocks: grouped, setupScript };

    // Cache the result (flatten accumulated streaming text so the Map retains flat strings)
    parsedTextCache.set(flatstr(text), result);

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
      return `group-${index}-${group.name}`;
    }

    const contentBlock = block as ContentBlock;

    if (isNavLinkBlock(contentBlock)) {
      return `nav-link-${index}-${contentBlock.target}`;
    }

    const proposal = getProposalFromBlock(contentBlock);
    if (proposal) {
      return `proposal-${index}-${proposal.kind}-${proposal.applyToolCallId ?? proposal.preview.title}`;
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
  let blockKeys = $derived.by(() => {
    const keys = groupedBlocks.map((block, index) => getBlockKey(block, index));
    // Ensure uniqueness by appending index if duplicates exist
    const seen = new Map<string, number>();
    return keys.map((key, index) => {
      const count = seen.get(key) || 0;
      seen.set(key, count + 1);
      // If this key was seen before, make it unique by appending the index
      return count > 0 ? `${key}-dup-${index}` : key;
    });
  });
</script>

<!-- Use animated component when streaming with animations enabled -->
<!-- Temporarily disabled streaming animation due to issues -->
<!-- {#if isStreaming && useAnimations}
  <StreamingAnimatedContent {content} {isStreaming} {hideToolCalls} {workspaceId} />
{:else} -->
{#if true}
  {#snippet renderParsedContentBlock(parsedBlock: ParsedContent, blockIndex: number)}
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
        <div class="text-xs font-medium text-subtle mb-1.5">Generated Commit Message</div>
        <div class="font-mono text-sm whitespace-pre-wrap text-foreground">
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
      />
    {:else if parsedBlock.type === 'reference' && parsedBlock.metadata?.referenceData}
      {@const refData = parsedBlock.metadata.referenceData}
      {@const refFileName = refData.filePath?.split('/').pop() || refData.semanticId || 'Reference'}
      <div class="my-2 rounded-lg border border-border overflow-hidden bg-background">
        <div class="flex items-center gap-2 px-3 py-1.5">
          <Fa icon={faCode} size="xs" class="flex-none text-ghost" />
          <span class="text-sm font-medium truncate">{refFileName}</span>
          {#if refData.filePath && refData.filePath !== refFileName}
            <span class="text-sm text-subtle truncate flex-1 min-w-0">
              {refData.filePath}
            </span>
          {/if}
        </div>
        {#if refData.snapshot?.code}
          <div class="border-t border-border">
            <CodeBlock
              code={refData.snapshot.code}
              language={refData.snapshot.languageId || 'plaintext'}
              showLineNumbers={true}
              noBorder={true}
              noMargin={true}
            />
          </div>
        {/if}
      </div>
    {:else if parsedBlock.type === 'cli' && parsedBlock.metadata?.cliData}
      {@const cliData = parsedBlock.metadata.cliData}
      <div class="my-1.5 flex items-center gap-2">
        <Fa icon={faTerminal} size="sm" class="text-ghost flex-none" />
        <code class="font-mono text-sm text-subtle flex-1 min-w-0 truncate">
          {cliData.command}
        </code>
      </div>
    {:else if parsedBlock.type === 'agent_action' && parsedBlock.metadata?.agentActionData}
      {@const actionData = parsedBlock.metadata.agentActionData}
      <div class="my-1.5 flex items-center gap-2">
        <Fa icon={faRobot} size="sm" class="text-ghost flex-none" />
        <span class="text-sm text-subtle flex-1 min-w-0 truncate">
          {actionData.goal}
        </span>
      </div>
    {:else if parsedBlock.type === 'code'}
      <CodeBlock
        code={parsedBlock.content || ''}
        language={parsedBlock.metadata?.language || 'plaintext'}
      />
    {:else if parsedBlock.type === 'text'}
      <MarkdownViewer
        content={parsedBlock.content || ''}
        isStreaming={isStreaming && blockIndex === groupedBlocks.length - 1}
        taskBlockRenderMode="content"
        onFileClick={(path) => handleOpenFile({ path })}
      />
    {:else}
      <MarkdownViewer
        content={parsedBlock.content || ''}
        isStreaming={isStreaming && blockIndex === groupedBlocks.length - 1}
        taskBlockRenderMode="content"
        onFileClick={(path) => handleOpenFile({ path })}
      />
    {/if}
  {/snippet}

  {#snippet renderCard(card: ResolvedCard)}
    {@const Card = card.component}
    <Card {...card.props} />
  {/snippet}

  {#snippet renderContentBlock(block: ContentBlock, parsedKey: string, blockIndex: number)}
    {#if isNavLinkBlock(block)}
      <div class="w-full">
        <NavLink target={block.target} label={block.label} />
      </div>
    {:else if resolveCard(block, cardHandlers)}
      <!-- §7.1 standalone resource block with a registered card (MIME-keyed
           card registry): ProposalCard under the proposal MIME today. -->
      {@const card = resolveCard(block, cardHandlers)}
      {#if card}
        <div class="w-full">
          {@render renderCard(card)}
        </div>
      {/if}
    {:else if getProposalFromBlock(block)}
      {@const proposal = getProposalFromBlock(block)}
      {#if proposal}
        <div class="w-full">
          <ProposalCard {proposal} onApply={handleProposalApply} onUndo={handleProposalUndo} />
        </div>
      {/if}
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
            {@render renderParsedContentBlock(renderBlock as ParsedContent, blockIndex)}
          {/each}
        {:else}
          <!-- Only render fallback if text has content after stripping suggested prompts -->
          <!-- (suggested prompts are rendered separately; empty blocks should be hidden) -->
          {@const cleanedText = parseSuggestedPrompts(textContent).cleanedContent}
          {#if cleanedText.trim()}
            <MarkdownViewer
              content={cleanedText}
              isStreaming={isStreaming && blockIndex === groupedBlocks.length - 1}
              taskBlockRenderMode="content"
              onFileClick={(path) => handleOpenFile({ path })}
            />
          {/if}
        {/if}
      </div>
    {:else if block.type === 'tool_use'}
      {@const toolBlock = block as ToolUseBlock}
      {@const toolResultBlock = blocks.find((b) => {
        if (b.type !== 'tool_result') return false;
        const refs = [(b as any).tool_use_id, (b as any).toolCallId];
        const targets = [toolBlock.id, (toolBlock as { toolCallId?: string }).toolCallId];
        return refs.some(
          (ref) => ref !== undefined && targets.some((t) => t !== undefined && ref === t),
        );
      })}
      {@const resultContent = toolResultBlock ? (toolResultBlock as ToolResultBlock).content : null}
      <div class="relative w-full min-w-0">
        <ToolCall
          toolUse={toolBlock}
          toolState={toolStates.get(toolBlock.id) || 'running'}
          result={resultContent}
          {workspaceId}
        />
      </div>
    {:else if block.type === 'tool_result'}
      <!-- Tool results are handled by associating them with their tool_use blocks -->
      <!-- We don't render them separately as they're shown within the ToolCall component -->
    {:else if block.type === 'thinking'}
      <ThinkingBlock
        content={block.content || 'Processing...'}
        isStreaming={isStreaming && blockIndex === groupedBlocks.length - 1}
      />
    {/if}
  {/snippet}

  <div
    class="flex flex-col gap-1.5 relative"
    class:streaming={isStreaming}
    style="contain: layout style paint;"
    data-tool-executing={[...toolStates.values()].some((s) => s === 'running')}
  >
    {#each groupedBlocks as block, blockIndex (blockKeys[blockIndex])}
      {#if block.type === 'content_group'}
        {@const group = block as ContentBlockGroup}
        <div
          class="content-block content-block--group my-1.25"
          use:animateIn={{ animate: isStreaming, key: blockKeys[blockIndex] }}
        >
          <ResponseGroup
            name={group.name}
            isStreaming={group.isStreaming}
            isLast={blockIndex === groupedBlocks.length - 1}
            blocks={group.children}
          >
            {#snippet children()}
              {#each group.children as childBlock, childIndex (`${blockIndex}-group-${childIndex}`)}
                {#if childBlock.type !== 'tool_result'}
                  <div class="content-block content-block--{childBlock.type} my-1.25">
                    {@render renderContentBlock(
                      childBlock,
                      `${blockIndex}-${childIndex}`,
                      blockIndex,
                    )}
                  </div>
                {/if}
              {/each}
            {/snippet}
          </ResponseGroup>
        </div>
      {:else if isNavLinkBlock(block as ContentBlock) || resolveCard(block, cardHandlers) || getProposalFromBlock(block as ContentBlock) || ['text', 'tool_use', 'thinking'].includes(block.type)}
        <div
          class="content-block content-block--{isNavLinkBlock(block as ContentBlock)
            ? 'nav-link'
            : resolveCard(block, cardHandlers)
              ? 'card'
              : getProposalFromBlock(block as ContentBlock)
                ? 'proposal'
                : block.type} my-1.25"
          use:animateIn={{ animate: isStreaming, key: blockKeys[blockIndex] }}
        >
          {@render renderContentBlock(block as ContentBlock, String(blockIndex), blockIndex)}
        </div>
      {/if}
    {/each}

    <!-- Show streaming cursor if streaming but no content yet -->
    {#if isStreaming && groupedBlocks.length === 0}
      <div class="w-full">
        <MarkdownViewer content="" isStreaming={true} taskBlockRenderMode="content" />
      </div>
    {/if}
  </div>
{/if}

<!-- End of temporary disable of streaming animation -->

<style>
  /* Adjacent tool_use blocks should have reduced spacing */
  .content-block--tool_use + .content-block--tool_use {
    margin-top: -0.5rem;
  }
  /* Adjacent tool_use blocks should have reduced spacing */
  .content-block--group + .content-block--group {
    margin-top: -0.5rem;
  }

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

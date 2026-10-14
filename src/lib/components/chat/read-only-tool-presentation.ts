import type { ContentBlock } from '$shared/types';
import { classifyTool, cleanToolName } from '$lib/utils/tool-classifier';
import { buildToolDisplayModel } from './tool-display-model';
import {
  dedupeToolUseBlocks,
  getToolCallState,
  shouldRenderToolCall,
} from './tool-call-presentation';
import { parseToolResult } from './tool-result-parser';
import { groupContentBlocks, type RenderContentBlock } from '$lib/utils/messageParser';
import { normalizeResponseGroups } from './response-group-blocks';
import { classifyToolResults, findToolResult, getToolResultPayload } from './tool-result-pairing';

/** Bounded port admission. Other result families retain their existing renderer. */
export function getReadOnlyToolPresentation(
  call: ContentBlock,
  resultBlock: ContentBlock | undefined,
  isStreaming = false,
) {
  if (call.type !== 'tool_use') return null;
  const input = call.input || {};
  const result = getToolResultPayload(resultBlock);
  const parsed = parseToolResult(call.name || '', input, result);
  const workspaceTool =
    cleanToolName(call.name).toLowerCase() === 'workspace_api' ||
    (typeof input.code === 'string' && typeof input.summary === 'string');
  const workspaceConfirmation = workspaceTool && parsed.type === 'confirmation';
  const workspaceAgentList =
    workspaceTool &&
    parsed.type === 'agent-list' &&
    resultBlock != null &&
    Boolean(parsed.agents?.length);
  // ACP file-kind receipts can contain only exit metadata. The canonical
  // unknown body is raw data; the human title never supplies file contents.
  const rawFileResult =
    parsed.type === 'unknown' && resultBlock != null && call.metadata?.toolKind === 'file';
  if (!workspaceConfirmation && !workspaceAgentList && !rawFileResult) return null;
  const display = classifyTool(call.name, input, result);
  const state = getToolCallState(resultBlock, isStreaming);
  const model = buildToolDisplayModel({
    toolName: call.name || '',
    display,
    input,
    result,
    parsedResult: parsed,
    toolState: state,
  });
  return {
    input,
    result,
    parsed,
    display,
    state,
    model,
    admitted: shouldRenderToolCall(display, model, input, result, state),
  };
}

/** Only consumed supported results are suppressed; all other blocks stay visible. */
export function prepareReadOnlyToolContent(blocks: ContentBlock[], isStreaming = false) {
  const groups = normalizeResponseGroups(
    groupContentBlocks(dedupeToolUseBlocks(blocks), isStreaming),
    isStreaming,
  );
  const classification = classifyToolResults(groups);
  const pairs = new Map<ContentBlock, ContentBlock | undefined>();
  const consumedResults = new Set<ContentBlock>();
  const visit = (items: readonly RenderContentBlock[]) => {
    for (const block of items) {
      if (block.type === 'content_group') {
        visit(block.children);
        continue;
      }
      if (block.type !== 'tool_use') continue;
      const result = findToolResult(classification.resultsMap, block);
      if (!getReadOnlyToolPresentation(block, result, isStreaming)) continue;
      pairs.set(block, result);
      if (result) consumedResults.add(result);
    }
  };
  visit(groups);
  return { groups, pairs, consumedResults };
}

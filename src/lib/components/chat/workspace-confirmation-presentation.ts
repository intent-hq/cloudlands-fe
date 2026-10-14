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
export function getWorkspaceConfirmationPresentation(
  call: ContentBlock,
  resultBlock: ContentBlock | undefined,
  isStreaming = false,
) {
  if (call.type !== 'tool_use') return null;
  const input = call.input || {};
  if (
    cleanToolName(call.name).toLowerCase() !== 'workspace_api' &&
    !(typeof input.code === 'string' && typeof input.summary === 'string')
  )
    return null;
  const result = getToolResultPayload(resultBlock);
  const parsed = parseToolResult(call.name || '', input, result);
  if (parsed.type !== 'confirmation') return null;
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

/** Only consumed confirmation results are suppressed; other pairs stay visible. */
export function prepareWorkspaceConfirmationContent(blocks: ContentBlock[], isStreaming = false) {
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
      if (!getWorkspaceConfirmationPresentation(block, result, isStreaming)) continue;
      pairs.set(block, result);
      if (result) consumedResults.add(result);
    }
  };
  visit(groups);
  return { groups, pairs, consumedResults };
}

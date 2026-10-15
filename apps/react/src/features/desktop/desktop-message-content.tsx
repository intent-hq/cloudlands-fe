import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { ContentBlock } from '$shared/types';
import type { ContentBlockGroup, RenderContentBlock } from '$lib/utils/messageParser';
import { groupContentBlocks, parseSuggestedPrompts } from '$lib/utils/messageParser';
import { getContentBlockText } from '$shared/utils/content-block-helpers';
import { mergeHydratedContent } from '$lib/components/chat/block-hydration';
import { dedupeToolUseBlocks } from '$lib/components/chat/tool-call-presentation';
import {
  normalizeResponseGroups,
  getResponseGroupChildBoundary,
  isNestedReasoningSectionBoundary,
} from '$lib/components/chat/response-group-blocks';
import {
  classifyToolResults,
  findToolResult,
  getStandaloneToolResultPresentation,
  isStandaloneToolResult,
} from '$lib/components/chat/tool-result-pairing';
import {
  createWindowItemProjector,
  type WindowItem,
} from '$lib/components/chat/operational-window-items';
import {
  getOperationalClusterSpacingClass,
  isAdjacentOperationalClusterRow,
  isOperationalClusterBlock,
} from '$lib/components/chat/operational-cluster-projections';
import {
  OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS,
  OPERATIONAL_GROUP_CHILD_CONTENT_CLASS,
  OPERATIONAL_GROUP_CHILD_ROW_CLASS,
  NESTED_REASONING_SECTION_SEAM_CLASS,
} from '$lib/components/chat/operational-disclosure-classes';
import { selectChatAgentState } from '@/store/chat-state/chat-state-selectors';
import { OperationalWindow } from '@/features/chat/components/operational-window';
import {
  useOperationalPanel,
  type OperationalPanel,
  type OperationalPanelLifetime,
} from '@/features/chat/components/operational-panel';
import { ResponseGroup, type ResponseGroupProps } from '@/features/chat/components/response-group';
import { Button } from '@/components/ui/button';
import { m } from '$shared/paraglide/messages.js';
import { DesktopToolCall } from './desktop-tool-call';

// Subscribe to the existing DOM owner only after commit; allocation is side-effect free.
function panelSubscription(lifetime: OperationalPanelLifetime | undefined) {
  let panel: OperationalPanel | null = null;
  return {
    snapshot: () => panel,
    subscribe(notify: () => void) {
      if (!lifetime) return () => {};
      const lease = lifetime.acquire();
      panel = lease.panel;
      notify();
      return () => {
        panel = null;
        lease.release();
      };
    },
  };
}
const noPanel = () => null;

/** Desktop presentation binds the source's projector to the existing React panel lifetime. */
export function DesktopMessageContent({
  blocks,
  agentId,
  messageId,
  isStreaming,
  isLastConversationMessage,
  isCurrent,
  renderText,
  onUnavailable,
}: {
  blocks: ContentBlock[];
  agentId: string;
  messageId: string;
  isStreaming: boolean;
  isLastConversationMessage: boolean;
  isCurrent: () => boolean;
  renderText: (text: string) => ReactNode;
  onUnavailable: (title: string) => void;
}) {
  const lifetime = useOperationalPanel();
  const subscription = useMemo(() => panelSubscription(lifetime), [lifetime]);
  const panel = useSyncExternalStore(subscription.subscribe, subscription.snapshot, noPanel);
  const cache = selectChatAgentState(agentId).value.hydratedBlocks;
  const hydrated = mergeHydratedContent(blocks, messageId, cache);
  const content = dedupeToolUseBlocks(
    hydrated.filter(
      (b) =>
        b.type !== 'text' ||
        Boolean(parseSuggestedPrompts(getContentBlockText(b)).cleanedContent.trim()),
    ),
  );
  const groups = normalizeResponseGroups(groupContentBlocks(content, isStreaming), isStreaming);
  const classification = classifyToolResults(groups);
  const visible = (b: RenderContentBlock) =>
    b.type !== 'tool_result' || isStandaloneToolResult(classification, b);
  if (!panel) return null;
  const project = panel.state(`projection:${messageId}`, () => ({
    project: createWindowItemProjector(),
  })).project;
  const items = project(groups, messageId, visible);
  const last = groups.findLastIndex(visible);
  const unavailable = () => {
    if (isCurrent()) onUnavailable(m.desktop_shell_unported_description());
  };
  const scope = (
    <Button variant="ghost" size="sm" onClick={unavailable}>
      {m.desktop_shell_unported_description()}
    </Button>
  );
  const renderBlock = (
    block: ContentBlock,
    item: WindowItem,
    nested: boolean,
    adjacent: boolean,
  ): ReactNode => {
    if (block.type === 'text')
      return (
        <div
          className={nested ? undefined : OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}
          data-assistant-prose=""
        >
          {renderText(parseSuggestedPrompts(getContentBlockText(block)).cleanedContent)}
        </div>
      );
    if (block.type === 'tool_use')
      return (
        <div className="relative w-full min-w-0" data-tool-entry="">
          <DesktopToolCall
            call={block}
            resultBlock={findToolResult(classification.resultsMap, block)}
            agentId={agentId}
            messageId={messageId}
            isStreaming={isStreaming}
            adjacent={adjacent}
            saved={panel.state<{ expanded?: boolean }>(item.key, () => ({}))}
            isCurrent={isCurrent}
            onUnavailable={onUnavailable}
          />
        </div>
      );
    if (block.type === 'tool_result') {
      const text = getStandaloneToolResultPresentation(block).searchableText;
      return text ? (
        <div
          data-tool-result-payload=""
          className={nested ? undefined : OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}
        >
          {renderText(text)}
        </div>
      ) : (
        scope
      );
    }
    return scope;
  };
  const render = (item: WindowItem, admitted: boolean): ReactNode => {
    const block = item.block,
      index = item.blockIndex;
    if (block.type === 'content_group')
      return (
        <div
          className={getOperationalClusterSpacingClass(groups, index, visible)}
          data-message-content-block="content_group"
        >
          <ResponseGroup
            headerAdmitted={admitted}
            headerHeight={panel.summaryHeight(item.key)}
            saved={panel.state<NonNullable<ResponseGroupProps['saved']>>(item.key, () => ({}))}
            name={block.name}
            isStreaming={block.isStreaming}
            isTerminal={index === last}
            isLastConversationMessage={isLastConversationMessage}
            blocks={block.children.filter(visible)}
            reasoningPhase={block.isReasoningPhase}
            adjacentOperationalRow={isAdjacentOperationalClusterRow(groups, index, visible)}
          >
            <OperationalWindow
              scope={`${messageId}:group:${item.key}`}
              items={project(block.children, messageId, visible, block, index)}
              row={render}
            />
          </ResponseGroup>
        </div>
      );
    if (item.group && item.childIndex !== undefined) {
      const group: ContentBlockGroup = item.group,
        child = item.childIndex;
      const boundary = getResponseGroupChildBoundary(groups, index, child, visible, visible);
      const spacing = isNestedReasoningSectionBoundary(group, child, visible)
        ? NESTED_REASONING_SECTION_SEAM_CLASS
        : getOperationalClusterSpacingClass(
            boundary,
            boundary.length - 1,
            undefined,
            group.isReasoningPhase,
          );
      return (
        <div
          className={`${item.fragment > 0 ? '' : spacing} ${item.nested ? (isOperationalClusterBlock(block) ? OPERATIONAL_GROUP_CHILD_ROW_CLASS : OPERATIONAL_GROUP_CHILD_CONTENT_CLASS) : ''}`}
          data-message-content-block={block.type}
          data-response-group-child=""
        >
          {renderBlock(
            block,
            item,
            item.nested,
            isAdjacentOperationalClusterRow(group.children, child, visible),
          )}
        </div>
      );
    }
    return (
      <div
        className={
          item.fragment > 0 ? '' : getOperationalClusterSpacingClass(groups, index, visible)
        }
        data-message-content-block={block.type}
        data-operational-cluster-row={isOperationalClusterBlock(block) ? block.type : undefined}
      >
        {renderBlock(block, item, false, isAdjacentOperationalClusterRow(groups, index, visible))}
      </div>
    );
  };
  return (
    <div className="relative flex flex-col gap-0" data-operational-stack="">
      <OperationalWindow items={items} scope={messageId} row={render} />
    </div>
  );
}

// Source: src/lib/components/chat/ReasoningHistoryBlock.svelte.
import { useId } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { MarkdownViewer, type MarkdownViewerProps } from '@/components/markdown/markdown-viewer';
import {
  CHAT_OPERATIONAL_ICON_CLASS,
  NESTED_REASONING_SECTION_SEAM_CLASS,
  OPERATIONAL_EXPANDED_CONTENT_CLASS,
} from '$lib/components/chat/operational-disclosure-classes';
import {
  extractReasoningHistory,
  type ReasoningHistoryItem,
} from '$lib/components/chat/reasoning-heading';
import { faBrain } from '$lib/icons/phosphor-icon-definitions';
import { ChatOperationalRow } from './chat-operational-row';
import './reasoning-history-block.css';

export interface ReasoningHistoryBlockProps extends Pick<
  MarkdownViewerProps,
  'workspaceContext' | 'onOpenLink' | 'onOpenFile' | 'onOpenNote'
> {
  item?: ReasoningHistoryItem;
  content: string;
  isStreaming?: boolean;
  workspaceId?: string;
  canOpenFile?: () => boolean;
  allowFileMedia?: boolean;
  adjacentOperationalRow?: boolean;
}

export function ReasoningHistoryBlock({
  item,
  content,
  isStreaming = false,
  workspaceId,
  canOpenFile,
  allowFileMedia = true,
  adjacentOperationalRow = false,
  workspaceContext,
  onOpenLink,
  onOpenFile,
  onOpenNote,
}: ReasoningHistoryBlockProps) {
  const history = item ? [item] : extractReasoningHistory(content);
  const instanceId = useId();

  return (
    <div className="min-w-0 max-w-full" data-reasoning-history="">
      {history.map((historyItem, index) => {
        const titleId = historyItem.title
          ? `reasoning-section-title-${instanceId}-${index}`
          : undefined;
        const followsBody = !!historyItem.title && index > 0 && !!history[index - 1].body;
        return (
          <section
            key={`${historyItem.title ?? 'body'}-${index}`}
            className={`${followsBody ? NESTED_REASONING_SECTION_SEAM_CLASS : ''} min-w-0 max-w-full`}
            aria-labelledby={titleId}
            data-reasoning-section=""
            data-reasoning-section-boundary={followsBody || undefined}
          >
            {historyItem.title ? (
              <ChatOperationalRow
                leading={
                  <IconDefinitionIcon
                    icon={faBrain}
                    size={16}
                    className={CHAT_OPERATIONAL_ICON_CLASS}
                  />
                }
                summary={
                  <span
                    id={titleId}
                    className="min-w-0 truncate whitespace-nowrap font-normal"
                    data-reasoning-section-title=""
                  >
                    {historyItem.title}
                  </span>
                }
                ariaLabel={historyItem.title}
                summaryTitle={historyItem.title}
                adjacentOperationalRow={adjacentOperationalRow}
                testId="reasoning-history-row"
                summaryTestId="reasoning-history-title"
              />
            ) : null}
            {historyItem.body ? (
              <div
                className={`reasoning-history-body ${OPERATIONAL_EXPANDED_CONTENT_CLASS} pb-2 type-caption text-muted-foreground [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-muted-foreground`}
                data-reasoning-history-body=""
              >
                <MarkdownViewer
                  canOpenFile={canOpenFile}
                  allowFileMedia={allowFileMedia}
                  content={historyItem.body}
                  isStreaming={isStreaming}
                  workspaceId={workspaceId}
                  workspaceContext={workspaceContext}
                  onOpenLink={onOpenLink}
                  onOpenFile={onOpenFile}
                  onOpenNote={onOpenNote}
                  taskBlockRenderMode="content"
                />
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export default ReasoningHistoryBlock;

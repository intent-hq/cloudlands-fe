import {
  composeTranscript,
  isConversationStartLoaded,
} from '$lib/components/chat/chat-transcript-composition';
import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import { store } from '@/store';
import {
  selectAgentSession,
  selectAgentHistoryMessages,
  selectHistorySegmentMeta,
} from '@/store/agent-session/agent-session-selectors';
import { selectChatAgentState } from '@/store/chat-state/chat-state-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  retainedChatTranscriptsSet,
  olderHistoryPageRequested,
  historyGapFillRequested,
} from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { MarkdownViewer, type MarkdownViewerProps } from '@/components/markdown/markdown-viewer';
import { ThinkingBlock } from '@/features/chat/components/thinking-block';
import { ResponseGroup } from '@/features/chat/components/response-group';
import { ConversationTurnGap } from '@/features/chat/components/conversation-turn-gap';
import { LiveStreamPhaseIndicator } from '@/features/chat/components/live-stream-phase-indicator';
import { LoadingState, EmptyState, ErrorState } from '@/components/patterns/screen';
import { Button, buttonVariants } from '@/components/ui/button';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { ContentBlock } from '$shared/types';
import { getContentBlockText } from '$shared/utils/content-block-helpers';
import { formatNumber } from '$lib/i18n/format';
import { parseIntentLink } from '$shared/utils/intent-link-parser';
import { m } from '$shared/paraglide/messages.js';

type Navigation = Pick<
  MarkdownViewerProps,
  'workspaceContext' | 'onOpenLink' | 'onOpenFile' | 'onOpenNote' | 'canLoadMedia'
>;

function ConversationBlock({ block, navigation }: { block: ContentBlock; navigation: Navigation }) {
  if (block.type === 'text')
    return (
      <MarkdownViewer {...navigation} content={getContentBlockText(block)} renderRichFencesAsCode />
    );
  if (block.type === 'thinking')
    return <ThinkingBlock {...navigation} content={getContentBlockText(block)} />;
  if (block.type === 'code')
    return (
      <pre className="overflow-auto whitespace-pre-wrap break-words type-code">
        {getContentBlockText(block)}
      </pre>
    );
  // Structured operational bodies remain read-only. No proposal, permission,
  // script, agent-action or other mutation callbacks are installed here.
  return (
    <ResponseGroup
      name={
        block.name ?? block.toolName ?? block.fileName ?? m.chat_messageContent_toolResult_label()
      }
    >
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words type-code">
        {JSON.stringify(block.input ?? block.output ?? block.content ?? block, null, 2)}
      </pre>
    </ResponseGroup>
  );
}

export function WorkspaceConversation({
  workspaceId,
  agentId,
}: {
  workspaceId: string;
  agentId: string;
}) {
  const consumer = useId();
  const navigate = useNavigate();
  const dispatch = store.dispatch;
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const session = selectAgentSession(agentId).value;
  const chat = selectChatAgentState(agentId).value;
  const history = selectAgentHistoryMessages(agentId).value;
  const historyMeta = selectHistorySegmentMeta(agentId).value;
  const composed = useMemo(
    () => composeTranscript(history, session?.messages ?? [], historyMeta.gapToTail),
    [history, session?.messages, historyMeta.gapToTail],
  );
  const messageCount = composed.groups.reduce((count, group) => count + group.messages.length, 0);
  const transcriptElement = useRef<HTMLElement>(null);
  const transcriptContent = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<{ element: Element; offset: number; epoch: number } | null>(null);
  function captureReadingPosition() {
    const container = transcriptElement.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const element = [...container.querySelectorAll('[data-message-id]')].find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > bounds.top && rect.top < bounds.bottom;
    });
    pendingAnchor.current = element
      ? {
          element,
          offset: element.getBoundingClientRect().top - bounds.top,
          epoch: chat.scrollbackDiscardEpoch,
        }
      : null;
  }
  useLayoutEffect(() => {
    const container = transcriptElement.current;
    const content = transcriptContent.current;
    if (!container || !content) return;
    const restore = () => {
      const anchor = pendingAnchor.current;
      if (!anchor) return;
      if (anchor.epoch !== chat.scrollbackDiscardEpoch || !anchor.element.isConnected) {
        pendingAnchor.current = null;
        return;
      }
      container.scrollTop +=
        anchor.element.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        anchor.offset;
    };
    restore();
    // Markdown and disclosure bodies can settle after the page's first layout.
    // Keep the same reading anchor through that growth, until native input
    // expresses a new reading position. The observer belongs to this DOM lifetime.
    const observer = new ResizeObserver(restore);
    observer.observe(content);
    const release = () => {
      pendingAnchor.current = null;
    };
    const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const event of inputs) container.addEventListener(event, release, { passive: true });
    return () => {
      observer.disconnect();
      for (const event of inputs) container.removeEventListener(event, release);
    };
  }, [history, session?.messages, chat.scrollbackDiscardEpoch, chat.transcriptHydration]);
  const loadingHistory =
    chat.initialHistoryPending || chat.fetchingOlderHistory || chat.fetchingGapFill;
  const startLoaded = isConversationStartLoaded({
    exhausted: historyMeta.oldestReached,
    historyCount: historyMeta.historyCount,
    tailCount: historyMeta.tailCount,
    tailTruncated: chat.transcriptSnapshot?.truncated ?? false,
    totalMessages: chat.transcriptSnapshot?.totalMessages ?? 0,
  });
  function loadHistory(direction: 'older' | 'gap') {
    captureReadingPosition();
    dispatch(
      direction === 'older'
        ? olderHistoryPageRequested(workspaceId, agentId)
        : historyGapFillRequested(workspaceId, agentId),
    );
  }
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (!authority) return;
    dispatch(retainedChatTranscriptsSet(consumer, workspaceId, [agentId]));
    return () => {
      dispatch(retainedChatTranscriptsSet(consumer, workspaceId, []));
    };
  }, [consumer, workspaceId, agentId, authority, dispatch]);
  useLayoutEffect(() => {
    heading.current?.focus();
  }, [workspaceId, agentId]);
  const current =
    authority && session?.workspaceId === workspaceId && chat.trackedWorkspaceId === workspaceId;
  const ready = current && chat.transcriptHydration === 'settled' && chat.liveStreamPhase !== null;
  const failed = authority && chat.transcriptHydration === 'error';
  function open(
    targetWorkspace: string,
    search: { note?: string; file?: string; line?: number; agent?: string },
  ) {
    void navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: targetWorkspace },
      search,
    });
  }
  const navigation: Navigation = {
    // Match the maintained read-only Notes host. Desktop asset schemes need
    // their own browser transport integration; retain the canonical fallback.
    canLoadMedia: (url) => /^(?:https?:|data:|blob:)/i.test(url.trim()),
    workspaceContext: { workspaceId: WorkspaceId(workspaceId) },
    onOpenNote: (id, note) => open(id, { note }),
    onOpenFile: (id, file, options) => open(id, { file, line: options?.line }),
    onOpenLink: (url, options) => {
      const target = options.rawHref ?? url;
      if (target.startsWith('intent://')) {
        const link = parseIntentLink(target);
        if (link.valid) {
          const id = link.workspaceId ?? workspaceId;
          if (link.type === 'message' && link.agentId) open(id, { agent: link.agentId });
          else if (link.type === 'note' || link.type === 'task')
            open(id, { note: link.resourceId });
          else if (link.type === 'file') open(id, { file: link.resourceId, line: link.line });
        }
      } else if (/^https?:\/\//.test(target)) window.open(target, '_blank', 'noopener,noreferrer');
      return true;
    },
  };
  return (
    <section
      className="grid min-w-0 gap-4"
      data-testid="workspace-conversation"
      data-agent-id={agentId}
      data-ready={Boolean(ready)}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 id={`${consumer}-conversation`} ref={heading} tabIndex={-1} className="break-words">
          {session?.workspaceId === workspaceId
            ? session.name
            : m.log_friendlyLabels_agentFallback_label()}
        </h2>
        <Link
          to="/workspaces/$workspaceId"
          params={{ workspaceId }}
          search={(previous) => ({ ...previous, agent: undefined })}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {m.workspace_filesPage_backToWorkspace_label()}
        </Link>
      </div>
      <LiveStreamPhaseIndicator phase={authority ? chat.liveStreamPhase : 'connecting'} />
      {failed ? (
        <ErrorState
          message={m.error_page_title()}
          retryLabel={m.ui_combobox_retry_label()}
          onRetry={() => dispatch(retainedChatTranscriptsSet(consumer, workspaceId, [agentId]))}
        />
      ) : !ready ? (
        <LoadingState label={m.chat_chatMessage_loading_label()} />
      ) : (
        <>
          <output className="type-caption text-muted-foreground">
            {m.chat_longRunningDebug_messages_label()} {formatNumber(messageCount)} /{' '}
            {formatNumber(chat.transcriptSnapshot?.totalMessages ?? session.messages.length)}
          </output>
          {!startLoaded && messageCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              data-testid="conversation-load-older"
              disabled={loadingHistory}
              onClick={() => loadHistory('older')}
            >
              {chat.fetchingOlderHistory
                ? m.chat_chatPanel_historyGapLoading_label()
                : chat.scrollbackOlderBlocked
                  ? m.ui_combobox_retry_label()
                  : m.chat_chatPanel_historyGapLoad_label()}
            </Button>
          )}
          {messageCount === 0 ? (
            <EmptyState description={m.ui_list_empty_label()} />
          ) : (
            <section
              ref={transcriptElement}
              aria-labelledby={`${consumer}-conversation`}
              className="max-h-[70vh] min-w-0 overflow-y-auto px-1 [overflow-anchor:none]"
              data-testid="conversation-messages"
            >
              <div ref={transcriptContent} className="grid min-w-0 gap-4">
                {composed.groups.flatMap((group, groupIndex) => [
                  ...(composed.gapBeforeGroupIndex === groupIndex
                    ? [
                        <Button
                          key="history-gap"
                          variant="outline"
                          data-testid="conversation-load-gap"
                          disabled={loadingHistory}
                          onClick={() => loadHistory('gap')}
                        >
                          {chat.fetchingGapFill
                            ? m.chat_chatPanel_historyGapLoading_label()
                            : m.chat_chatPanel_historyGapLoad_label()}
                        </Button>,
                      ]
                    : []),
                  ...group.messages.map((message) => (
                    <article
                      key={message.id}
                      className="min-w-0"
                      data-message-id={message.id}
                      data-message-role={message.role}
                    >
                      <p className="type-caption mb-2 text-muted-foreground">
                        {message.role === 'user'
                          ? m.tiptap_attributionGutter_user_label()
                          : message.role === 'assistant'
                            ? m.chat_agentThread_assistant_label()
                            : message.role}
                      </p>
                      {(message.contentBlocks ?? []).map((block, index) => (
                        <ConversationBlock
                          key={block.id ?? index}
                          block={block}
                          navigation={navigation}
                        />
                      ))}
                      <ConversationTurnGap
                        currentIsEventNotification={message.role === 'system'}
                        currentHasAssistantMessages={message.role === 'assistant'}
                        nextIsEventNotification={false}
                      />
                    </article>
                  )),
                ])}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}

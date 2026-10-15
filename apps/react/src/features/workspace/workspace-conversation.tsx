import { WorkspaceAgentName, WorkspaceAgentNameStatus } from './workspace-agent-name';
import { WorkspaceConversationPermissions } from './workspace-conversation-permissions';
import {
  agentMetadataAcquired,
  agentMetadataReleased,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { WorkspaceConversationComposer } from './workspace-conversation-composer';
import { conversationFileSearch } from './workspace-file-origin';
import { truncatedToolBlockIds } from '$lib/components/chat/block-hydration';
import { WorkspaceConversationContent } from './workspace-conversation-content';
import { WorkspaceConversationMessage } from './workspace-conversation-message';
import { WorkspaceConversationMedia } from './workspace-conversation-image';
import { WorkspaceConversationFile } from './workspace-conversation-file';
import {
  composeTranscript,
  isConversationStartLoaded,
} from '$lib/components/chat/chat-transcript-composition';
import { Link, useNavigate, useRouter, useLocation } from '@tanstack/react-router';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { store } from '@/store';
import {
  selectAgentSession,
  selectAgentHistoryMessages,
  selectHistorySegmentMeta,
} from '@/store/agent-session/agent-session-selectors';
import { selectChatAgentState, selectHydratedBlock } from '@/store/chat-state/chat-state-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import {
  messageBlockHydrationRequested,
  messageHistoryRequested,
  messageHistoryReleased,
  retainedChatTranscriptsSet,
  olderHistoryPageRequested,
  historyGapFillRequested,
} from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { MarkdownViewer, type MarkdownViewerProps } from '@/components/markdown/markdown-viewer';
import { ThinkingBlock } from '@/features/chat/components/thinking-block';
import { ResponseGroup } from '@/features/chat/components/response-group';
import { LiveStreamPhaseIndicator } from '@/features/chat/components/live-stream-phase-indicator';
import { LoadingState, EmptyState, ErrorState } from '@/components/patterns/screen';
import { Button, buttonVariants } from '@/components/ui/button';
import { WorkspaceId } from '$shared/types/branded-ids';
import { isFileBlock } from '$shared/types/content-block.guards';
import type { AgentMessage, ContentBlock } from '$shared/types';
import { getContentBlockText } from '$shared/utils/content-block-helpers';
import { formatNumber } from '$lib/i18n/format';
import { parseIntentLink } from '$shared/utils/intent-link-parser';
import { extractFilePathTarget, resolveFilePathTarget } from '$shared/utils/file-link-target';
import { m } from '$shared/paraglide/messages.js';

type Navigation = Pick<
  MarkdownViewerProps,
  'workspaceContext' | 'onOpenLink' | 'onOpenFile' | 'onOpenNote' | 'canLoadMedia'
> & { onOpenAttachment: (path: string, attachmentId: string) => void };

function ToolBody({
  block,
  agentId,
  messageId,
}: {
  block: ContentBlock;
  agentId: string;
  messageId: string;
}) {
  const entry = selectHydratedBlock(agentId, messageId, block.id ?? '').value;
  const truncated =
    truncatedToolBlockIds(
      block.type === 'tool_use' ? block : null,
      block.type === 'tool_result' ? block : null,
    ).length > 0;
  const dispatch = store.dispatch;
  useLayoutEffect(() => {
    if (truncated && block.id)
      dispatch(messageBlockHydrationRequested(agentId, messageId, block.id));
  }, [truncated, block.id, agentId, messageId, dispatch]);
  const displayed = truncated && entry?.status === 'loaded' ? entry.block : block;
  return (
    <div
      data-block-id={block.id}
      data-hydration={truncated ? (entry?.status ?? 'pending') : 'complete'}
    >
      {truncated &&
        entry?.status !== 'loaded' &&
        (entry?.status === 'error' ? (
          <ErrorState
            density="compact"
            message={m.common_resourceNotFound_loadFailed_title({
              resourceLabel: m.chat_toolCall_technicalDetails_label(),
            })}
            details={entry.error}
            detailsLabel={m.chat_toolCall_technicalDetails_label()}
            retryLabel={m.ui_combobox_retry_label()}
            onRetry={() => {
              if (block.id) dispatch(messageBlockHydrationRequested(agentId, messageId, block.id));
            }}
          />
        ) : (
          <LoadingState
            count={1}
            density="compact"
            label={m.chat_toolCall_loadingFullOutput_label()}
          />
        ))}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words type-code">
        {JSON.stringify(
          displayed.input ?? displayed.output ?? displayed.content ?? displayed,
          null,
          2,
        )}
      </pre>
    </div>
  );
}

function ConversationBlock({
  block,
  navigation,
  agentId,
  messageId,
  role,
}: {
  block: ContentBlock;
  navigation: Navigation;
  agentId: string;
  messageId: string;
  role: AgentMessage['role'];
}) {
  if (
    ((block.type === 'image' &&
      (block.mimeType === 'image/png' || block.mimeType === 'image/jpeg')) ||
      (isFileBlock(block) && block.mimeType === 'video/mp4')) &&
    block.attachmentId &&
    navigation.workspaceContext?.workspaceId
  )
    return (
      <WorkspaceConversationMedia
        mimeType={block.mimeType}
        role={role}
        agentId={agentId}
        workspaceId={navigation.workspaceContext.workspaceId}
        attachmentId={block.attachmentId}
      />
    );
  if (
    isFileBlock(block) &&
    block.mimeType === 'application/json' &&
    block.attachmentId &&
    navigation.workspaceContext?.workspaceId
  )
    return (
      <WorkspaceConversationFile
        key={`${agentId}:${block.attachmentId}`}
        workspaceId={navigation.workspaceContext.workspaceId}
        agentId={agentId}
        attachmentId={block.attachmentId}
        name={block.fileName ?? ''}
        size={block.size}
        mimeType={block.mimeType}
        onOpen={navigation.onOpenAttachment}
      />
    );
  if (block.type === 'text')
    return (
      <MarkdownViewer
        {...navigation}
        content={getContentBlockText(block)}
        linkifyPlainUrls={role === 'user'}
        renderRichFencesAsCode
      />
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
    <div data-tool-block-id={block.id}>
      <ResponseGroup
        name={
          block.name ?? block.toolName ?? block.fileName ?? m.chat_messageContent_toolResult_label()
        }
      >
        <ToolBody block={block} agentId={agentId} messageId={messageId} />
      </ResponseGroup>
    </div>
  );
}

export function WorkspaceConversation({
  workspaceId,
  agentId,
  messageId,
}: {
  workspaceId: string;
  agentId: string;
  messageId?: string;
}) {
  const consumer = useId();
  const navigate = useNavigate();
  const router = useRouter();
  const location = useLocation();
  const dispatch = store.dispatch;
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const session = selectAgentSession(agentId).value;
  const rootPath = selectWorkspaceById(workspaceId).value?.worktreePath;
  const linkView = useMemo(
    () => ({ workspaceId, agentId, authority, rootPath }),
    [workspaceId, agentId, authority, rootPath],
  );
  const liveLinkView = useRef<typeof linkView | null>(null);
  const linkAttempt = useRef(0);
  useLayoutEffect(() => {
    liveLinkView.current = linkView;
    return () => {
      if (liveLinkView.current === linkView) liveLinkView.current = null;
      linkAttempt.current += 1;
    };
  }, [linkView]);
  const chat = selectChatAgentState(agentId).value;
  const history = selectAgentHistoryMessages(agentId).value;
  const historyMeta = selectHistorySegmentMeta(agentId).value;
  const composed = useMemo(
    () => composeTranscript(history, session?.messages ?? [], historyMeta.gapToTail),
    [history, session?.messages, historyMeta.gapToTail],
  );
  const messageCount = composed.groups.reduce((count, group) => count + group.messages.length, 0);
  const transcriptElement = useRef<HTMLElement>(null);
  const readerElement = useRef<HTMLElement>(null);
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
    chat.initialHistoryPending ||
    chat.fetchingOlderHistory ||
    chat.fetchingGapFill ||
    chat.fetchingHistorySeek;
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
    dispatch(agentMetadataAcquired(consumer, workspaceId, agentId));
    dispatch(retainedChatTranscriptsSet(consumer, workspaceId, [agentId]));
    return () => {
      dispatch(retainedChatTranscriptsSet(consumer, workspaceId, []));
      dispatch(agentMetadataReleased(consumer));
    };
  }, [consumer, workspaceId, agentId, authority, dispatch]);
  useLayoutEffect(() => {
    heading.current?.focus();
  }, [workspaceId, agentId]);
  const current =
    authority && session?.workspaceId === workspaceId && chat.trackedWorkspaceId === workspaceId;
  const ready = current && chat.transcriptHydration === 'settled' && chat.liveStreamPhase !== null;
  const failed = authority && chat.transcriptHydration === 'error';
  const pendingTarget = useRef<{ messageId: string } | null>(null);
  const [target, setTarget] = useState<{
    messageId: string;
    view: typeof linkView;
    status: 'found' | 'unavailable';
  } | null>(null);
  useLayoutEffect(() => {
    if (!ready || chat.initialHistoryPending || !messageId) return;
    const requestId = crypto.randomUUID();
    const position = { messageId, view: linkView, status: 'found' as const };
    pendingTarget.current = position;
    pendingAnchor.current = null;
    const release = () => {
      if (pendingTarget.current === position) pendingTarget.current = null;
      pendingAnchor.current = null;
      dispatch(messageHistoryReleased(requestId));
    };
    const element = readerElement.current;
    const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const event of inputs) element?.addEventListener(event, release, { passive: true });
    void dispatch(
      messageHistoryRequested(consumer, workspaceId, agentId, messageId, requestId),
    ).then(
      (found) => {
        if (pendingTarget.current !== position) return;
        setTarget(found ? position : { ...position, status: 'unavailable' });
      },
      () => {
        if (pendingTarget.current !== position) return;
        pendingTarget.current = null;
        setTarget({ ...position, status: 'unavailable' });
      },
    );
    return () => {
      release();
      for (const event of inputs) element?.removeEventListener(event, release);
    };
  }, [
    ready,
    chat.initialHistoryPending,
    messageId,
    consumer,
    workspaceId,
    agentId,
    authority,
    linkView,
    dispatch,
  ]);
  useLayoutEffect(() => {
    if (
      !target ||
      target.status !== 'found' ||
      pendingTarget.current !== target ||
      target.messageId !== messageId
    )
      return;
    const container = transcriptElement.current;
    const row = [...(container?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])].find(
      (element) => element.dataset.messageId === target.messageId,
    );
    if (!container || !row) return;
    pendingTarget.current = null;
    row.focus({ preventScroll: true });
    const position = location.state.messageReturn;
    if (
      position?.workspaceId === workspaceId &&
      position.agentId === agentId &&
      position.messageId === target.messageId &&
      position.authority === authority &&
      position.rootPath === rootPath &&
      position.width === window.innerWidth &&
      position.height === window.innerHeight &&
      Number.isFinite(position.documentY) &&
      position.documentY >= 0 &&
      Number.isFinite(position.viewportY)
    ) {
      window.scrollTo({ top: position.documentY, behavior: 'instant' });
      container.scrollTop += row.getBoundingClientRect().top - position.viewportY;
    } else {
      container.scrollTop +=
        row.getBoundingClientRect().top - container.getBoundingClientRect().top;
      row.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
    pendingAnchor.current = {
      element: row,
      offset: row.getBoundingClientRect().top - container.getBoundingClientRect().top,
      epoch: chat.scrollbackDiscardEpoch,
    };
  }, [
    target,
    messageId,
    composed.groups,
    chat.scrollbackDiscardEpoch,
    location.state,
    workspaceId,
    agentId,
    authority,
    rootPath,
  ]);
  function open(
    targetWorkspace: string,
    search: { note?: string; file?: string; line?: number; agent?: string; message?: string },
  ) {
    void navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: targetWorkspace },
      search,
    });
  }
  function navigationFor(sourceMessageId: string): Navigation {
    async function openMessage(id: string, targetAgentId: string, targetMessageId: string) {
      const attempt = ++linkAttempt.current;
      const admitted = () =>
        liveLinkView.current === linkView &&
        linkAttempt.current === attempt &&
        !!authority &&
        selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) === authority &&
        selectWorkspaceById.select(store.state, workspaceId)?.worktreePath === rootPath &&
        selectAgentSession.select(store.state, agentId)?.workspaceId === workspaceId;
      const row = [
        ...(transcriptElement.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []),
      ].find((element) => element.dataset.messageId === sourceMessageId);
      if (!admitted() || !row) return;
      const position = {
        workspaceId,
        agentId,
        messageId: sourceMessageId,
        authority: authority!,
        rootPath,
        viewportY: row.getBoundingClientRect().top,
        documentY: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      // Replace only the source history entry, so Back names the clicked row rather than
      // whatever message happened to be in the URL before the user read further.
      await navigate({
        to: '/workspaces/$workspaceId',
        params: { workspaceId },
        replace: true,
        resetScroll: false,
        search: (previous) => ({ ...previous, agent: agentId, message: sourceMessageId }),
        state: (previous) => ({ ...previous, messageReturn: position }),
      });
      const source = router.state.location;
      if (
        !admitted() ||
        source.search.agent !== agentId ||
        source.search.message !== sourceMessageId
      )
        return;
      await navigate({
        to: '/workspaces/$workspaceId',
        params: { workspaceId: id },
        search: { agent: targetAgentId, message: targetMessageId },
        state: (previous) => ({ ...previous, messageReturn: undefined }),
      });
    }
    function openFile(id: string, file: string, options?: { line?: number; attachment?: string }) {
      void navigate({
        to: '/workspaces/$workspaceId',
        params: { workspaceId: id },
        search: (previous) =>
          conversationFileSearch(
            previous,
            id,
            {
              file,
              line: options?.line,
              attachment: options?.attachment,
              attachmentAgent: options?.attachment ? agentId : undefined,
            },
            { workspaceId, agentId, messageId: sourceMessageId },
          ),
      });
    }
    return {
      // Match the maintained read-only Notes host. Desktop asset schemes need
      // their own browser transport integration; retain the canonical fallback.
      canLoadMedia: (url) => /^(?:https?:|data:|blob:)/i.test(url.trim()),
      workspaceContext: { workspaceId: WorkspaceId(workspaceId) },
      onOpenNote: (id, note) => open(id, { note }),
      onOpenFile: (id, file, options) => openFile(id, file, options),
      onOpenAttachment: (file, attachment) => openFile(workspaceId, file, { attachment }),
      onOpenLink: (url, options) => {
        const target = options.rawHref ?? url;
        const fileTarget = extractFilePathTarget(url, options.rawHref, window.location.origin);
        if (fileTarget) {
          if (
            options.canOpenFile?.() === false ||
            !selectAdmittedWorkspaceReadContext.select(store.state, workspaceId)
          )
            return false;
          const workspace = selectWorkspaceById.select(store.state, workspaceId);
          const file = resolveFilePathTarget(
            fileTarget,
            workspace?.worktreePath ?? workspace?.path,
          );
          // This read-only host has no external-editor or filesystem escape path.
          if (!file || file.kind !== 'workspace') return false;
          openFile(workspaceId, file.path, { line: file.line });
          return true;
        }
        if (target.startsWith('intent://')) {
          const link = parseIntentLink(target);
          if (link.valid) {
            const id = link.workspaceId ?? workspaceId;
            if (link.type === 'message' && link.agentId)
              void openMessage(id, link.agentId, link.resourceId);
            else if (link.type === 'note' || link.type === 'task')
              open(id, { note: link.resourceId });
            else if (link.type === 'file') openFile(id, link.resourceId, { line: link.line });
          }
        } else if (/^https?:\/\//.test(target))
          window.open(target, '_blank', 'noopener,noreferrer');
        return true;
      },
    };
  }
  return (
    <section
      ref={readerElement}
      className="grid min-w-0 gap-4"
      data-testid="workspace-conversation"
      data-agent-id={agentId}
      data-ready={Boolean(ready)}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 id={`${consumer}-conversation`} ref={heading} tabIndex={-1} className="break-words">
          <WorkspaceAgentName workspaceId={workspaceId} agentId={agentId} />
        </h2>
        <Link
          to="/workspaces/$workspaceId"
          params={{ workspaceId }}
          search={(previous) => ({ ...previous, agent: undefined, message: undefined })}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {m.workspace_filesPage_backToWorkspace_label()}
        </Link>
      </div>
      <WorkspaceAgentNameStatus workspaceId={workspaceId} agentId={agentId} />
      <LiveStreamPhaseIndicator phase={authority ? chat.liveStreamPhase : 'connecting'} />
      {ready &&
        target?.view === linkView &&
        target.messageId === messageId &&
        target.status === 'unavailable' && (
          <EmptyState
            density="compact"
            description={
              <output>{m.workspace_conversation_messageUnavailable_description()}</output>
            }
          />
        )}
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
            {formatNumber(
              Math.max(
                messageCount,
                chat.transcriptSnapshot?.totalMessages ?? session.messages.length,
              ),
            )}
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
                  ...group.messages.map((message) => {
                    const navigation = navigationFor(message.id);
                    return (
                      <WorkspaceConversationMessage
                        key={`${authority}:${rootPath}:${agentId}:${message.id}`}
                        message={message}
                        workspaceId={workspaceId}
                        ownerAgentId={agentId}
                        canCopyLink={() => {
                          if (
                            liveLinkView.current !== linkView ||
                            router.state.location.search.agent !== agentId ||
                            !authority ||
                            selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) !==
                              authority ||
                            selectWorkspaceById.select(store.state, workspaceId)?.worktreePath !==
                              rootPath
                          )
                            return false;
                          const owner = selectAgentSession.select(store.state, agentId);
                          const currentChat = selectChatAgentState.select(store.state, agentId);
                          if (
                            owner?.workspaceId !== workspaceId ||
                            owner.retiredAt ||
                            currentChat.trackedWorkspaceId !== workspaceId ||
                            currentChat.transcriptHydration !== 'settled'
                          )
                            return false;
                          const row =
                            owner.messages.find((row) => row.id === message.id) ??
                            selectAgentHistoryMessages
                              .select(store.state, agentId)
                              .find((row) => row.id === message.id);
                          return (
                            !!row &&
                            row.role === message.role &&
                            row.metadata === message.metadata &&
                            row.seq === message.seq &&
                            Number.isSafeInteger(row.seq) &&
                            row.seq! >= 0 &&
                            !row.provisional
                          );
                        }}
                        navigation={navigation}
                        onOpenAgent={(id, agent) => open(id, { agent })}
                        renderContent={(blocks) => (
                          <WorkspaceConversationContent
                            blocks={blocks}
                            agentId={agentId}
                            messageId={message.id}
                            isStreaming={message.isStreaming === true}
                            onOpenAgent={(agent) => open(workspaceId, { agent })}
                            renderContent={(content) => (
                              <MarkdownViewer
                                {...navigation}
                                content={content}
                                renderRichFencesAsCode
                              />
                            )}
                            renderBlock={(block, index) => (
                              <ConversationBlock
                                role={message.role}
                                key={block.id ?? index}
                                block={block}
                                agentId={agentId}
                                messageId={message.id}
                                navigation={navigation}
                              />
                            )}
                          />
                        )}
                      />
                    );
                  }),
                ])}
              </div>
            </section>
          )}
        </>
      )}
      {current && <WorkspaceConversationPermissions workspaceId={workspaceId} agentId={agentId} />}
      {current && (
        <WorkspaceConversationComposer
          key={`${workspaceId}:${agentId}`}
          transcriptReady={Boolean(ready)}
          workspaceId={workspaceId}
          agentId={agentId}
        />
      )}
    </section>
  );
}

// Browser-history UI position only. Canonical readers still admit every row independently.
declare module '@tanstack/react-router' {
  interface HistoryState {
    messageReturn?: {
      workspaceId: string;
      agentId: string;
      messageId: string;
      authority: string;
      rootPath?: string;
      viewportY: number;
      documentY: number;
      width: number;
      height: number;
    };
  }
}

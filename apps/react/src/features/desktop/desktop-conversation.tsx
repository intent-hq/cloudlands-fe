import { openDesktopFile } from './desktop-file-open';
import { CaretDownIcon } from '@phosphor-icons/react';
import { AgentAvatar } from '@/features/agent/components/agent-avatar/agent-avatar';
import { Fragment, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MarkdownViewer } from '@/components/markdown/markdown-viewer';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState } from '@/components/patterns/screen';
import { StreamingStatus } from '@/features/chat/components/streaming-status';
import { WorkspaceId } from '$shared/types/branded-ids';
import { LiveStreamPhaseIndicator } from '@/features/chat/components/live-stream-phase-indicator';
import { WorkspaceConversationComposer } from '@/features/workspace/workspace-conversation-composer';
import { getConversationUserText } from '@/features/workspace/message-copy-text';
import { DesktopMessageContent } from './desktop-message-content';
import { OperationalPanelProvider } from '@/features/chat/components/operational-panel';
import { DesktopComposer } from './desktop-composer';
import { DesktopMessageNotice } from './desktop-message-notice';
import { MessageActions } from '@/features/chat/components/message-actions';
import { NewMessagesDivider } from '@/features/chat/components/new-messages-divider';
import { selectDividerSession } from '@/store/unread-tracking/unread-tracking-selectors';
import {
  markAgentAsViewed,
  clearCurrentlyViewedAgent,
  startDividerSession,
} from '../../../../../src/store/renderer/slices/unread-tracking/unread-tracking-slice';
import {
  resolveNewMessagesDividerAnchor,
  resolveLatchedDividerAnchor,
} from '$lib/components/chat/new-messages-divider';
import { store } from '@/store';
import {
  selectAgentSession,
  selectAgentIsResponding,
  selectAgentHistoryMessages,
  selectHistorySegmentMeta,
} from '@/store/agent-session/agent-session-selectors';
import { selectChatAgentState } from '@/store/chat-state/chat-state-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
import { selectCurrentWorkspaceTabId } from '@/store/tab-state/tab-state-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  agentMetadataAcquired,
  agentMetadataReleased,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { retainedChatTranscriptsSet } from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { composeTranscript } from '$lib/components/chat/chat-transcript-composition';
import {
  USER_MESSAGE_SURFACE_CLASS,
  USER_MESSAGE_TEXT_CLASS,
} from '$lib/components/chat/user-message-surface';
import { followBottom, animateScrollTo } from '$lib/utils/smartScroll';
import { prefersReducedMotion } from '$lib/utils/reduced-motion';
import {
  hasOperationalAssistantTurnBoundary,
  indexConversationTurns,
} from '$lib/components/chat/conversation-turns';
import {
  trackPinnedPrompt,
  attachPinnedPromptMessage,
  type PinnedPromptState,
} from '$lib/components/chat/pinned-prompt';
import { PinnedUserPrompt } from '@/features/chat/components/pinned-user-prompt';
import { ConversationTurnGap } from '@/features/chat/components/conversation-turn-gap';
import {
  getSubscriptionCardSeam,
  hasVisibleTurnBody,
  isChatCardMessage,
} from '$lib/components/chat/subscription-card-spacing';
import { isEventWakeMessage } from '$lib/components/chat/event-wake-summary';
import { isAttentionQuestionAnswerSeam } from '$lib/components/chat/attention-flow-spacing';
import { isBatchedDeliverySeam } from '$lib/utils/queue-info';
import { getContentBlockText } from '$shared/utils/content-block-helpers';
import { m } from '$shared/paraglide/messages.js';
import './desktop-chat.css';

/** Mounted agent panel body: the shared reader owns tail/history and the shared host owns drafts. */
export function DesktopConversation({
  workspaceId,
  agentId,
  panelId,
  tabId,
  active,
  onUnavailable,
}: {
  workspaceId: string;
  agentId: string;
  panelId: string;
  tabId: string;
  active: boolean;
  onUnavailable: (title: string) => void;
}) {
  const consumer = useId();
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const session = selectAgentSession(agentId).value;
  const chat = selectChatAgentState(agentId).value;
  const responding = selectAgentIsResponding(agentId).value;
  const workspace = selectWorkspaceById(workspaceId).value;
  const history = selectAgentHistoryMessages(agentId).value;
  const historyMeta = selectHistorySegmentMeta(agentId).value;
  const transcript = useMemo(
    () => composeTranscript(history, session?.messages ?? [], historyMeta.gapToTail),
    [history, session?.messages, historyMeta.gapToTail],
  );
  const turns = useMemo(() => indexConversationTurns(transcript.groups), [transcript]);
  const [pinned, setPinned] = useState<PinnedPromptState | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const getScrollRoot = useCallback(() => viewport.current ?? undefined, []);
  const scrollAction = useRef<ReturnType<typeof followBottom> | null>(null);
  const following = useRef(true);
  const divider = selectDividerSession(agentId).value;
  const dividerAnchor = resolveLatchedDividerAnchor(
    (session?.messages ?? []).map((m) => m.id),
    divider?.anchorId,
  );
  const latch = useRef<string | null>(null);
  const lifetime = useMemo(
    () => ({ active, authority, workspaceId, agentId, panelId, tabId }),
    [active, authority, workspaceId, agentId, panelId, tabId],
  );
  const liveLifetime = useRef<typeof lifetime | null>(null);
  useLayoutEffect(() => {
    liveLifetime.current = lifetime;
    return () => {
      if (liveLifetime.current === lifetime) liveLifetime.current = null;
    };
  }, [lifetime]);
  const current = useCallback(() => {
    const panel = selectDesktopLayout.select(store.state, workspaceId).panels[panelId];
    const agent = selectAgentSession.select(store.state, agentId);
    return Boolean(
      liveLifetime.current === lifetime &&
      active &&
      authority &&
      selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) === authority &&
      selectCurrentWorkspaceTabId.select(store.state) === workspaceId &&
      panel?.activeTabId === tabId &&
      panel.tabs.some((t) => t.id === tabId && t.agentId === agentId) &&
      agent?.workspaceId === workspaceId &&
      !agent.retiredAt,
    );
  }, [lifetime, active, authority, workspaceId, agentId, panelId, tabId]);
  const presentation = useMemo(
    () => ({
      Composer: DesktopComposer,
      isCurrent: current,
      onAdmitted: () => {
        if (!current()) return;
        following.current = true;
        scrollAction.current?.update({
          enabled: true,
          follow: true,
          threshold: 100,
          layoutNeutralBottomAnchor: true,
          onFollowChange: (value) => {
            following.current = value;
          },
        });
      },
    }),
    [current],
  );
  useLayoutEffect(() => {
    if (!authority || !active) return;
    store.dispatch(agentMetadataAcquired(consumer, workspaceId, agentId));
    store.dispatch(retainedChatTranscriptsSet(consumer, workspaceId, [agentId]));
    return () => {
      store.dispatch(retainedChatTranscriptsSet(consumer, workspaceId, []));
      store.dispatch(agentMetadataReleased(consumer));
    };
  }, [consumer, workspaceId, agentId, authority, active]);
  useLayoutEffect(() => {
    if (!viewport.current) return;
    const action = followBottom(viewport.current, {
      enabled: false,
      follow: true,
      layoutNeutralBottomAnchor: true,
    });
    scrollAction.current = action;
    following.current = true;
    return () => {
      action.destroy();
      scrollAction.current = null;
    };
  }, [agentId]);
  useLayoutEffect(() => {
    scrollAction.current?.update({
      enabled: active,
      follow: following.current,
      threshold: 100,
      layoutNeutralBottomAnchor: true,
      onFollowChange: (value) => {
        following.current = value;
      },
    });
  }, [active, agentId]);
  useLayoutEffect(() => {
    if (!active || !authority) return;
    store.dispatch(markAgentAsViewed(agentId));
    return () => {
      store.dispatch(clearCurrentlyViewedAgent(agentId));
    };
  }, [active, agentId, authority]);
  useLayoutEffect(() => {
    if (
      !authority ||
      latch.current === agentId ||
      chat.transcriptHydration !== 'settled' ||
      chat.initialHistoryPending ||
      chat.awaitingSwitchBackSnapshot
    )
      return;
    latch.current = agentId;
    store.dispatch(
      startDividerSession(
        agentId,
        resolveNewMessagesDividerAnchor(
          (session?.messages ?? []).map((message) => message.id),
          typeof session?.metadata?.lastSeenMessageId === 'string'
            ? session.metadata.lastSeenMessageId
            : undefined,
        ),
      ),
    );
  }, [
    authority,
    agentId,
    chat.transcriptHydration,
    chat.initialHistoryPending,
    chat.awaitingSwitchBackSnapshot,
    session?.messages,
    session?.metadata?.lastSeenMessageId,
  ]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !active || !authority) return;
    const tracker = trackPinnedPrompt(element, { enabled: true, onChange: setPinned });
    return () => {
      tracker.destroy();
    };
  }, [active, authority, agentId]);
  function openPinnedPrompt() {
    if (!current() || !pinned || !viewport.current) return;
    const container = viewport.current;
    const target = container.querySelector<HTMLElement>(
      `[data-pinned-prompt-id="${CSS.escape(pinned.id)}"]`,
    );
    if (!target) return;
    following.current = false;
    scrollAction.current?.update({
      enabled: true,
      follow: false,
      layoutNeutralBottomAnchor: true,
      onFollowChange: (value) => {
        following.current = value;
      },
    });
    setPinned(null);
    const position = () =>
      container.scrollTop +
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top;
    if (prefersReducedMotion()) container.scrollTop = position();
    else
      animateScrollTo(() => (current() && container.contains(target) ? container : null), position);
  }
  const admitted =
    authority &&
    session?.workspaceId === workspaceId &&
    !session.retiredAt &&
    chat.trackedWorkspaceId === workspaceId;
  const ready = admitted && chat.transcriptHydration === 'settled' && chat.liveStreamPhase !== null;
  return (
    <div className="desktop-conversation" data-agent-id={agentId}>
      {active && pinned && chat.transcriptHydration === 'settled' && (
        <div className="desktop-pinned-prompt" data-testid="pinned-prompt-overlay-host">
          <PinnedUserPrompt
            text={getConversationUserText(pinned.message, workspace?.ownerPrincipalId)}
            surface={pinned.surface}
            onActivate={openPinnedPrompt}
          />
        </div>
      )}
      <div
        ref={viewport}
        className="desktop-transcript-scroll"
        data-testid="desktop-transcript"
        data-message-controls-root
      >
        <OperationalPanelProvider getScrollRoot={getScrollRoot}>
          <div className="desktop-transcript-content">
            {(transcript.groups.length > 0 || !ready) && (
              <div className="desktop-transcript-spacer" />
            )}
            {ready && transcript.groups.length === 0 && !responding && (
              <div className="mx-auto mt-16 flex w-full max-w-[40rem] flex-1 flex-col px-4 pb-6 pt-4 text-subtle">
                <Button
                  variant="plain"
                  wrapContent={false}
                  className="mb-5 flex h-auto w-full items-center gap-3 whitespace-normal rounded-lg border border-border bg-card px-4 py-3 text-left shadow-xs"
                  data-testid="specialist-picker-trigger"
                  onClick={() => onUnavailable(m.workspace_createAgentSection_specialists_label())}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
                    <AgentAvatar agentId="blank" variant="emphasized" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="type-body block font-medium text-foreground">
                      {session?.metadata?.specialist ??
                        session?.agentMetadata?.specialist ??
                        m.chat_shared_general_fallback()}
                    </span>
                    <span className="type-caption mt-0.5 block text-muted-foreground">
                      {m.chat_shared_noSpecializedBehavior_label()}
                    </span>
                  </span>
                  <span className="flex size-7 items-center justify-center rounded-md bg-muted/50 text-muted-foreground">
                    <CaretDownIcon size={10} />
                  </span>
                </Button>
                <p className="mb-3 px-4 text-sm text-subtle leading-relaxed whitespace-pre-wrap">
                  {session?.metadata?.specialist || session?.agentMetadata?.specialist
                    ? m.desktop_shell_unported_description()
                    : m.chat_regularAgentWelcome_generalDescription_label()}
                </p>
              </div>
            )}
            {chat.transcriptHydration === 'error' ? (
              <ErrorState
                message={m.error_page_title()}
                retryLabel={m.ui_combobox_retry_label()}
                onRetry={() => {
                  if (current())
                    store.dispatch(retainedChatTranscriptsSet(consumer, workspaceId, [agentId]));
                }}
              />
            ) : !ready ? (
              <LoadingState label={m.chat_chatMessage_loading_label()} />
            ) : (
              turns.groups.map(({ group, turns: groupTurns }, groupIndex) => (
                <div className="desktop-transcript-group" key={group.groupKey ?? groupIndex}>
                  {groupTurns.map((turn, turnIndex) => {
                    const next =
                      groupTurns[turnIndex + 1] ?? turns.groups[groupIndex + 1]?.turns[0];
                    const operational = hasOperationalAssistantTurnBoundary(turn, next);
                    const attention = isAttentionQuestionAnswerSeam(turn, next);
                    const body = hasVisibleTurnBody({
                      assistantMessages: turn.assistantMessages,
                      hasVisibleNotice: turn.noticeMessages.length > 0,
                    });
                    return (
                      <Fragment key={turn.userMessage?.id ?? turnIndex}>
                        <div
                          data-conversation-turn
                          className="desktop-conversation-turn"
                          key={turn.userMessage?.id ?? turnIndex}
                        >
                          {[
                            ...(turn.userMessage ? [turn.userMessage] : []),
                            ...turn.noticeMessages,
                            ...turn.bodyMessages,
                          ].map((message) => {
                            const ordinary =
                              message.role === 'user' || message.role === 'assistant';
                            const text =
                              message.role === 'user'
                                ? getConversationUserText(message, workspace?.ownerPrincipalId)
                                : (message.contentBlocks
                                    ?.filter((b) => b.type === 'text')
                                    .map(getContentBlockText)
                                    .join('\n\n') ?? '');
                            const unsupported =
                              !ordinary ||
                              (message.role === 'user' &&
                                message.contentBlocks?.some((b) => b.type !== 'text'));
                            return (
                              <Fragment key={message.id}>
                                <article
                                  data-pinned-prompt-id={
                                    message.role === 'user' ? message.id : undefined
                                  }
                                  ref={(element) => {
                                    if (element && message.role === 'user')
                                      attachPinnedPromptMessage(element, message);
                                  }}
                                  data-message-id={message.id}
                                  data-message-role={message.role}
                                  className={`desktop-chat-message group relative ${message.role === 'user' ? USER_MESSAGE_SURFACE_CLASS : ''}`}
                                >
                                  {message.role === 'assistant' || text ? (
                                    message.role === 'user' ? (
                                      <div
                                        className={`${USER_MESSAGE_TEXT_CLASS} whitespace-pre-wrap`}
                                      >
                                        {text}
                                      </div>
                                    ) : (
                                      <DesktopMessageContent
                                        blocks={message.contentBlocks ?? []}
                                        agentId={agentId}
                                        workspaceId={workspaceId}
                                        panelId={panelId}
                                        messageId={message.id}
                                        isStreaming={Boolean(message.isStreaming)}
                                        isLastConversationMessage={
                                          message.id === session?.messages.at(-1)?.id
                                        }
                                        isCurrent={current}
                                        onUnavailable={onUnavailable}
                                        renderText={(body) => (
                                          <MarkdownViewer
                                            workspaceContext={{
                                              workspaceId: WorkspaceId(workspaceId),
                                            }}
                                            renderRichFencesAsCode
                                            allowFileMedia={false}
                                            onOpenFile={(ws, path, options) => {
                                              if (
                                                ws !== workspaceId ||
                                                !openDesktopFile(ws, path, current, {
                                                  ...options,
                                                  sourcePanelId: panelId,
                                                })
                                              )
                                                onUnavailable(
                                                  m.desktop_shell_unported_description(),
                                                );
                                            }}
                                            onOpenNote={() =>
                                              onUnavailable(m.desktop_shell_unported_description())
                                            }
                                            content={body}
                                            onOpenLink={() => {
                                              onUnavailable(m.desktop_shell_unported_description());
                                              return true;
                                            }}
                                          />
                                        )}
                                      />
                                    )
                                  ) : null}
                                  {message.role === 'assistant' && (
                                    <DesktopMessageNotice message={message} />
                                  )}
                                  {unsupported && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        onUnavailable(m.desktop_shell_unported_description())
                                      }
                                    >
                                      {m.desktop_shell_unported_description()}
                                    </Button>
                                  )}
                                  {ordinary && !message.isStreaming && (
                                    <MessageActions
                                      role={message.role as 'user' | 'assistant'}
                                      timestamp={message.timestamp}
                                      className="absolute bottom-0 right-0 z-10"
                                      onCopy={() =>
                                        onUnavailable(m.chat_messageActions_copyMessage_ariaLabel())
                                      }
                                      onEdit={
                                        message.role === 'user'
                                          ? () =>
                                              onUnavailable(
                                                m.chat_messageActions_editMessage_ariaLabel(),
                                              )
                                          : undefined
                                      }
                                      onRegenerate={
                                        message.role === 'assistant'
                                          ? () =>
                                              onUnavailable(
                                                m.chat_messageActions_regenerate_ariaLabel(),
                                              )
                                          : undefined
                                      }
                                      onScrollToPrevious={() =>
                                        onUnavailable(
                                          m.chat_messageActions_scrollToPrevious_label(),
                                        )
                                      }
                                    />
                                  )}
                                </article>
                                {dividerAnchor === message.id && <NewMessagesDivider />}
                              </Fragment>
                            );
                          })}
                        </div>
                        {next && (
                          <ConversationTurnGap
                            currentIsEventNotification={isEventWakeMessage(
                              turn.userMessage ?? undefined,
                            )}
                            currentHasAssistantMessages={turn.assistantMessages.length > 0}
                            nextIsEventNotification={isEventWakeMessage(
                              next.userMessage ?? undefined,
                            )}
                            nextHasUserMessage={Boolean(
                              next.userMessage && !isEventWakeMessage(next.userMessage),
                            )}
                            compactOperationalSeam={operational}
                            zeroToolSeam={operational}
                            attentionQuestionAnswerSeam={attention}
                            batchedDeliverySeam={!attention && isBatchedDeliverySeam(turn, next)}
                            subscriptionCardSeam={getSubscriptionCardSeam(
                              isChatCardMessage(turn.userMessage) && !body,
                              isChatCardMessage(next.userMessage),
                            )}
                          />
                        )}
                      </Fragment>
                    );
                  })}
                  {group.messages.some((message) => !turns.turnKeyByMessageId.has(message.id)) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onUnavailable(m.desktop_shell_unported_description())}
                    >
                      {m.desktop_shell_unported_description()}
                    </Button>
                  )}
                </div>
              ))
            )}
            <StreamingStatus
              isStreaming={session?.isStreaming}
              isProcessing={responding}
              lastChunkTime={chat.lastChunkTime}
              receivedFirstChunk={chat.receivedFirstChunk}
              streamingStartTime={chat.streamingStartTime}
              statusEvents={chat.statusEvents}
              streamingContentLength={
                session?.messages
                  .filter((message) => message.isStreaming)
                  .flatMap((message) => message.contentBlocks ?? [])
                  .filter((block) => block.type === 'text')
                  .map(getContentBlockText)
                  .join('').length ?? 0
              }
              processQueueHint={session?.processQueueHint}
              onOpenAgentBackendSettings={() => onUnavailable(m.settings_sidebar_providers_label())}
            />
            <LiveStreamPhaseIndicator
              phase={authority ? chat.liveStreamPhase : 'connecting'}
              turnInFlight={Boolean(session?.turnInFlight)}
            />
          </div>
        </OperationalPanelProvider>
      </div>
      <div className="desktop-composer-lane">
        {admitted && (
          <WorkspaceConversationComposer
            key={`${workspaceId}:${agentId}`}
            workspaceId={workspaceId}
            agentId={agentId}
            transcriptReady={Boolean(ready)}
            presentation={presentation}
          />
        )}
      </div>
    </div>
  );
}

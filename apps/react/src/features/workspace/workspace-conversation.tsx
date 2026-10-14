import { Link, useNavigate } from '@tanstack/react-router';
import { useId, useLayoutEffect, useRef } from 'react';
import { store } from '@/store';
import { selectAgentSession } from '@/store/agent-session/agent-session-selectors';
import { selectChatAgentState } from '@/store/chat-state/chat-state-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { retainedChatTranscriptsSet } from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { MarkdownViewer, type MarkdownViewerProps } from '@/components/markdown/markdown-viewer';
import { ThinkingBlock } from '@/features/chat/components/thinking-block';
import { ResponseGroup } from '@/features/chat/components/response-group';
import { ConversationTurnGap } from '@/features/chat/components/conversation-turn-gap';
import { LiveStreamPhaseIndicator } from '@/features/chat/components/live-stream-phase-indicator';
import { LoadingState, EmptyState, ErrorState } from '@/components/patterns/screen';
import { buttonVariants } from '@/components/ui/button';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { ContentBlock } from '$shared/types';
import { getContentBlockText } from '$shared/utils/content-block-helpers';
import { formatNumber } from '$lib/i18n/format';
import { parseIntentLink } from '$shared/utils/intent-link-parser';
import { m } from '$shared/paraglide/messages.js';

type Navigation = Pick<
  MarkdownViewerProps,
  'workspaceContext' | 'onOpenLink' | 'onOpenFile' | 'onOpenNote'
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
        <h2 ref={heading} tabIndex={-1} className="break-words">
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
            {m.chat_longRunningDebug_messages_label()} {formatNumber(session.messages.length)} /{' '}
            {formatNumber(chat.transcriptSnapshot?.totalMessages ?? session.messages.length)}
          </output>
          {session.messages.length === 0 ? (
            <EmptyState description={m.ui_list_empty_label()} />
          ) : (
            <div
              className="grid max-h-[70vh] min-w-0 gap-4 overflow-y-auto px-1"
              data-testid="conversation-messages"
            >
              {session.messages.map((message) => (
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
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

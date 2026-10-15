import { EventWakeupBanner } from '@/features/chat/components/event-wakeup-banner';
import { isEventWakeMessage } from '$lib/components/chat/event-wake-summary';
import { useId, useState, type ReactNode } from 'react';
import { AgentMessageAttributionHeader } from '@/features/chat/components/agent-message-attribution-header';
import { AutomatedWakeCardHeader } from '@/features/chat/components/automated-wake-card-header';
import { ConversationTurnGap } from '@/features/chat/components/conversation-turn-gap';
import { MarkdownViewer, type MarkdownViewerProps } from '@/components/markdown/markdown-viewer';
import { getAutomatedWakePresentation } from '$lib/components/chat/automated-wake-presentation';
import { SUBSCRIPTION_WAKE_BODY_PADDING_CLASS } from '$lib/components/chat/subscription-disclosure-classes';
import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
import {
  degradeLegacyFileBlocks,
  getPresentedUserMessageText,
} from '$lib/utils/user-message-presentation';
import { getConversationUserText } from './message-copy-text';
import { m } from '$shared/paraglide/messages.js';
import type { AgentMessage, ContentBlock } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { WorkspaceMessageActions } from './workspace-message-link';

type Navigation = Pick<
  MarkdownViewerProps,
  'workspaceContext' | 'onOpenLink' | 'onOpenFile' | 'onOpenNote' | 'canLoadMedia'
>;

/** Read-only transcript composition; canonical metadata owns sender identity and display text. */
export function WorkspaceConversationMessage({
  message,
  workspaceId,
  ownerAgentId,
  ownerPrincipalId,
  readCopyMessage,
  navigation,
  onOpenAgent,
  renderContent,
}: {
  message: AgentMessage;
  workspaceId: string;
  ownerAgentId?: string;
  ownerPrincipalId?: string;
  readCopyMessage?: () => { message: AgentMessage; ownerPrincipalId?: string } | null;
  navigation: Navigation;
  onOpenAgent: (workspaceId: string, agentId: string) => void;
  renderContent: (blocks: ContentBlock[]) => ReactNode;
}) {
  const eventWake = isEventWakeMessage(message);
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const candidate = message.role === 'user' ? getAgentMessageAttribution(message.metadata) : null;
  // Chief and PR wake presentation remain separate integration slices.
  const attribution = candidate?.kind === 'agent' ? candidate : null;
  const wake = getAutomatedWakePresentation(message);
  const connectedWake = wake?.kind === 'script' || wake?.kind === 'hook' ? wake : null;
  return (
    <article
      tabIndex={-1}
      className="min-w-0 focus-visible:outline focus-visible:outline-ring"
      data-message-id={message.id}
      data-message-role={message.role}
      data-sender-agent-id={attribution?.fromAgentId}
    >
      {eventWake ? (
        <EventWakeupBanner
          key={`${workspaceId}:${message.id}`}
          message={message}
          workspaceId={workspaceId}
          onOpenAgent={onOpenAgent}
        />
      ) : attribution ? (
        <>
          <AgentMessageAttributionHeader
            key={`${workspaceId}:${attribution.fromAgentId}`}
            attribution={attribution}
            expanded={expanded}
            controlsId={bodyId}
            ontoggle={() => setExpanded((value) => !value)}
            workspaceId={WorkspaceId(workspaceId)}
            onOpenAssistantAgentFromEvent={(_event, ownerWorkspaceId, senderId) => {
              onOpenAgent(ownerWorkspaceId, senderId);
              return true;
            }}
            onOpenLink={async (url, context) => {
              await navigation.onOpenLink(url, context);
            }}
          />
          {expanded && (
            <div
              id={bodyId}
              className="min-w-0 border-t border-border px-3 py-2"
              data-testid="agent-message-expanded-body"
            >
              <MarkdownViewer
                {...navigation}
                content={getPresentedUserMessageText(message, ownerPrincipalId)}
                renderRichFencesAsCode
              />
              {renderContent(
                degradeLegacyFileBlocks(message.contentBlocks).filter(
                  (block) => block.type !== 'text',
                ),
              )}
            </div>
          )}
        </>
      ) : connectedWake ? (
        <>
          <AutomatedWakeCardHeader
            presentation={connectedWake}
            expanded={expanded}
            controlsId={bodyId}
            ontoggle={() => setExpanded((value) => !value)}
            onOpenLink={async (url, context) => {
              await navigation.onOpenLink(url, context);
            }}
          />
          {expanded && (
            <div
              id={bodyId}
              className={`min-w-0 overflow-hidden border-t border-border ${SUBSCRIPTION_WAKE_BODY_PADDING_CLASS}`}
              data-testid={`${connectedWake.kind}-wake-expanded-body`}
            >
              <span className="whitespace-pre-wrap">{connectedWake.bodyText}</span>
              {connectedWake.kind === 'script' &&
                connectedWake.attribution.matchedLine !== undefined && (
                  <>
                    <p className="type-caption text-muted-foreground">
                      {m.chat_scriptMonitor_untrusted_description()}
                    </p>
                    <pre className="whitespace-pre-wrap break-all font-mono">
                      {connectedWake.attribution.matchedLine}
                    </pre>
                  </>
                )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="type-caption mb-2 text-muted-foreground">
            {message.role === 'user'
              ? m.tiptap_attributionGutter_user_label()
              : message.role === 'assistant'
                ? m.chat_agentThread_assistant_label()
                : message.role}
          </p>
          {renderContent(
            message.role === 'user'
              ? [
                  {
                    type: 'text',
                    text: getConversationUserText(message, ownerPrincipalId),
                  },
                  ...degradeLegacyFileBlocks(message.contentBlocks).filter(
                    (block) => block.type !== 'text',
                  ),
                ]
              : (message.contentBlocks ?? []),
          )}
        </>
      )}
      {!eventWake &&
        !candidate &&
        !wake &&
        ownerAgentId &&
        readCopyMessage &&
        (message.role === 'user' || message.role === 'assistant') &&
        Number.isSafeInteger(message.seq) &&
        message.seq! >= 0 &&
        !message.provisional && (
          <WorkspaceMessageActions
            key={`${workspaceId}:${ownerAgentId}:${message.id}`}
            workspaceId={workspaceId}
            agentId={ownerAgentId}
            message={message}
            readCurrent={readCopyMessage}
          />
        )}
      <ConversationTurnGap
        currentIsEventNotification={eventWake || message.role === 'system'}
        currentHasAssistantMessages={message.role === 'assistant'}
        nextIsEventNotification={false}
      />
    </article>
  );
}

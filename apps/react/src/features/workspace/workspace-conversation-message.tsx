import { useId, useState, type ReactNode } from 'react';
import { AgentMessageAttributionHeader } from '@/features/chat/components/agent-message-attribution-header';
import { ConversationTurnGap } from '@/features/chat/components/conversation-turn-gap';
import { MarkdownViewer, type MarkdownViewerProps } from '@/components/markdown/markdown-viewer';
import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
import {
  degradeLegacyFileBlocks,
  getPresentedUserMessageText,
} from '$lib/utils/user-message-presentation';
import { m } from '$shared/paraglide/messages.js';
import type { AgentMessage, ContentBlock } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';

type Navigation = Pick<
  MarkdownViewerProps,
  'workspaceContext' | 'onOpenLink' | 'onOpenFile' | 'onOpenNote' | 'canLoadMedia'
>;

/** Read-only transcript composition; canonical metadata owns sender identity and display text. */
export function WorkspaceConversationMessage({
  message,
  workspaceId,
  navigation,
  onOpenAgent,
  renderBlock,
}: {
  message: AgentMessage;
  workspaceId: string;
  navigation: Navigation;
  onOpenAgent: (workspaceId: string, agentId: string) => void;
  renderBlock: (block: ContentBlock, index: number) => ReactNode;
}) {
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const candidate = message.role === 'user' ? getAgentMessageAttribution(message.metadata) : null;
  // Chief and automated wake presentation remain separate integration slices.
  const attribution = candidate?.kind === 'agent' ? candidate : null;
  return (
    <article
      tabIndex={-1}
      className="min-w-0 focus-visible:outline focus-visible:outline-ring"
      data-message-id={message.id}
      data-message-role={message.role}
      data-sender-agent-id={attribution?.fromAgentId}
    >
      {attribution ? (
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
                content={getPresentedUserMessageText(message)}
                renderRichFencesAsCode
              />
              {degradeLegacyFileBlocks(message.contentBlocks)
                .filter((block) => block.type !== 'text')
                .map(renderBlock)}
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
          {(message.contentBlocks ?? []).map(renderBlock)}
        </>
      )}
      <ConversationTurnGap
        currentIsEventNotification={message.role === 'system'}
        currentHasAssistantMessages={message.role === 'assistant'}
        nextIsEventNotification={false}
      />
    </article>
  );
}

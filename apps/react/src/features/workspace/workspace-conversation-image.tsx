import { useEffect, useState } from 'react';
import { store } from '@/store';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectAgentSession } from '@/store/agent-session/agent-session-selectors';
import { hasNodeOwnedAgentPath } from '$shared/utils/agent-node';
import { backendRequest } from '@/features/backend/backend-transport';
import { createAttachmentImageRead } from '$lib/client/live/backend-attachment-image-read';
import { ChatImageBlock } from '@/features/chat/components/chat-image-block';
import { MediaLoadingPlaceholder } from '@/components/ui/media-loading-placeholder';
import { MediaUnavailable } from '@/components/ui/media-unavailable';
import { m } from '$shared/paraglide/messages.js';
import type { AgentMessage } from '$shared/types';

function canReadImage(workspaceId: string, agentId: string, authority: string) {
  const agent = selectAgentSession.select(store.state, agentId);
  return (
    !!agent &&
    !hasNodeOwnedAgentPath(agent) &&
    selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) === authority
  );
}

/** DOM media lifetime, not a second transcript/attachment cache. */
function AdmittedImage({
  workspaceId,
  attachmentId,
  agentId,
  authority,
  role,
}: {
  workspaceId: string;
  attachmentId: string;
  agentId: string;
  authority: string;
  role: AgentMessage['role'];
}) {
  const [image, setImage] = useState<{ src: string; name: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    const admittedRequest: typeof backendRequest = (method, params, options) => {
      controller.signal.throwIfAborted();
      if (!canReadImage(workspaceId, agentId, authority))
        throw new Error('Attachment read authority retired');
      return backendRequest(method, params, options);
    };
    void createAttachmentImageRead(admittedRequest)(workspaceId, attachmentId, controller.signal)
      .then(({ data, attachment }) => {
        if (controller.signal.aborted || !canReadImage(workspaceId, agentId, authority)) return;
        url = URL.createObjectURL(new Blob([data], { type: attachment.mimeType }));
        setImage({ src: url, name: attachment.fileName });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [workspaceId, attachmentId, agentId, authority]);
  const name = m.chat_imageBlock_fromAgent_alt();
  return (
    <div data-attachment-id={attachmentId}>
      {image ? (
        <ChatImageBlock
          variant={role === 'user' ? 'user-attachment' : 'default'}
          src={image.src}
          mimeType="image/png"
          alt={image.name}
          showActionsMenu={false}
          onOpenLink={() => false}
        />
      ) : failed ? (
        <MediaUnavailable name={name} reason="load-failed" onOpenLink={() => false} />
      ) : (
        <MediaLoadingPlaceholder name={name} />
      )}
    </div>
  );
}

export function WorkspaceConversationImage({
  workspaceId,
  attachmentId,
  agentId,
  role,
}: {
  workspaceId: string;
  attachmentId: string;
  agentId: string;
  role: AgentMessage['role'];
}) {
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const agent = selectAgentSession(agentId).value;
  return authority && agent && !hasNodeOwnedAgentPath(agent) ? (
    <AdmittedImage
      key={`${workspaceId}:${agentId}:${attachmentId}:${authority}`}
      workspaceId={workspaceId}
      attachmentId={attachmentId}
      agentId={agentId}
      authority={authority}
      role={role}
    />
  ) : (
    <MediaUnavailable
      name={m.chat_imageBlock_fromAgent_alt()}
      reason="unsupported"
      onOpenLink={() => false}
    />
  );
}

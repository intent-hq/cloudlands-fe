import { useEffect, useState } from 'react';
import { store } from '@/store';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectAgentSession } from '@/store/agent-session/agent-session-selectors';
import { hasNodeOwnedAgentPath } from '$shared/utils/agent-node';
import { backendRequest } from '@/features/backend/backend-transport';
import { createAttachmentMediaRead } from '$lib/client/live/backend-attachment-image-read';
import { ChatVideoBlock } from '@/features/chat/components/chat-video-block';
import { ChatImageBlock } from '@/features/chat/components/chat-image-block';
import { MediaLoadingPlaceholder } from '@/components/ui/media-loading-placeholder';
import { MediaUnavailable } from '@/components/ui/media-unavailable';
import { m } from '$shared/paraglide/messages.js';
import type { AgentMessage } from '$shared/types';

function canReadMedia(workspaceId: string, agentId: string, authority: string) {
  const agent = selectAgentSession.select(store.state, agentId);
  return (
    !!agent &&
    !hasNodeOwnedAgentPath(agent) &&
    selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) === authority
  );
}

/** DOM media lifetime, not a second transcript/attachment cache. */
function AdmittedMedia({
  workspaceId,
  attachmentId,
  agentId,
  authority,
  role,
  mimeType,
}: {
  workspaceId: string;
  attachmentId: string;
  agentId: string;
  authority: string;
  role: AgentMessage['role'];
  mimeType: 'image/png' | 'image/jpeg' | 'video/mp4';
}) {
  const [media, setMedia] = useState<{ src: string; name: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    const admittedRequest: typeof backendRequest = (method, params, options) => {
      controller.signal.throwIfAborted();
      if (!canReadMedia(workspaceId, agentId, authority))
        throw new Error('Attachment read authority retired');
      return backendRequest(method, params, options);
    };
    void createAttachmentMediaRead(admittedRequest, mimeType)(
      workspaceId,
      attachmentId,
      controller.signal,
    )
      .then(({ data, attachment }) => {
        if (controller.signal.aborted || !canReadMedia(workspaceId, agentId, authority)) return;
        url = URL.createObjectURL(new Blob([data], { type: attachment.mimeType }));
        setMedia({ src: url, name: attachment.fileName });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [workspaceId, attachmentId, agentId, authority, mimeType]);
  const name =
    mimeType === 'video/mp4'
      ? m.chat_videoBlock_fromAgent_label()
      : m.chat_imageBlock_fromAgent_alt();
  return (
    <div data-attachment-id={attachmentId}>
      {media ? (
        mimeType === 'video/mp4' ? (
          <ChatVideoBlock
            source={{ kind: 'remote', url: media.src, mimeType }}
            name={media.name}
            showActionsMenu={false}
            allowFileMedia={false}
            canLoadMedia={(url) =>
              url === media.src && canReadMedia(workspaceId, agentId, authority)
            }
            onOpenLink={() => false}
          />
        ) : (
          <ChatImageBlock
            variant={role === 'user' ? 'user-attachment' : 'default'}
            src={media.src}
            mimeType={mimeType}
            alt={media.name}
            showActionsMenu={false}
            onOpenLink={() => false}
          />
        )
      ) : failed ? (
        <MediaUnavailable name={name} reason="load-failed" onOpenLink={() => false} />
      ) : (
        <MediaLoadingPlaceholder name={name} />
      )}
    </div>
  );
}

export function WorkspaceConversationMedia({
  workspaceId,
  attachmentId,
  agentId,
  role,
  mimeType,
}: {
  workspaceId: string;
  attachmentId: string;
  agentId: string;
  role: AgentMessage['role'];
  mimeType: 'image/png' | 'image/jpeg' | 'video/mp4';
}) {
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const agent = selectAgentSession(agentId).value;
  return authority && agent && !hasNodeOwnedAgentPath(agent) ? (
    <AdmittedMedia
      key={`${workspaceId}:${agentId}:${attachmentId}:${authority}:${mimeType}`}
      workspaceId={workspaceId}
      attachmentId={attachmentId}
      agentId={agentId}
      authority={authority}
      role={role}
      mimeType={mimeType}
    />
  ) : (
    <MediaUnavailable
      name={
        mimeType === 'video/mp4'
          ? m.chat_videoBlock_fromAgent_label()
          : m.chat_imageBlock_fromAgent_alt()
      }
      reason="unsupported"
      onOpenLink={() => false}
    />
  );
}

import { useLayoutEffect, useRef, useState } from 'react';
import { CopyIcon, LinkIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { writeTextToClipboard } from '@/lib/clipboard';
import { conversationMessageUrl } from '$shared/constants/intent-links';
import { m } from '$shared/paraglide/messages.js';
import type { AgentMessage } from '$shared/types';
import { getCopyableMessageText } from './message-copy-text';

type CurrentMessage = { message: AgentMessage; ownerPrincipalId?: string };

/** Clipboard feedback belongs to this mounted row, never to a replacement conversation. */
export function WorkspaceMessageActions({
  workspaceId,
  agentId,
  message,
  readCurrent,
}: {
  workspaceId: string;
  agentId: string;
  message: AgentMessage;
  readCurrent: () => CurrentMessage | null;
}) {
  return (
    <div className="grid w-full max-w-sm grid-cols-2 gap-2">
      <MessageCopyAction
        kind="text"
        revision={message}
        read={() => {
          const current = readCurrent();
          if (!current) return null;
          const text = getCopyableMessageText(current.message, current.ownerPrincipalId);
          return {
            text,
            isCurrent: () => {
              const latest = readCurrent();
              return (
                latest?.message === current.message &&
                latest.ownerPrincipalId === current.ownerPrincipalId
              );
            },
          };
        }}
      />
      <MessageCopyAction
        kind="link"
        revision={message}
        read={() =>
          readCurrent()
            ? {
                text: conversationMessageUrl(workspaceId, agentId, message.id),
                isCurrent: () => !!readCurrent(),
              }
            : null
        }
      />
    </div>
  );
}

function MessageCopyAction({
  kind,
  revision,
  read,
}: {
  kind: 'text' | 'link';
  revision: AgentMessage;
  read: () => { text: string | null; isCurrent: () => boolean } | null;
}) {
  const [feedback, setFeedback] = useState<{
    revision: AgentMessage;
    status: 'pending' | 'copied' | 'failed' | 'unavailable';
  } | null>(null);
  const status = feedback?.revision === revision ? feedback.status : 'idle';
  const lifetime = useRef<object | null>(null);
  const pending = useRef(false);
  useLayoutEffect(() => {
    const token = {};
    lifetime.current = token;
    return () => {
      if (lifetime.current === token) lifetime.current = null;
    };
  }, [revision]);
  async function copy() {
    const token = lifetime.current;
    if (!token || pending.current) return;
    const value = read();
    if (!value) return;
    if (value.text === null) {
      setFeedback({ revision, status: 'unavailable' });
      return;
    }
    pending.current = true;
    setFeedback({ revision, status: 'pending' });
    try {
      await writeTextToClipboard(value.text);
      if (lifetime.current === token && value.isCurrent())
        setFeedback({ revision, status: 'copied' });
    } catch {
      if (lifetime.current === token && value.isCurrent())
        setFeedback({ revision, status: 'failed' });
    } finally {
      pending.current = false;
      if (lifetime.current === token && !value.isCurrent()) setFeedback(null);
    }
  }
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Button
        variant="ghost"
        size="sm"
        aria-disabled={status === 'pending'}
        aria-busy={status === 'pending'}
        onClick={() => void copy()}
      >
        {kind === 'text' ? <CopyIcon aria-hidden="true" /> : <LinkIcon aria-hidden="true" />}
        {kind === 'text'
          ? m.react_workspace_messageText_copy_label()
          : m.react_workspace_messageLink_copy_label()}
      </Button>
      <output className="type-caption min-h-5 text-muted-foreground" aria-live="polite">
        {status === 'copied'
          ? kind === 'text'
            ? m.react_workspace_messageText_copied_label()
            : m.react_workspace_messageLink_copied_label()
          : status === 'failed'
            ? m.react_workspace_messageLink_failed_description()
            : status === 'unavailable'
              ? m.react_workspace_messageText_unavailable_description()
              : status === 'pending'
                ? m.react_workspace_messageLink_pending_label()
                : null}
      </output>
    </div>
  );
}

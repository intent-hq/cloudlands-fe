import { useLayoutEffect, useRef, useState } from 'react';
import { LinkIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { writeTextToClipboard } from '@/lib/clipboard';
import { conversationMessageUrl } from '$shared/constants/intent-links';
import { m } from '$shared/paraglide/messages.js';

/** Clipboard feedback belongs to this mounted row, never to a replacement conversation. */
export function WorkspaceMessageLink({
  workspaceId,
  agentId,
  messageId,
  isCurrent,
}: {
  workspaceId: string;
  agentId: string;
  messageId: string;
  isCurrent: () => boolean;
}) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle');
  const lifetime = useRef<object | null>(null);
  const pending = useRef(false);
  useLayoutEffect(() => {
    const token = {};
    lifetime.current = token;
    pending.current = false;
    return () => {
      if (lifetime.current === token) lifetime.current = null;
    };
  }, []);
  async function copy() {
    const token = lifetime.current;
    if (!token || pending.current || !isCurrent()) return;
    pending.current = true;
    setStatus('pending');
    try {
      await writeTextToClipboard(conversationMessageUrl(workspaceId, agentId, messageId));
      if (lifetime.current === token && isCurrent()) setStatus('copied');
    } catch {
      if (lifetime.current === token && isCurrent()) setStatus('failed');
    } finally {
      if (lifetime.current === token) pending.current = false;
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        aria-disabled={status === 'pending'}
        aria-busy={status === 'pending'}
        onClick={() => void copy()}
      >
        <LinkIcon aria-hidden="true" />
        {m.react_workspace_messageLink_copy_label()}
      </Button>
      <output className="type-caption text-muted-foreground" aria-live="polite">
        {status === 'copied'
          ? m.react_workspace_messageLink_copied_label()
          : status === 'failed'
            ? m.react_workspace_messageLink_failed_description()
            : status === 'pending'
              ? m.react_workspace_messageLink_pending_label()
              : null}
      </output>
    </div>
  );
}

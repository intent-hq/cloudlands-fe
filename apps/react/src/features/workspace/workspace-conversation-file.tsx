import { useId, useLayoutEffect, useRef, useState } from 'react';
import { FileIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { store } from '@/store';
import {
  resolveFileAttachmentRequested,
  fileAttachmentReleased,
} from '../../../../../src/store/renderer/slices/files/files-slice';
import { formatFileSize } from '$lib/utils/file-utils';
import { m } from '$shared/paraglide/messages.js';

/** Source user-file chip, backed by the canonical files saga rather than a component fetch. */
export function WorkspaceConversationFile({
  workspaceId,
  agentId,
  attachmentId,
  name,
  size,
  mimeType,
  onOpen,
}: {
  workspaceId: string;
  agentId: string;
  attachmentId: string;
  name: string;
  size?: number;
  mimeType: string;
  onOpen: (path: string, attachmentId: string) => void;
}) {
  const consumer = useId();
  const lifetime = useRef(0);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    lifetime.current += 1;
    return () => {
      lifetime.current += 1;
      store.dispatch(fileAttachmentReleased(consumer));
    };
  }, [consumer, workspaceId, attachmentId, agentId]);
  const secondary = [typeof size === 'number' ? formatFileSize(size) : null, mimeType]
    .filter(Boolean)
    .join(' • ');
  return (
    <div className="min-w-0" data-attachment-id={attachmentId}>
      <Button
        type="button"
        variant="plain"
        disabled={pending}
        data-testid="chat-message-file-chip"
        title={m.chat_chatMessage_openAttachment_title({ name })}
        className="type-caption flex max-w-full cursor-pointer items-center gap-1.5 rounded border border-border bg-muted/50 px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => {
          const owner = lifetime.current;
          setPending(true);
          setFailed(false);
          const request = resolveFileAttachmentRequested(
            workspaceId,
            attachmentId,
            agentId,
            consumer,
          );
          store.dispatch(request);
          void request.promise
            .then((path) => {
              if (path && lifetime.current === owner) onOpen(path, attachmentId);
            })
            .catch(() => {
              if (lifetime.current === owner) setFailed(true);
            })
            .finally(() => {
              if (lifetime.current === owner) setPending(false);
            });
        }}
      >
        <FileIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="max-w-[150px] truncate">{name}</span>
        <span className="shrink-0">{secondary}</span>
      </Button>
      {failed && <p role="alert">{m.chat_chatMessage_attachmentOpenFailed_error({ name })}</p>}
    </div>
  );
}

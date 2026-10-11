// Source: src/lib/components/ui/message-composer/queued-row.svelte.
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the source draggable row's explicit Enter/F2 edit and Delete/reorder keyboard contract. */
import type { DragEvent, KeyboardEvent } from 'react';
import { QueueIcon, ImageIcon, XIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { menuItem } from '@/components/ui/menu';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import { getLocale } from '$shared/paraglide/runtime.js';
import { createFormatters } from '$shared/i18n/formatters';
import type { QueuedMessage } from './types';

const { formatNumber } = createFormatters(getLocale);

export default function QueuedRow({
  item,
  compact = false,
  onEdit,
  onRemove,
  onMove,
  onReorder,
}: {
  item: QueuedMessage;
  compact?: boolean;
  onEdit: (item: QueuedMessage) => void;
  onRemove: (item: QueuedMessage) => void;
  onMove: (item: QueuedMessage, direction: -1 | 1) => void;
  onReorder: (sourceId: string, targetId: string) => void;
}) {
  const label =
    item.text ||
    (item.files.length === 1
      ? m.ui_messageComposer_attachments_one({ count: formatNumber(item.files.length) })
      : m.ui_messageComposer_attachments_many({ count: formatNumber(item.files.length) }));

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      onEdit(item);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove(item);
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      onMove(item, event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  function handleDragstart(event: DragEvent) {
    event.dataTransfer.setData('text/message-composer-queue-id', item.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/message-composer-queue-id');
    if (sourceId && sourceId !== item.id) onReorder(sourceId, item.id);
  }

  return (
    <li
      data-message-composer-queue=""
      data-queued-id={item.id}
      className={cn(
        menuItem(),
        'group/qrow cursor-grab select-none gap-2 px-2.5 text-muted-foreground hover:bg-hover active:cursor-grabbing',
        compact ? 'h-7 text-[13px]' : 'h-8 text-sm',
      )}
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-2 focus-visible:outline focus-visible:-outline-offset-1"
        role="button"
        tabIndex={0}
        draggable
        aria-label={label}
        onKeyDown={handleKeydown}
        onDoubleClick={() => onEdit(item)}
        onDragStart={handleDragstart}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <QueueIcon size={13} className="shrink-0" aria-hidden="true" />
        {item.files.length > 0 && (
          <span
            className="flex shrink-0 items-center gap-0.5 text-muted-foreground"
            aria-hidden="true"
          >
            <ImageIcon size={13} aria-hidden="true" />
            {item.text && <span className="tabular-nums">{formatNumber(item.files.length)}</span>}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </div>
      <Button
        variant="ghost-light"
        size="icon-xs"
        iconOnly
        aria-label={m.chat_queuedMessages_remove_tooltip()}
        className="opacity-0 group-hover/qrow:opacity-100 group-focus-within/qrow:opacity-100"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(item);
        }}
      >
        <XIcon size={13} weight="regular" aria-hidden="true" />
      </Button>
    </li>
  );
}

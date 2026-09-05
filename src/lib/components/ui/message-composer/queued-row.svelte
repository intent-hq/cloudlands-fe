<script lang="ts">
  import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { QueuedMessage } from './types';

  let {
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
  } = $props();

  const label = $derived(
    item.text || `${item.files.length} attachment${item.files.length === 1 ? '' : 's'}`,
  );

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
    event.dataTransfer?.setData('text/message-composer-queue-id', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const sourceId = event.dataTransfer?.getData('text/message-composer-queue-id');
    if (sourceId && sourceId !== item.id) onReorder(sourceId, item.id);
  }
</script>

<li
  data-message-composer-queue
  data-queued-id={item.id}
  class="group/qrow flex cursor-grab select-none items-center gap-2 rounded-(--radius-medium) bg-muted px-2.5 text-foreground/85 outline-none active:cursor-grabbing focus-visible:ring-1 focus-visible:ring-ring"
  class:h-7={compact}
  class:h-8={!compact}
  class:text-xs={compact}
  class:text-[13px]={!compact}
>
  <div
    class="flex min-w-0 flex-1 items-center gap-2 outline-none"
    role="button"
    tabindex="0"
    draggable="true"
    aria-label={label}
    onkeydown={handleKeydown}
    ondblclick={() => onEdit(item)}
    ondragstart={handleDragstart}
    ondragover={(event) => event.preventDefault()}
    ondrop={handleDrop}
  >
    {#if item.files.length > 0}
      <span class="flex shrink-0 items-center gap-0.5 text-muted-foreground" aria-hidden="true">
        <ImageIcon size={13} aria-hidden="true" />
        {#if item.text}<span class="tabular-nums">{item.files.length}</span>{/if}
      </span>
    {/if}
    <span class="min-w-0 flex-1 truncate">{label}</span>
  </div>
  <Button
    variant="ghost-light"
    size="icon-xs"
    iconOnly
    aria-label={m.chat_queuedMessages_remove_tooltip()}
    class="opacity-0 group-hover/qrow:opacity-100 group-focus-within/qrow:opacity-100"
    onpointerdown={(event) => event.stopPropagation()}
    onclick={(event) => {
      event.stopPropagation();
      onRemove(item);
    }}
  >
    <XIcon size={13} weight="bold" aria-hidden="true" />
  </Button>
</li>

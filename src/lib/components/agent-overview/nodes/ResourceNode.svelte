<script lang="ts">
  import Fa from 'svelte-fa';
  import { faEye, faFile, faPen } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { FileNode, NoteNode } from '../types';

  interface Props {
    node: FileNode | NoteNode;
    access: 'read' | 'write';
    additions?: number;
    deletions?: number;
    isActive?: boolean;
    lastActivityAt?: string;
    onclick?: (event: MouseEvent) => void;
    ondblclick?: (event: MouseEvent) => void;
    onpointerdown?: (event: PointerEvent) => void;
    onpointermove?: (event: PointerEvent) => void;
    onpointerup?: (event: PointerEvent) => void;
    onpointercancel?: (event: PointerEvent) => void;
    onmouseenter?: () => void;
    onmouseleave?: () => void;
    onfocus?: () => void;
    onblur?: () => void;
  }

  let {
    node,
    access,
    additions = 0,
    deletions = 0,
    isActive = false,
    lastActivityAt,
    ...events
  }: Props = $props();

  const label = $derived(node.type === 'file' ? node.fileName : node.title);
  const accessLabel = $derived(
    access === 'read' ? m.chat_toolClassifier_read_label() : m.chat_toolClassifier_writeTo_label(),
  );
</script>

<button
  type="button"
  class="resource-node flex max-w-44 touch-none items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-left shadow-xs backdrop-blur-sm transition-opacity hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 {isActive
    ? 'ring-1 ring-primary/30'
    : ''}"
  data-graph-node
  data-node-id={node.id}
  data-active={isActive}
  data-last-activity-at={lastActivityAt}
  {...events}
>
  <span class="shrink-0 text-subtle"
    ><Fa icon={node.type === 'file' ? faFile : faNote} size="xs" /></span
  >
  <span class="min-w-0 flex-1">
    <span class="block truncate text-xs font-medium text-foreground">{label}</span>
    <span class="flex items-center gap-1 text-xs text-subtle">
      <Fa icon={access === 'read' ? faEye : faPen} size="xs" />
      <span>{accessLabel}</span>
    </span>
  </span>
  {#if access === 'write'}
    <LineChangesBadge {additions} {deletions} size="xxs" />
  {/if}
</button>

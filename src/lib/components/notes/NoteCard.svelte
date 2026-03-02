<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faThumbtack,
    faArchive,
    faTrash,
    faEdit,
    faEllipsisVertical,
    faCalendar,
    faUser,
    faHashtag,
  } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    note: any;
    selected?: boolean;
    variant?: 'list' | 'grid' | 'timeline';
    formatDate: (date: string) => string;
    onselect?: () => void;
    onedit?: () => void;
    ondelete?: () => void;
    onpin?: () => void;
    onarchive?: () => void;
  }

  let {
    note,
    selected = false,
    variant = 'list',
    formatDate,
    onselect,
    onedit,
    ondelete,
    onpin,
    onarchive,
  }: Props = $props();

  let showMenu = $state(false);

  function handleSelect() {
    onselect?.();
  }

  function handleEdit(e: Event) {
    e.stopPropagation();
    onedit?.();
  }

  function handleDelete(e: Event) {
    e.stopPropagation();
    ondelete?.();
  }

  function handlePin(e: Event) {
    e.stopPropagation();
    onpin?.();
  }

  function handleArchive(e: Event) {
    e.stopPropagation();
    onarchive?.();
  }

  function toggleMenu(e: Event) {
    e.stopPropagation();
    showMenu = !showMenu;
  }

  function truncateContent(content: string, maxLength: number) {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }
</script>

{#if variant === 'list'}
  <div
    class="p-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm
			{selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30'}"
    onclick={handleSelect}
    onkeydown={(e) => e.key === 'Enter' && handleSelect()}
    role="button"
    tabindex="0"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          {#if note.isPinned}
            <Fa icon={faThumbtack} size="xs" class="text-primary" />
          {/if}
          <h3 class="font-medium truncate">{note.title}</h3>
        </div>

        <p class="text-sm text-subtle mb-2 line-clamp-2">
          {truncateContent(note.content, 150)}
        </p>

        <div class="flex items-center gap-3 text-xs text-subtle">
          <span class="flex items-center gap-1">
            <Fa icon={faUser} size="xs" />
            {note.author.name}
          </span>
          <span class="flex items-center gap-1">
            <Fa icon={faCalendar} size="xs" />
            {formatDate(note.updatedAt)}
          </span>
          {#if note.tags.length > 0}
            <span class="flex items-center gap-1">
              <Fa icon={faHashtag} size="xs" />
              {note.tags.length}
            </span>
          {/if}
        </div>
      </div>

      <div class="relative">
        <button class="p-1 rounded hover:bg-muted" onclick={toggleMenu} aria-label="Note options">
          <Fa icon={faEllipsisVertical} size="sm" />
        </button>

        {#if showMenu}
          <div class="absolute right-0 top-8 w-40 bg-background border rounded-md shadow-lg z-10">
            <button
              class="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
              onclick={handleEdit}
            >
              <Fa icon={faEdit} size="xs" />
              Edit
            </button>
            <button
              class="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
              onclick={handlePin}
            >
              <Fa icon={faThumbtack} size="xs" />
              {note.isPinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              class="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
              onclick={handleArchive}
            >
              <Fa icon={faArchive} size="xs" />
              {note.isArchived ? 'Unarchive' : 'Archive'}
            </button>
            <hr class="my-1" />
            <button
              class="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-red-500"
              onclick={handleDelete}
            >
              <Fa icon={faTrash} size="xs" />
              Delete
            </button>
          </div>
        {/if}
      </div>
    </div>

    {#if note.tags.length > 0}
      <div class="flex items-center gap-1 mt-2 flex-wrap">
        {#each note.tags.slice(0, 3) as tag, tagIndex (`tag-${tagIndex}-${tag}`)}
          <span class="px-2 py-0.5 text-xs bg-muted rounded-full">
            #{tag}
          </span>
        {/each}
        {#if note.tags.length > 3}
          <span class="text-xs text-subtle">
            +{note.tags.length - 3}
          </span>
        {/if}
      </div>
    {/if}
  </div>
{:else if variant === 'grid'}
  <div
    class="p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md h-48 flex flex-col
			{selected ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30'}"
    onclick={handleSelect}
    onkeydown={(e) => e.key === 'Enter' && handleSelect()}
    role="button"
    tabindex="0"
  >
    <div class="flex items-start justify-between mb-2">
      <h3 class="font-medium truncate flex-1">{note.title}</h3>
      {#if note.isPinned}
        <Fa icon={faThumbtack} size="xs" class="text-primary" />
      {/if}
    </div>

    <p class="text-sm text-subtle flex-1 overflow-hidden mb-2 line-clamp-4">
      {truncateContent(note.content, 200)}
    </p>

    <div class="flex items-center justify-between text-xs text-subtle">
      <span>{formatDate(note.updatedAt)}</span>
      {#if note.tags.length > 0}
        <span class="flex items-center gap-1">
          <Fa icon={faHashtag} size="xs" />
          {note.tags.length}
        </span>
      {/if}
    </div>
  </div>
{:else if variant === 'timeline'}
  <div
    class="flex gap-3 p-3 rounded-lg cursor-pointer transition-all hover:bg-muted/50
			{selected ? 'bg-primary/5' : ''}"
    onclick={handleSelect}
    onkeydown={(e) => e.key === 'Enter' && handleSelect()}
    role="button"
    tabindex="0"
  >
    <div class="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0"></div>
    <div class="flex-1">
      <div class="flex items-center gap-2 mb-1">
        {#if note.isPinned}
          <Fa icon={faThumbtack} size="xs" class="text-primary" />
        {/if}
        <h3 class="font-medium">{note.title}</h3>
        <span class="text-xs text-subtle">
          {formatDate(note.updatedAt)}
        </span>
      </div>

      <p class="text-sm text-subtle line-clamp-2">
        {truncateContent(note.content, 200)}
      </p>

      {#if note.tags.length > 0}
        <div class="flex items-center gap-1 mt-2">
          {#each note.tags.slice(0, 3) as tag, tagIndex (`tag-${tagIndex}-${tag}`)}
            <span class="px-2 py-0.5 text-xs bg-muted rounded-full">
              #{tag}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

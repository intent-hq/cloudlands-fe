<script lang="ts">
  import {
    resolveEditorFallbackIcon,
    resolveEditorIcon,
  } from '$lib/components/shared/icons/editor-icon';
  import { SettingsFieldRow } from '$lib/components/ui/settings-field-row';
  import { Switch } from '$lib/components/ui/switch';
  import {
    selectHiddenEditorIds,
    selectInstalledEditors,
  } from '$store/renderer/slices/external-editors/external-editors-selectors';
  import {
    fetchEditors,
    setEditorOrder,
    toggleHiddenEditor,
    type InstalledEditor,
  } from '$store/renderer/slices/external-editors/external-editors-slice';

  import { faGripLines } from '@fortawesome/free-solid-svg-icons';
  import { onDestroy, onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  const installedEditors$ = selectInstalledEditors();
  const hiddenEditorIds$ = selectHiddenEditorIds();

  const installedEditors = $derived($installedEditors$.filter((editor) => editor.installed));
  let draggedEditorId = $state<string | null>(null);
  let dragOverEditorId = $state<string | null>(null);
  let dragOverPosition = $state<'before' | 'after' | null>(null);
  let dragPreviewElement: HTMLElement | null = null;
  let reorderAnnouncement = $state('');

  onMount(() => {
    appStore.dispatch(fetchEditors());
  });

  onDestroy(() => {
    handleDragEnd();
  });

  function isEditorEnabled(editorId: string) {
    return !$hiddenEditorIds$.includes(editorId);
  }

  function handleEditorToggle(editorId: string, enabled: boolean) {
    if (isEditorEnabled(editorId) !== enabled) {
      appStore.dispatch(toggleHiddenEditor(editorId));
    }
  }

  function getEditorIcon(editor: InstalledEditor) {
    return resolveEditorIcon(editor);
  }

  function reorderEditor(
    editorId: string,
    targetEditorId: string,
    position: 'before' | 'after' = 'before',
  ) {
    const editorIds = installedEditors.map((editor) => editor.id);
    const sourceIndex = editorIds.indexOf(editorId);
    const targetIndex = editorIds.indexOf(targetEditorId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

    let insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
    editorIds.splice(sourceIndex, 1);
    if (sourceIndex < insertionIndex) insertionIndex -= 1;
    editorIds.splice(insertionIndex, 0, editorId);
    appStore.dispatch(setEditorOrder(editorIds));

    const editor = installedEditors.find(({ id }) => id === editorId);
    if (editor) {
      reorderAnnouncement = m.settings_openInApps_reorderAnnouncement({
        name: editor.name,
        position: insertionIndex + 1,
      });
    }
  }

  function moveEditor(editorId: string, direction: -1 | 1) {
    const currentIndex = installedEditors.findIndex(({ id }) => id === editorId);
    const target = installedEditors[currentIndex + direction];
    if (target) reorderEditor(editorId, target.id, direction === -1 ? 'before' : 'after');
  }

  function handleReorderKeydown(event: KeyboardEvent, editorId: string) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    moveEditor(editorId, event.key === 'ArrowUp' ? -1 : 1);
  }

  function handleDragStart(event: DragEvent, editorId: string) {
    draggedEditorId = editorId;
    dragOverEditorId = null;
    dragOverPosition = null;
    event.dataTransfer?.setData('text/plain', editorId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      const row = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>(
        '[data-editor-id]',
      );
      if (row && typeof event.dataTransfer.setDragImage === 'function') {
        const rowRect = row.getBoundingClientRect();
        const getDragImageOffset = (coordinate: number, start: number, size: number) =>
          Number.isFinite(coordinate) &&
          size > 0 &&
          coordinate >= start &&
          coordinate <= start + size
            ? coordinate - start
            : size / 2;
        const offsetX = getDragImageOffset(event.clientX, rowRect.left, rowRect.width);
        const offsetY = getDragImageOffset(event.clientY, rowRect.top, rowRect.height);
        dragPreviewElement?.remove();
        dragPreviewElement = row.cloneNode(true) as HTMLElement;
        dragPreviewElement.removeAttribute('data-editor-id');
        dragPreviewElement.setAttribute('data-editor-drag-preview', '');
        dragPreviewElement.setAttribute('aria-hidden', 'true');
        Object.assign(dragPreviewElement.style, {
          position: 'fixed',
          left: '-10000px',
          top: '-10000px',
          width: `${rowRect.width}px`,
          height: `${rowRect.height}px`,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          backgroundColor: 'hsl(var(--card))',
          opacity: '1',
        });
        document.body.append(dragPreviewElement);
        event.dataTransfer.setDragImage(dragPreviewElement, offsetX, offsetY);
      }
    }
  }

  function getDropPosition(event: DragEvent, row: HTMLElement): 'before' | 'after' {
    const rect = row.getBoundingClientRect();
    const clientY = Number.isFinite(event.clientY) ? event.clientY : rect.top;
    return clientY <= rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function handleDragOver(event: DragEvent, editorId: string) {
    if (!draggedEditorId) return;
    if (draggedEditorId === editorId) {
      dragOverEditorId = null;
      dragOverPosition = null;
      return;
    }
    event.preventDefault();
    dragOverEditorId = editorId;
    dragOverPosition = getDropPosition(event, event.currentTarget as HTMLElement);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(event: DragEvent, targetEditorId: string) {
    event.preventDefault();
    const editorId = draggedEditorId ?? event.dataTransfer?.getData('text/plain');
    const position =
      dragOverEditorId === targetEditorId && dragOverPosition
        ? dragOverPosition
        : getDropPosition(event, event.currentTarget as HTMLElement);
    if (editorId) reorderEditor(editorId, targetEditorId, position);
    handleDragEnd();
  }

  function handleDragEnd() {
    draggedEditorId = null;
    dragOverEditorId = null;
    dragOverPosition = null;
    dragPreviewElement?.remove();
    dragPreviewElement = null;
  }
</script>

<div class="min-w-0 space-y-1" data-open-in-apps>
  {#if installedEditors.length === 0}
    <p class="type-body py-3 text-muted-foreground">{m.settings_openInApps_empty()}</p>
  {:else}
    {#each installedEditors as editor (editor.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions (keyboard reordering is on the nested button) -->
      <div
        data-editor-id={editor.id}
        data-dragging={draggedEditorId === editor.id || undefined}
        data-drag-over={dragOverEditorId === editor.id || undefined}
        data-drop-position={dragOverEditorId === editor.id
          ? dragOverPosition || undefined
          : undefined}
        class="rounded-(--radius-small) transition-colors data-[dragging=true]:opacity-60"
        style:position="relative"
        ondragover={(event) => handleDragOver(event, editor.id)}
        ondrop={(event) => handleDrop(event, editor.id)}
      >
        {#if dragOverEditorId === editor.id && dragOverPosition}
          <div
            data-editor-insertion-line
            data-position={dragOverPosition}
            class="pointer-events-none right-2 left-2 z-10 h-0.5 rounded-full bg-primary"
            class:top-0={dragOverPosition === 'before'}
            class:bottom-0={dragOverPosition === 'after'}
            style:position="absolute"
          ></div>
        {/if}
        <SettingsFieldRow
          id={`open-in-${editor.id}`}
          htmlFor={`open-in-${editor.id}-switch`}
          label={editor.name}
          class="py-2.5 first:pt-2.5 last:pb-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-4"
        >
          {#snippet leading()}
            <div
              class="flex size-8 items-center justify-center overflow-hidden rounded-(--radius-small) bg-muted/50 text-muted-foreground"
            >
              {#if editor.iconBase64}
                <img src="data:image/png;base64,{editor.iconBase64}" alt="" class="size-5" />
              {:else if getEditorIcon(editor)}
                {@const Icon = getEditorIcon(editor)}
                <Icon size={16} />
              {:else}
                <Fa icon={resolveEditorFallbackIcon(editor.category)} class="w-4 h-4 opacity-60" />
              {/if}
            </div>
          {/snippet}
          {#snippet control({ labelId })}
            <div class="flex items-center gap-2">
              <button
                type="button"
                draggable="true"
                class="flex size-7 cursor-grab items-center justify-center rounded-(--radius-small) text-muted-foreground hover:bg-muted active:cursor-grabbing"
                aria-label={m.settings_openInApps_reorder_ariaLabel({ name: editor.name })}
                aria-keyshortcuts="ArrowUp ArrowDown"
                ondragstart={(event) => handleDragStart(event, editor.id)}
                ondragend={handleDragEnd}
                onkeydown={(event) => handleReorderKeydown(event, editor.id)}
              >
                <Fa icon={faGripLines} class="size-3.5" />
              </button>
              <Switch
                id={`open-in-${editor.id}-switch`}
                checked={isEditorEnabled(editor.id)}
                onCheckedChange={(enabled) => handleEditorToggle(editor.id, enabled)}
                size="sm"
                ariaLabelledby={labelId}
              />
            </div>
          {/snippet}
        </SettingsFieldRow>
      </div>
    {/each}
  {/if}
  <span class="sr-only" aria-live="polite">{reorderAnnouncement}</span>
</div>

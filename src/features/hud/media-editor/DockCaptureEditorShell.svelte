<script lang="ts">
  import type { Snippet } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { DestructiveConfirm } from '$lib/components/patterns/confirm';
  import { isMacPlatform } from '$lib/utils/shortcuts';
  import { isTextEntryTarget } from '$lib/utils/text-entry';

  /**
   * The capture editor's shell, the same for recordings and screenshots (Capture and
   * recording editor spec): a header with the title and the two actions, the main
   * area, and a fixed-width sidebar that stacks under the main area on narrow
   * windows. The kind's view fills `main` and `sidebar`.
   *
   * Save changes stays muted until there is an unsaved change. Cancel throws edits
   * away; Esc with unsaved changes asks once. Cmd+S saves; Cmd+Z / Shift+Cmd+Z undo
   * and redo. A view without saving yet passes no `onSave`, and no Save is shown.
   */
  let {
    title,
    subtitle,
    dirty = false,
    saving = false,
    onCancel,
    onSave,
    onUndo,
    onRedo,
    discardRequest = 0,
    onDiscardRequested,
    onKeepEditing,
    headerActions,
    main,
    sidebar,
  }: {
    title: string;
    subtitle?: string;
    dirty?: boolean;
    saving?: boolean;
    onCancel: () => void;
    onSave?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    /**
     * Increments when main asks before closing or switching would lose edits; the
     * shell asks the person, then calls `onDiscardRequested` or `onKeepEditing`.
     */
    discardRequest?: number;
    onDiscardRequested?: () => void;
    onKeepEditing?: () => void;
    headerActions?: Snippet;
    main: Snippet;
    sidebar?: Snippet;
  } = $props();

  let confirming = $state(false);
  /** The open question came from main (window close or a switch), not from Esc/Cancel. */
  let fromMain = false;
  let answered = 0;
  $effect(() => {
    const request = discardRequest;
    if (request <= answered) return;
    answered = request;
    fromMain = true;
    confirming = true;
  });

  function requestClose(): void {
    fromMain = false;
    if (dirty) confirming = true;
    else onCancel();
  }
  function keepEditing(): void {
    if (fromMain) onKeepEditing?.();
    fromMain = false;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || confirming) return;
    const mod = isMacPlatform() ? event.metaKey : event.ctrlKey;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
    } else if (mod && key === 's' && onSave) {
      event.preventDefault();
      if (dirty && !saving) onSave();
    } else if (mod && key === 'z' && !isTextEntryTarget(event.target)) {
      event.preventDefault();
      if (event.shiftKey) onRedo?.();
      else onUndo?.();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="capture-editor" data-testid="capture-editor">
  <header class="header">
    <div class="titles">
      <h1 class="title">{title}</h1>
      {#if subtitle}<span class="subtitle">{subtitle}</span>{/if}
    </div>
    <div class="actions">
      {@render headerActions?.()}
      <Button variant="ghost" size="sm" onclick={requestClose}
        >{m.dock_captureEditor_cancel_label()}</Button
      >
      {#if onSave}
        <Button
          variant={dirty ? 'primary' : 'secondary'}
          size="sm"
          disabled={!dirty || saving}
          data-save
          onclick={() => onSave?.()}>{m.dock_captureEditor_save_label()}</Button
        >
      {/if}
    </div>
  </header>
  <div class="body" data-has-sidebar={!!sidebar || undefined}>
    <main class="main">{@render main()}</main>
    {#if sidebar}<aside class="sidebar">{@render sidebar()}</aside>{/if}
  </div>
</div>

<DestructiveConfirm
  bind:open={confirming}
  title={m.dock_captureEditor_discard_title()}
  confirmLabel={m.dock_captureEditor_discard_label()}
  cancelLabel={m.dock_captureEditor_keepEditing_label()}
  onConfirm={() => {
    confirming = false;
    if (fromMain) onDiscardRequested?.();
    else onCancel();
    fromMain = false;
  }}
  onCancel={keepEditing}
/>

<style>
  .capture-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }
  /* The window's own title bar: draggable, clear of the traffic lights. */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 48px;
    padding: 0 12px 0 84px;
    border-bottom: 1px solid hsl(var(--border));
    -webkit-app-region: drag;
  }
  .titles {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }
  .subtitle {
    overflow: hidden;
    font-size: 12px;
    color: hsl(var(--muted-foreground));
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    -webkit-app-region: no-drag;
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    flex: 1;
    min-height: 0;
  }
  .body[data-has-sidebar] {
    grid-template-columns: minmax(0, 1fr) 300px;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .sidebar {
    min-height: 0;
    overflow: auto;
    border-left: 1px solid hsl(var(--border));
  }
  /* Narrow windows: the sidebar moves below the main area instead of narrowing. */
  @media (max-width: 900px) {
    .body[data-has-sidebar] {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
      overflow: auto;
    }
    .sidebar {
      border-left: 0;
      border-top: 1px solid hsl(var(--border));
    }
  }
</style>

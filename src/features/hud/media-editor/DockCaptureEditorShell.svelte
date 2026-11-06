<script lang="ts">
  import type { Snippet } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { FormDialog } from '$lib/components/patterns/confirm';
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
    saveBlocked = false,
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
    sidebarWidth = 300,
    sidebarLayout = 'panel',
    actionsPlacement = 'header',
  }: {
    title: string;
    subtitle?: string;
    dirty?: boolean;
    saving?: boolean;
    /** Save stays in place but cannot run (an edit still open, or unsupported output). */
    saveBlocked?: boolean;
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
    /** The sidebar card's width in CSS pixels (a slim rail for screenshots). */
    sidebarWidth?: number;
    /**
     * `panel` (a full sidebar) stacks under the media in narrow windows; `rail` (a slim
     * column of chips) always stays on the right.
     */
    sidebarLayout?: 'panel' | 'rail';
    /**
     * `header`: the title and actions sit in the top strip. `sidebar`: no visible header
     * (the title stays for assistive tech, a slim strip keeps the window draggable) and
     * the actions are pinned at the bottom of a flat sidebar.
     */
    actionsPlacement?: 'header' | 'sidebar';
  } = $props();
  const footerActions = $derived(actionsPlacement === 'sidebar' && !!sidebar);

  // A generated file name ("clip-1a2b3c4d.mp4") says nothing the title does not; a name
  // the person gave stays.
  const shownSubtitle = $derived(
    subtitle &&
      !/^(clip|screenshot|recording|capture(-original|-retake)?)-[0-9a-f-]+\.(mp4|mov|webm|png|jpe?g|webp)$/i.test(
        subtitle.trim(),
      )
      ? subtitle
      : undefined,
  );

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
      if (dirty && !saving && !saveBlocked) onSave();
    } else if (mod && key === 'z' && !isTextEntryTarget(event.target)) {
      event.preventDefault();
      if (event.shiftKey) onRedo?.();
      else onUndo?.();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet actions()}
  <div class="actions">
    {#if !footerActions}{@render headerActions?.()}{/if}
    <Button variant="ghost" size="default" onclick={requestClose}
      >{m.dock_captureEditor_cancel_label()}</Button
    >
    {#if onSave}
      <Button
        variant={dirty ? 'primary' : 'secondary'}
        size="default"
        disabled={!dirty || saving || saveBlocked}
        data-save
        onclick={() => onSave?.()}>{m.dock_captureEditor_save_label()}</Button
      >
    {/if}
  </div>
{/snippet}

<div
  class="capture-editor"
  data-testid="capture-editor"
  data-footer-actions={footerActions || undefined}
>
  {#if footerActions}
    <!-- No visible header: a slim strip keeps the window draggable; the title is for
         assistive tech only. -->
    <header class="drag-strip">
      <h1 class="sr-only">{title}</h1>
    </header>
  {:else}
    <header class="header">
      <div class="titles">
        <h1 class="title">{title}</h1>
        {#if shownSubtitle}<span class="subtitle">{shownSubtitle}</span>{/if}
      </div>
      {@render actions()}
    </header>
  {/if}
  <div
    class="body"
    data-has-sidebar={!!sidebar || undefined}
    data-sidebar-layout={sidebar ? sidebarLayout : undefined}
    style:--sidebar-width={`${sidebarWidth}px`}
  >
    <main class="main">{@render main()}</main>
    {#if sidebar}
      <aside class="sidebar" data-flat={footerActions || undefined}>
        {#if footerActions}
          <div class="sidebar-scroll">{@render sidebar()}</div>
          <footer class="sidebar-footer">
            {#if headerActions}<div class="footer-tools">{@render headerActions()}</div>{/if}
            {@render actions()}
          </footer>
        {:else}
          {@render sidebar()}
        {/if}
      </aside>
    {/if}
  </div>
</div>

<FormDialog
  size="sm"
  class="max-w-90 [&_[data-slot=dialog-header]]:px-5 [&_[data-slot=dialog-header]]:pt-5 [&_[data-slot=dialog-title]]:text-base [&_[data-slot=dialog-footer]]:p-5"
  showCloseButton={false}
  dismissOnInteractOutside={false}
  focusCancel
  enterKey="ignore"
  modEnter="ignore"
  submitVariant="destructive"
  bind:open={confirming}
  title={m.dock_captureEditor_discard_title()}
  description={m.dock_captureEditor_discard_description()}
  submitLabel={m.dock_captureEditor_discard_label()}
  cancelLabel={m.dock_captureEditor_keepEditing_label()}
  onSubmit={() => {
    confirming = false;
    if (fromMain) onDiscardRequested?.();
    else onCancel();
    fromMain = false;
  }}
  onCancel={keepEditing}
/>

<style>
  /*
   * A media tool, not a document: the window is one surface, the media sits in a
   * rounded inset panel that takes most of it, and the sidebar is a card beside it.
   * The top strip is the window's drag area (no native buttons), with a quiet title
   * and the two actions.
   */
  .capture-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 40px;
    flex: none;
    padding: 0 10px 0 16px;
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
    font-size: 12px;
    font-weight: 500;
    color: hsl(var(--muted-foreground));
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
  .drag-strip {
    height: 14px;
    flex: none;
    -webkit-app-region: drag;
  }
  /* Flat sidebar: no card, no border; its content scrolls, the actions stay put. */
  .sidebar[data-flat] {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .sidebar-scroll {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .sidebar-footer {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
    flex: none;
    padding: 12px 4px 0;
  }
  .sidebar-footer .actions {
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .footer-tools {
    padding-bottom: 12px;
    border-bottom: 1px solid hsl(var(--border));
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    flex: 1;
    min-height: 0;
    padding: 0 10px 10px;
  }
  .body[data-has-sidebar] {
    grid-template-columns: minmax(0, 1fr) var(--sidebar-width, 300px);
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--radius-large);
    background: hsl(var(--muted) / 0.55);
  }
  .sidebar {
    min-height: 0;
    overflow: auto;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--card));
  }
  /* Narrow windows: a full sidebar moves below the media instead of narrowing it. */
  @media (max-width: 900px) {
    .body[data-sidebar-layout='panel'] {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
      overflow: auto;
    }
  }
  /*
   * Stacked with its actions in the sidebar: the media keeps most of the height and the
   * sidebar gets a bounded share that scrolls inside, so a long transcript can never
   * push Save and Cancel out of reach.
   */
  @media (max-width: 900px) {
    .capture-editor[data-footer-actions] .body[data-sidebar-layout='panel'] {
      grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
      overflow: hidden;
    }
  }
</style>

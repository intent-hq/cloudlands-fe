<script lang="ts">
  import { tick } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faFile, faArrowRotateRight } from '$lib/icons/phosphor-icons';
  import DockComposerIcon from './DockComposerIcon.svelte';
  import AttachmentPreview from '$lib/components/chat/AttachmentPreview.svelte';
  import { springIn, crispOut } from '$lib/motion';
  import type {
    DockComposerAttachment,
    DockComposerAttachmentsProps,
  } from './dock-composer-media-presentation';

  let {
    items,
    labels,
    disabled = false,
    onMarkUp,
    onRemove,
    onRetry,
  }: DockComposerAttachmentsProps = $props();
  // Screenshots, then the clip, then attached files (pasted or dropped images included).
  const rank = (item: DockComposerAttachment) =>
    item.owner === 'attachment' ? 2 : { image: 0, clip: 1, file: 2 }[item.kind];
  const ordered = $derived([...items].sort((a, b) => rank(a) - rank(b)));
  let row = $state<HTMLDivElement | null>(null);
  let open = $state(false);
  let selectedId = $state<string | null>(null);
  let opener: HTMLElement | null = null;
  const selected = $derived(items.find((item) => item.id === selectedId));
  $effect(() => {
    if (!selected || (selected.kind === 'image' && !imageReady(selected))) open = false;
  });

  function imageReady(item: DockComposerAttachment): boolean {
    return (
      item.kind === 'image' &&
      item.status !== 'placing' &&
      item.status !== 'failed' &&
      item.url.trim().length > 0
    );
  }

  function label(item: DockComposerAttachment): string {
    if (item.kind === 'image') return labels.image(item.markCount);
    if (item.kind === 'clip') return labels.clip(item.duration);
    return item.name;
  }
  function show(item: DockComposerAttachment, source: HTMLElement): void {
    if (
      disabled ||
      item.kind === 'file' ||
      (item.kind === 'image' && !imageReady(item)) ||
      (item.kind === 'clip' && (!item.url || item.recording))
    )
      return;
    opener = source;
    selectedId = item.id;
    open = true;
  }
  async function remove(id: string): Promise<void> {
    if (disabled) return;
    if (selectedId === id) open = false;
    onRemove(id);
    await tick();
    if (!document.activeElement || document.activeElement === document.body) {
      row?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }
  function markup(id: string): void {
    const item = items.find((candidate) => candidate.id === id);
    if (disabled || !item || !imageReady(item)) return;
    open = false;
    onMarkUp(id);
  }
  function deleteKey(event: KeyboardEvent, id: string): void {
    if (event.key !== 'Delete' || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    void remove(id);
  }
</script>

{#if ordered.length}
  <div
    bind:this={row}
    class="attachment-row"
    role="group"
    aria-label={labels.attachments}
    data-dock-media-attachments
  >
    {#each ordered as item (item.id)}
      {#if item.kind === 'image' && item.file}
        <div
          class="file-image"
          data-kind="file"
          data-attachment-id={item.id}
          in:springIn={{ tier: 'fast', y: 3, scale: 0.98 }}
          out:crispOut={{ tier: 'fast' }}
        >
          <AttachmentPreview
            id={item.id}
            name={item.file.name}
            type={item.file.imageMimeType}
            imageData={item.file.imageData}
            imageMimeType={item.file.imageMimeType}
            onRemove={disabled ? undefined : (id) => void remove(id)}
            variant="thumbnail"
            placementStatus={item.status}
            placementError={item.error}
            {onRetry}
          />
        </div>
      {:else}
        {@const previewPending =
          item.kind === 'image' && !imageReady(item) && item.status !== 'failed'}
        <div
          class="tile"
          data-kind={item.kind}
          data-attachment-id={item.id}
          aria-busy={previewPending || undefined}
          in:springIn={{ tier: 'fast', y: 3, scale: 0.98 }}
          out:crispOut={{ tier: 'fast' }}
        >
          {#if item.kind === 'file'}
            <!-- A focusable tile so Delete removes it; files have no preview to open. -->
            <Button
              type="button"
              variant="ghost"
              wrapContent={false}
              class="open-tile file"
              aria-label={item.name}
              {disabled}
              onkeydown={(event) => deleteKey(event, item.id)}
            >
              <Fa icon={faFile} size={20} /><span>{item.name}</span>
            </Button>
          {:else if item.kind !== 'image' || imageReady(item)}
            <Button
              type="button"
              variant="ghost"
              wrapContent={false}
              class="open-tile"
              aria-label={label(item)}
              disabled={disabled || (item.kind === 'clip' && (item.recording || !item.url))}
              onkeydown={(event) => deleteKey(event, item.id)}
              onclick={(event) => {
                if (event.currentTarget instanceof HTMLElement) show(item, event.currentTarget);
              }}
            >
              {#if item.kind === 'image'}<img src={item.url} alt="" draggable="false" />
              {:else}<span class="clip"
                  ><span class="record-dot" aria-hidden="true"></span><span class="duration"
                    >{item.duration}</span
                  ></span
                >{/if}
            </Button>
          {/if}
          {#if item.status || previewPending}
            <span
              class="attachment-status"
              data-failed={item.status === 'failed' || undefined}
              role={item.status === 'failed' ? 'alert' : 'status'}
              title={item.error}
            >
              {item.status === 'failed'
                ? (item.error ?? labels.attachmentFailed)
                : labels.attachmentPending}
            </span>
          {/if}
          <div class="tile-actions">
            {#if item.status === 'failed' && onRetry}
              <Button
                variant="primary"
                size="icon-sm"
                class="tile-action"
                {disabled}
                aria-label={labels.retry}
                tooltip={labels.retry}
                onclick={() => onRetry?.(item.id)}
              >
                <Fa icon={faArrowRotateRight} size={16} />
              </Button>
            {:else if imageReady(item)}
              <Button
                variant="primary"
                size="icon-sm"
                class="tile-action"
                {disabled}
                aria-label={labels.markUp}
                tooltip={labels.markUp}
                onclick={() => markup(item.id)}
              >
                <DockComposerIcon glyph="pencil" />
              </Button>
            {:else if item.kind === 'clip' && !item.recording && item.url}
              <Button
                variant="primary"
                size="icon-sm"
                class="tile-action"
                {disabled}
                aria-label={labels.play}
                tooltip={labels.play}
                onclick={(event) => {
                  if (event.currentTarget instanceof HTMLElement) show(item, event.currentTarget);
                }}
              >
                <DockComposerIcon glyph="play" />
              </Button>
            {/if}
            <Button
              variant="secondary"
              size="icon-sm"
              class="tile-action"
              {disabled}
              aria-label={labels.remove}
              tooltip={labels.remove}
              onclick={() => remove(item.id)}
            >
              <DockComposerIcon glyph="x" />
            </Button>
          </div>
        </div>
      {/if}
    {/each}
  </div>
{/if}

<ContentDialog
  bind:open
  title={selected ? label(selected) : labels.attachments}
  size="wide"
  showCloseButton={false}
  onCloseAutoFocus={(event) => {
    event.preventDefault();
    if (opener?.isConnected) opener.focus();
    else row?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }}
>
  {#if selected && selected.kind !== 'file'}
    <div class="media-viewer">
      {#if selected.kind === 'image' && imageReady(selected)}
        <img src={selected.url} alt={label(selected)} draggable="false" />
      {:else if selected.kind === 'clip' && selected.url}
        <!-- svelte-ignore a11y_media_has_caption -- user-provided capture; no caption track exists. -->
        <video src={selected.url} controls playsinline aria-label={label(selected)}></video>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    {#if selected && selected.kind !== 'file'}
      {#if imageReady(selected)}
        <Button variant="primary" {disabled} onclick={() => selected && markup(selected.id)}
          >{labels.markUp}</Button
        >
      {/if}
      <Button variant="secondary" {disabled} onclick={() => selected && remove(selected.id)}
        >{labels.remove}</Button
      >
      <Button
        variant="ghost-light"
        onclick={() => {
          open = false;
        }}>{labels.done}</Button
      >
    {/if}
  {/snippet}
</ContentDialog>

<style>
  .attachment-row {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    /* No inline padding: the first tile starts on the editor text edge. */
    padding: 2px 0 8px;
    scrollbar-width: thin;
  }
  .file-image {
    flex: 0 0 auto;
  }
  .tile {
    position: relative;
    flex: 0 0 96px;
    height: 62px;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--secondary));
  }
  .tile :global(.open-tile) {
    display: block;
    width: 100%;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    cursor: pointer;
  }
  .tile :global(.open-tile:disabled) {
    cursor: default;
  }
  .tile :global(.open-tile img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .tile-actions {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    /* Spec: hover dims the tile to 55% black; the design-system ink (#080808) token. */
    background: hsl(var(--capture-active-foreground) / 0.55);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--spring-fast) var(--spring-fast-ease);
  }
  .attachment-status {
    position: absolute;
    inset-inline: 0;
    bottom: 0;
    padding: 2px 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-caption-size);
    background: hsl(var(--background));
    color: hsl(var(--muted-foreground));
    pointer-events: none;
  }
  .attachment-status[data-failed] {
    color: hsl(var(--danger));
  }
  .tile:hover .tile-actions,
  .tile:focus-within .tile-actions {
    opacity: 1;
  }
  /* The uncovered tile still opens the full-size view. Only actions intercept clicks. */
  .tile:hover .tile-actions :global(button),
  .tile:focus-within .tile-actions :global(button) {
    pointer-events: auto;
  }
  .tile-actions :global(.tile-action) {
    width: 28px;
    min-width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 8px;
  }
  .tile :global(.file),
  .clip {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    gap: 6px;
  }
  .tile :global(.file) {
    flex-direction: column;
    padding: 6px;
    color: hsl(var(--muted-foreground));
  }
  .tile :global(.file span) {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-caption-size);
  }
  .record-dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: hsl(var(--capture-active));
  }
  .duration {
    font-size: var(--text-caption-size);
    font-variant-numeric: tabular-nums;
  }
  .media-viewer {
    min-width: 0;
    overflow: auto;
    max-height: 70dvh;
  }
  .media-viewer img,
  .media-viewer video {
    display: block;
    width: 100%;
    height: auto;
    max-height: 65dvh;
    object-fit: contain;
  }
  .tile :global(.open-tile:focus-visible) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: -2px;
  }
  @media (hover: none) {
    .tile-actions {
      opacity: 1;
    }
    .tile-actions :global(button) {
      pointer-events: auto;
    }
  }
  @container style(--motion-reduced: 1) {
    .tile-actions {
      transition: none;
    }
  }
</style>

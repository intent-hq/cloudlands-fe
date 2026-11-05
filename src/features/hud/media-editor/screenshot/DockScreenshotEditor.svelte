<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { screenshotKindLabel } from './screenshot-labels';
  import { m } from '$shared/paraglide/messages.js';
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { createScreenshotPreviewRenderer } from './screenshot-preview';
  import { dockMediaGeometryRect } from '$shared/dock-media-edit';
  import {
    numberDockMediaMarks,
    type DockMediaEdit,
    type DockMediaSource,
    type DockMediaGeometry,
    type DockMediaEditMark,
  } from '$shared/dock-media-edit';
  import type { DockMarkGeometry } from '$shared/dock-evidence';
  import { dockGeometryRect } from '$shared/dock-annotation';
  import ScreenshotCanvas, {
    type ScreenshotTool,
    type ScreenshotShape,
  } from './ScreenshotCanvas.svelte';
  import ScreenshotTools from './ScreenshotTools.svelte';
  import ScreenshotMarkNotes from './ScreenshotMarkNotes.svelte';
  import ScreenshotHeaderActions from './ScreenshotHeaderActions.svelte';
  import { cropScreenshotEdit } from './screenshot-edit-geometry';
  import { screenshotContains } from './screenshot-geometry';

  let {
    source,
    sourceUrl,
    draft,
    onChange,
    selectedMarkId = $bindable(null),
    disabled = false,
    retaking = false,
    dictatingId = null,
    notePreview = null,
    onNoteManualEdit,
    onNoteBlur,
    onRetake,
    onNoteDictation,
    children,
  }: {
    source: DockMediaSource;
    sourceUrl: string;
    draft: DockMediaEdit;
    onChange: (edit: DockMediaEdit) => void;
    selectedMarkId?: string | null;
    disabled?: boolean;
    retaking?: boolean;
    dictatingId?: string | null;
    notePreview?: { markId: string; text: string } | null;
    onNoteManualEdit?: (markId: string) => void;
    onNoteBlur?: (markId: string) => void;
    onRetake?: () => void | Promise<void>;
    onNoteDictation?: (id: string, phase: 'start' | 'stop') => void;
    children?: Snippet<[main: Snippet, sidebar: Snippet, headerActions: Snippet]>;
  } = $props();
  const renderPreview = createScreenshotPreviewRenderer();
  let previewUrl = $state<string | null>(null);
  let previewPending = $state(false);
  let previewFailed = $state(false);
  let previewRetry = $state(0);
  const visualKey = $derived(
    JSON.stringify({
      crop: draft.crop,
      blur: draft.blurRegions,
      marks: draft.marks.map((mark) => ({
        id: mark.id,
        geometry: mark.geometry,
        included: mark.included,
      })),
    }),
  );
  $effect(() => {
    const paintRevision = visualKey;
    const currentSource = source,
      currentEdit = untrack(() => draft),
      url = sourceUrl,
      attempt = previewRetry;
    if (currentSource.visuals !== 'clean') {
      previewUrl = null;
      previewPending = false;
      return;
    }
    let active = true;
    previewPending = true;
    previewFailed = false;
    void renderPreview(currentSource, currentEdit, url).then(
      (next) => {
        if (!active || attempt !== previewRetry || paintRevision !== visualKey) {
          URL.revokeObjectURL(next);
          return;
        }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = next;
        previewPending = false;
      },
      () => {
        if (active) {
          previewPending = false;
          previewFailed = true;
        }
      },
    );
    return () => {
      active = false;
    };
  });
  onDestroy(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
  let tool = $state<ScreenshotTool>('pointer');
  const blocked = $derived(disabled || retaking || source.visuals !== 'clean');
  const frame = $derived(draft.crop ?? { x: 0, y: 0, w: source.width, h: source.height });
  const numbered = $derived(numberDockMediaMarks(draft, source));
  const shapes = $derived<ScreenshotShape[]>([
    ...numbered.map(({ mark }) => ({
      id: mark.id,
      geometry: canvasGeometry(mark.geometry),
    })),
    ...draft.blurRegions.map((region) => ({
      id: region.id,
      geometry: { kind: 'rect' as const, x: region.x, y: region.y, w: region.w, h: region.h },
      blur: true,
    })),
  ]);
  const cards = $derived(
    numbered.map(({ n, mark }) => ({
      id: mark.id,
      n,
      kind: screenshotKindLabel(mark.kind),
      note: mark.note,
      ...(mark.geometry.kind === 'text' ? { text: mark.geometry.text } : {}),
      element:
        mark.kind === 'element'
          ? { path: mark.context.selector, name: mark.context.text ?? '' }
          : null,
    })),
  );
  $effect(() => {
    if (selectedMarkId && !shapes.some((s) => s.id === selectedMarkId)) selectedMarkId = null;
  });

  function canvasGeometry(geometry: DockMediaGeometry): DockMarkGeometry {
    if (geometry.kind === 'point' || geometry.kind === 'text')
      return { kind: 'rect', ...dockMediaGeometryRect(geometry) };
    return geometry;
  }
  function apply(next: DockMediaEdit) {
    if (!blocked) onChange(next);
  }
  function update(id: string, patch: Partial<DockMediaEditMark>) {
    apply({
      ...draft,
      marks: draft.marks.map((mark) => (mark.id === id ? { ...mark, ...patch } : mark)),
    });
  }
  function remove(id: string) {
    apply({
      ...draft,
      marks: draft.marks.filter((mark) => mark.id !== id),
      blurRegions: draft.blurRegions.filter((region) => region.id !== id),
    });
    selectedMarkId = null;
  }
  function transform(id: string, geometry: DockMarkGeometry) {
    const mark = draft.marks.find((mark) => mark.id === id);
    const b = dockGeometryRect(geometry);
    if (!screenshotContains(frame, b)) return;
    if (mark) {
      const old = mark.geometry;
      const next: DockMediaGeometry =
        old.kind === 'point'
          ? {
              ...old,
              x: old.x + b.x - dockGeometryRect(canvasGeometry(old)).x,
              y: old.y + b.y - dockGeometryRect(canvasGeometry(old)).y,
            }
          : old.kind === 'text'
            ? {
                ...old,
                x: b.x,
                y: b.y,
                fontSize: Math.max(
                  0.1,
                  old.fontSize *
                    (b.h !== dockMediaGeometryRect(old).h
                      ? b.h / Math.max(1, dockMediaGeometryRect(old).h)
                      : b.w / Math.max(1, dockMediaGeometryRect(old).w)),
                ),
              }
            : geometry;
      update(id, { geometry: next });
    } else
      apply({
        ...draft,
        blurRegions: draft.blurRegions.map((region) => (region.id === id ? { id, ...b } : region)),
      });
  }
  function draw(nextTool: ScreenshotTool, geometry: DockMarkGeometry) {
    if (blocked) return;
    const bounds = dockGeometryRect(geometry);
    if (!screenshotContains(frame, bounds)) return;
    if (nextTool === 'crop') {
      if (bounds.w < 2 || bounds.h < 2) return;
      apply(cropScreenshotEdit(draft, bounds));
      tool = 'pointer';
      return;
    }
    const id = crypto.randomUUID();
    if (nextTool === 'blur') {
      if (bounds.w < 2 || bounds.h < 2) return;
      apply({ ...draft, blurRegions: [...draft.blurRegions, { id, ...bounds }] });
      selectedMarkId = id;
      tool = 'pointer';
      return;
    }
    const kind: DockMediaEditMark['kind'] =
      nextTool === 'draw'
        ? 'draw'
        : nextTool === 'element'
          ? 'element'
          : nextTool === 'text'
            ? 'text'
            : nextTool === 'arrow'
              ? 'arrow'
              : 'box';
    if ((kind === 'box' || kind === 'element') && (bounds.w < 2 || bounds.h < 2)) return;
    const value: DockMediaGeometry =
      kind === 'text'
        ? {
            kind: 'text',
            x: bounds.x,
            y: bounds.y,
            text: m.dock_screenshotEditor_text(),
            fontSize: Math.max(
              0.1,
              Math.min(
                24,
                bounds.h / 1.4,
                bounds.w / Math.max(1, m.dock_screenshotEditor_text().length * 0.65),
              ),
            ),
          }
        : geometry;
    apply({
      ...draft,
      marks: [
        ...draft.marks,
        {
          id,
          atMs: 0,
          batchId: 'initial',
          source: 'editor',
          kind,
          included: true,
          geometry: value,
          label: screenshotKindLabel(kind),
          note: '',
          context: { selector: null, text: null, url: null },
        },
      ],
    });
    selectedMarkId = id;
    if (kind === 'text') tool = 'pointer';
  }
  function text(id: string, value: string) {
    const mark = draft.marks.find((m) => m.id === id);
    if (mark?.geometry.kind === 'text')
      update(id, { geometry: { ...mark.geometry, text: value }, label: value.slice(0, 2048) });
  }
</script>

{#snippet main()}
  <div class="main-view">
    <ScreenshotTools
      {tool}
      disabled={blocked}
      canDelete={!!selectedMarkId}
      onSelect={(next) => (tool = next)}
      onDelete={() => selectedMarkId && remove(selectedMarkId)}
    />
    <div class="image-view">
      {#if source.visuals !== 'clean'}<p class="type-caption notice">
          {m.dock_screenshotEditor_readonly()}
        </p>{/if}
      {#if previewPending}<p class="type-caption notice" role="status">
          {m.dock_screenshotEditor_preparing()}
        </p>{/if}
      {#if previewFailed}<p class="type-caption notice" role="alert">
          {m.dock_screenshotEditor_previewError()}
        </p>
        <Button variant="ghost" size="compact" onclick={() => previewRetry++}
          >{m.dock_screenshotEditor_retry()}</Button
        >{/if}
      {#if tool === 'crop'}<p class="type-caption notice">
          {m.dock_screenshotEditor_cropHint()}
        </p>{/if}
      <ScreenshotCanvas
        sourceUrl={source.visuals === 'clean' ? (previewUrl ?? '') : sourceUrl}
        raster={source.visuals === 'clean'}
        hidden={previewPending || previewFailed}
        width={source.width}
        height={source.height}
        {frame}
        {shapes}
        {tool}
        selectedId={selectedMarkId}
        disabled={blocked || previewPending || previewFailed}
        onSelect={(id) => (selectedMarkId = id)}
        onDraw={draw}
        onTransform={transform}
        onDelete={remove}
      />
    </div>
  </div>
{/snippet}
{#snippet sidebar()}
  <ScreenshotMarkNotes
    items={cards}
    selectedId={selectedMarkId}
    disabled={blocked}
    {dictatingId}
    {notePreview}
    {onNoteManualEdit}
    {onNoteBlur}
    onSelect={(id) => {
      selectedMarkId = id;
      tool = 'pointer';
    }}
    onNote={(id, note) => update(id, { note })}
    onText={text}
    onElement={(id, selector, value) => {
      const mark = draft.marks.find((mark) => mark.id === id);
      if (mark)
        update(id, {
          context: { ...mark.context, selector: selector || null, text: value || null },
        });
    }}
    onDelete={remove}
    onDictation={onNoteDictation}
  />
{/snippet}
{#snippet headerActions()}
  <ScreenshotHeaderActions
    cropping={tool === 'crop'}
    {retaking}
    disabled={blocked}
    onCrop={() => (tool = tool === 'crop' ? 'pointer' : 'crop')}
    {onRetake}
  />
{/snippet}
{#if children}
  {@render children(main, sidebar, headerActions)}
{:else}
  <div class="standalone" data-screenshot-editor>
    <div class="header">{@render headerActions()}</div>
    <div class="body">
      {@render main()}
      <div class="sidebar">{@render sidebar()}</div>
    </div>
  </div>
{/if}

<style>
  .main-view {
    display: flex;
    align-items: start;
    gap: 12px;
    min-width: 0;
    min-height: 0;
    padding: 16px;
  }
  .image-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    gap: 8px;
  }
  .notice {
    margin: 0;
    color: hsl(var(--muted-foreground));
    line-height: 1.5;
  }
  .standalone {
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    overflow: hidden;
  }
  .header {
    display: flex;
    justify-content: end;
    padding: 12px;
    border-bottom: 1px solid hsl(var(--border));
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
  }
  .sidebar {
    border-inline-start: 1px solid hsl(var(--border));
  }
  @media (max-width: 899px) {
    .body {
      grid-template-columns: minmax(0, 1fr);
    }
    .sidebar {
      border-inline-start: 0;
      border-top: 1px solid hsl(var(--border));
    }
  }
</style>

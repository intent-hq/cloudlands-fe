<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { screenshotKindLabel } from './screenshot-labels';
  import { m } from '$shared/paraglide/messages.js';
  import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
  import { layoutDockMediaMarks } from '$features/hud/composer/dock-media-render';
  import { captureEditorToolShortcut } from '../capture-editor-shortcuts';
  import { isTextEntryTarget } from '$lib/utils/text-entry';
  import { createScreenshotPreviewRenderer } from './screenshot-preview';
  import {
    dockMediaGeometryRect,
    dockMediaBlurStrokeBounds,
    transformDockMediaBlurStroke,
    transformDockMediaText,
    layoutDockMediaText,
    DOCK_MEDIA_BLUR_RADIUS,
    DOCK_MEDIA_OUTPUT_VERSION,
  } from '$shared/dock-media-edit';
  import {
    numberDockMediaMarks,
    type DockMediaEdit,
    type DockMediaSource,
    type DockMediaGeometry,
    type DockMediaEditMark,
    type DockMediaBlurStroke,
  } from '$shared/dock-media-edit';
  import type { DockMarkGeometry } from '$shared/dock-evidence';
  import { dockGeometryRect } from '$shared/dock-annotation';
  import { ensureDockAnnotationFont } from '$features/hud/composer/dock-annotation-font';
  import { dockAnnotationDisplayBounds } from '$features/hud/composer/dock-annotation-display';
  import ScreenshotCanvas, {
    type ScreenshotTool,
    type ScreenshotShape,
  } from './ScreenshotCanvas.svelte';
  import ScreenshotTools from './ScreenshotTools.svelte';
  import ScreenshotMarkRail from './ScreenshotMarkRail.svelte';
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
    onInteractionPending,
    admittedOutputVersion = 1,
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
    onInteractionPending?: (pending: boolean) => void;
    admittedOutputVersion?: number;
    onNoteDictation?: (id: string, phase: 'start' | 'stop') => void;
    children?: Snippet<[main: Snippet, sidebar: Snippet, headerActions: Snippet]>;
  } = $props();
  let cropCandidate = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let selectedIds = $state<string[]>([]);
  let selectionAnchor = $state<string | null>(null);
  let pendingTextMark = $state<DockMediaEditMark | null>(null);
  const displayDraft = $derived(
    pendingTextMark ? { ...draft, marks: [...draft.marks, pendingTextMark] } : draft,
  );
  let editingTextId = $state<string | null>(null);
  let textPreview = $state<{ id: string; value: string } | null>(null);
  let fontSettled = $state(false);
  onMount(() => {
    let active = true;
    void ensureDockAnnotationFont().then(() => {
      if (active) fontSettled = true;
    });
    return () => {
      active = false;
    };
  });
  const sourceIdentity = $derived(`${source.id}:${source.revision}`);
  let gesturePending = $state(false);
  let gesturePreview = $state<{ id: string; geometry: DockMarkGeometry } | null>(null);
  const brushRadius = DOCK_MEDIA_BLUR_RADIUS;
  const canCreateV2 = $derived(admittedOutputVersion === DOCK_MEDIA_OUTPUT_VERSION);
  $effect(() => {
    onInteractionPending?.(
      !!cropCandidate ||
        !!editingTextId ||
        gesturePending ||
        (source.visuals === 'clean' && (previewPending || displayedPreview?.key !== visualKey)),
    );
  });
  onDestroy(() => onInteractionPending?.(false));
  const previewEdit = $derived.by(() => {
    let edit = gesturePreview
      ? transformedEdit(gesturePreview.id, gesturePreview.geometry)
      : displayDraft;
    if (textPreview) {
      const { id, value } = textPreview;
      edit = {
        ...edit,
        marks: edit.marks.map((mark) =>
          mark.id === id && mark.geometry.kind === 'text'
            ? { ...mark, geometry: { ...mark.geometry, text: value } }
            : mark,
        ),
      };
    }
    return cropCandidate ? { ...edit, crop: null } : edit;
  });
  // eslint-disable-next-line intent/no-component-async-data-fetch -- per-editor local pixel painter; no domain request or shared state is loaded here
  const renderPreview = createScreenshotPreviewRenderer();
  let previewUrl = $state<string | null>(null);
  let previewPending = $state(false);
  let previewFailed = $state(false);
  let previewRetry = $state(0);
  type DisplayedPreview = { url: string; key: string; frameKey: string; redactionKey: string };
  let publishedPreview = $state<DisplayedPreview | null>(null);
  let displayedPreview = $state<DisplayedPreview | null>(null);
  const retiredUrls = new Set<string>();
  const redactionKey = $derived(
    JSON.stringify([previewEdit.blurRegions, previewEdit.blurStrokes ?? []]),
  );
  const frameReady = $derived(displayedPreview?.frameKey === frameKey);
  const redactionsReady = $derived(frameReady && displayedPreview?.redactionKey === redactionKey);
  function rasterReady(url: string) {
    if (publishedPreview?.url !== url) return;
    displayedPreview = publishedPreview;
    for (const retired of retiredUrls) URL.revokeObjectURL(retired);
    retiredUrls.clear();
  }
  const visualKey = $derived(
    JSON.stringify({
      crop: previewEdit.crop,
      blur: previewEdit.blurRegions,
      strokes: previewEdit.blurStrokes,
    }),
  );
  type PreviewJob = {
    source: DockMediaSource;
    edit: DockMediaEdit;
    url: string;
    key: string;
    frameKey: string;
    attempt: number;
    redactionKey: string;
    hiddenTextMarkId: string | null;
  };
  let queuedPreview: PreviewJob | null = null;
  let rendering = false;
  let destroyed = false;
  const frameKey = $derived(
    JSON.stringify([source.id, source.revision, sourceUrl, previewEdit.crop]),
  );
  // One renderer at a time, with only the newest queued gesture frame retained.
  async function drainPreview() {
    if (rendering) return;
    rendering = true;
    try {
      while (queuedPreview && !destroyed) {
        const job = queuedPreview;
        queuedPreview = null;
        try {
          const next = await renderPreview(job.source, job.edit, job.url, job.hiddenTextMarkId);
          // Decode before publishing, then keep the prior SVG frame until its load receipt.
          const image = new Image();
          image.src = next;
          try {
            await image.decode();
          } catch (error) {
            URL.revokeObjectURL(next);
            throw error;
          }
          const sameFrame = job.frameKey === frameKey && job.attempt === previewRetry;
          if (destroyed || !sameFrame || job.key !== visualKey) {
            URL.revokeObjectURL(next);
            continue;
          }
          if (previewUrl) retiredUrls.add(previewUrl);
          publishedPreview = {
            url: next,
            key: job.key,
            frameKey: job.frameKey,
            redactionKey: job.redactionKey,
          };
          previewUrl = next;
          if (job.key === visualKey) previewPending = false;
          previewFailed = false;
        } catch {
          if (!destroyed && job.key === visualKey && job.frameKey === frameKey) {
            previewPending = false;
            previewFailed = true;
          }
        }
      }
    } finally {
      rendering = false;
    }
  }
  $effect(() => {
    const key = visualKey,
      currentFrame = frameKey,
      currentSource = source,
      url = sourceUrl,
      attempt = previewRetry;
    if (currentSource.visuals !== 'clean') {
      previewPending = false;
      previewFailed = false;
      return;
    }
    previewPending = true;
    previewFailed = false;
    queuedPreview = {
      source: currentSource,
      // Pixels/redactions are asynchronous; marks paint synchronously above them.
      edit: untrack(() => ({ ...previewEdit, marks: [] })),
      hiddenTextMarkId: null,
      url,
      key,
      frameKey: currentFrame,
      attempt,
      redactionKey,
    };
    void drainPreview();
  });
  onDestroy(() => {
    destroyed = true;
    queuedPreview = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    for (const url of retiredUrls) URL.revokeObjectURL(url);
    retiredUrls.clear();
  });
  let tool = $state<ScreenshotTool>('pointer');
  const blocked = $derived(disabled || retaking || source.visuals !== 'clean');
  const frame = $derived(
    cropCandidate
      ? { x: 0, y: 0, w: source.width, h: source.height }
      : (draft.crop ?? { x: 0, y: 0, w: source.width, h: source.height }),
  );
  const numbered = $derived(numberDockMediaMarks(displayDraft, source));
  const annotationOps = $derived(
    fontSettled && source.visuals === 'clean'
      ? layoutDockMediaMarks(previewEdit, source, 0, editingTextId)
      : [],
  );
  const shapes = $derived<ScreenshotShape[]>([
    ...numbered.map(({ mark }) => ({
      id: mark.id,
      geometry: canvasGeometry(mark.geometry),
      ...(mark.geometry.kind === 'text'
        ? {
            text: {
              origin: { x: mark.geometry.x, y: mark.geometry.y },
              value: mark.geometry.text,
              fontSize: mark.geometry.fontSize,
              ...layoutDockMediaText(mark.geometry),
              wrapped: mark.geometry.style === 'sticky',
            },
          }
        : {}),
    })),
    ...(draft.blurStrokes ?? []).map((stroke) => ({
      id: stroke.id,
      geometry: { kind: 'rect' as const, ...dockMediaBlurStrokeBounds(stroke) },
      blur: true,
      blurStroke: stroke,
    })),
    ...draft.blurRegions.map((region) => ({
      id: region.id,
      geometry: { kind: 'rect' as const, x: region.x, y: region.y, w: region.w, h: region.h },
      blur: true,
    })),
  ]);
  const pendingRedactions = $derived<ScreenshotShape[]>([
    ...previewEdit.blurRegions.map((region) => ({
      id: region.id,
      geometry: { kind: 'rect' as const, x: region.x, y: region.y, w: region.w, h: region.h },
      blur: true,
    })),
    ...(previewEdit.blurStrokes ?? []).map((stroke) => ({
      id: stroke.id,
      geometry: { kind: 'rect' as const, ...dockMediaBlurStrokeBounds(stroke) },
      blurStroke: stroke,
      blur: true,
    })),
  ]);
  const cards = $derived([
    ...numbered.map(({ n, mark }) => ({ id: mark.id, n, kind: mark.kind })),
    ...draft.blurRegions.map(({ id }) => ({ id, n: null, kind: 'blur' as const })),
    ...(draft.blurStrokes ?? []).map(({ id }) => ({ id, n: null, kind: 'blur' as const })),
  ]);
  $effect(() => {
    const ids = new Set(shapes.map((shape) => shape.id));
    if (selectedMarkId && !ids.has(selectedMarkId)) selectedMarkId = null;
    if (selectedIds.some((id) => !ids.has(id)))
      selectedIds = selectedIds.filter((id) => ids.has(id));
    if (editingTextId && !ids.has(editingTextId)) editingTextId = null;
  });
  $effect(() => {
    // Retargeting the editor cancels local interaction, without touching either draft.
    const identity = sourceIdentity;
    untrack(() => {
      cropCandidate = null;
      tool = 'pointer';
      selectedIds = [];
      selectedMarkId = null;
      selectionAnchor = null;
      editingTextId = null;
      pendingTextMark = null;
      gesturePending = false;
      gesturePreview = null;
    });
    void identity;
  });
  function select(id: string | null, event?: MouseEvent | KeyboardEvent | PointerEvent) {
    if (blocked || cropCandidate || tool !== 'pointer') return;
    const range = !!event?.shiftKey;
    const toggle = !!event && (event.metaKey || event.ctrlKey);
    const order = cards.map((item) => item.id);
    if (id && range && selectionAnchor && order.includes(selectionAnchor) && order.includes(id)) {
      const a = order.indexOf(selectionAnchor),
        b = order.indexOf(id);
      const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      selectedIds = toggle ? [...new Set([...selectedIds, ...span])] : span;
    } else {
      selectedIds = id
        ? toggle
          ? selectedIds.includes(id)
            ? selectedIds.filter((value) => value !== id)
            : [...selectedIds, id]
          : [id]
        : [];
      selectionAnchor = id;
    }
    selectedMarkId = selectedIds.at(-1) ?? null;
  }
  function selectFromList(id: string | null, event?: MouseEvent | KeyboardEvent | PointerEvent) {
    if (blocked || cropCandidate) return;
    tool = 'pointer';
    select(id, event);
  }
  function selectAllFromList() {
    if (blocked || cropCandidate) return;
    tool = 'pointer';
    selectAll();
  }
  function selectAll() {
    if (blocked || cropCandidate || tool !== 'pointer') return;
    selectedIds = cards.map((item) => item.id);
    selectedMarkId = selectedIds.at(-1) ?? null;
    selectionAnchor ??= selectedIds[0] ?? null;
  }
  function setTool(next: ScreenshotTool) {
    pendingTextMark = null;
    cropCandidate = null;
    editingTextId = null;
    if (next !== 'pointer') {
      selectedIds = [];
      selectedMarkId = null;
      selectionAnchor = null;
    }
    tool = next === 'blur' && !canCreateV2 ? 'pointer' : next;
  }
  function crop() {
    if (blocked) return;
    if (cropCandidate) {
      cropCandidate = null;
      tool = 'pointer';
      return;
    }
    pendingTextMark = null;
    editingTextId = null;
    cropCandidate = { ...(draft.crop ?? { x: 0, y: 0, w: source.width, h: source.height }) };
    tool = 'crop';
  }
  function applyCrop() {
    if (!cropCandidate || blocked) return;
    apply(cropScreenshotEdit(draft, cropCandidate));
    cropCandidate = null;
    tool = 'pointer';
  }

  function canvasGeometry(geometry: DockMediaGeometry): DockMarkGeometry {
    if (geometry.kind === 'point' || geometry.kind === 'text')
      return {
        kind: 'rect',
        ...(fontSettled ? dockAnnotationDisplayBounds(geometry) : dockMediaGeometryRect(geometry)),
      };
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
  function remove(id?: string) {
    const ids = new Set(id && !selectedIds.includes(id) ? [id] : selectedIds);
    if (!ids.size || cropCandidate || blocked || tool !== 'pointer') return;
    // A group deletion is one canonical change and therefore one undo step.
    apply({
      ...draft,
      marks: draft.marks.filter((mark) => !ids.has(mark.id)),
      blurRegions: draft.blurRegions.filter((region) => !ids.has(region.id)),
      blurStrokes: draft.blurStrokes?.filter((stroke) => !ids.has(stroke.id)),
    });
    selectedIds = [];
    selectedMarkId = null;
    editingTextId = null;
  }
  function transformedEdit(id: string, geometry: DockMarkGeometry): DockMediaEdit {
    const mark = draft.marks.find((item) => item.id === id),
      b = dockGeometryRect(geometry);
    if (mark) {
      if (!screenshotContains(frame, b)) return draft;
      const old = mark.geometry,
        oldBounds = dockAnnotationDisplayBounds(old);
      const next: DockMediaGeometry =
        old.kind === 'point'
          ? { ...old, x: old.x + b.x - oldBounds.x, y: old.y + b.y - oldBounds.y }
          : old.kind === 'text'
            ? transformDockMediaText(old, {
                scaleX: b.w / Math.max(0.0001, oldBounds.w),
                scaleY: b.h / Math.max(0.0001, oldBounds.h),
                offsetX: b.x - (oldBounds.x * b.w) / Math.max(0.0001, oldBounds.w),
                offsetY: b.y - (oldBounds.y * b.h) / Math.max(0.0001, oldBounds.h),
              })
            : geometry;
      if (!screenshotContains(frame, dockMediaGeometryRect(next))) return draft;
      return {
        ...draft,
        marks: draft.marks.map((item) => (item.id === id ? { ...item, geometry: next } : item)),
      };
    }
    const stroke = draft.blurStrokes?.find((item) => item.id === id);
    if (stroke) {
      const old = dockMediaBlurStrokeBounds(stroke);
      const scaleX = b.w / old.w,
        scaleY = b.h / old.h;
      const next = transformDockMediaBlurStroke(stroke, {
        scaleX,
        scaleY,
        offsetX: b.x - old.x * scaleX,
        offsetY: b.y - old.y * scaleY,
      });
      if (
        next.points.some(
          (p) =>
            p.x < frame.x || p.y < frame.y || p.x > frame.x + frame.w || p.y > frame.y + frame.h,
        )
      )
        return draft;
      return {
        ...draft,
        blurStrokes: draft.blurStrokes?.map((item) => (item.id === id ? next : item)),
      };
    }
    if (!screenshotContains(frame, b)) return draft;
    return {
      ...draft,
      blurRegions: draft.blurRegions.map((region) => (region.id === id ? { id, ...b } : region)),
    };
  }
  function transform(id: string, geometry: DockMarkGeometry) {
    const next = transformedEdit(id, geometry);
    if (next !== draft) apply(next);
  }
  function blur(points: DockMediaBlurStroke['points'], radius: number) {
    if (blocked || !canCreateV2 || !points.length) return;
    const id = crypto.randomUUID();
    apply({ ...draft, blurStrokes: [...(draft.blurStrokes ?? []), { id, radius, points }] });
    selectedMarkId = id;
    selectedIds = [id];
    selectionAnchor = id;
  }
  /** Esc with a tool chosen puts it down (before the shell's Esc closes the editor). */
  function onToolEscape(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const shortcut = captureEditorToolShortcut(
      event,
      blocked || gesturePending || !!editingTextId || !!pendingTextMark || !!cropCandidate,
    );
    if (shortcut && (shortcut !== 'blur' || canCreateV2)) {
      event.preventDefault();
      event.stopPropagation();
      if (shortcut === 'crop') crop();
      else setTool(shortcut);
      return;
    }
    if (event.key === 'Escape' && gesturePending) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      isTextEntryTarget(target) ||
      target?.closest('[role="menu"], [role="dialog"], [role="alertdialog"]')
    )
      return;
    if (event.key === 'Enter' && target?.closest('button')) return;
    if (cropCandidate && (event.key === 'Enter' || event.key === 'Escape')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Enter') applyCrop();
      else {
        cropCandidate = null;
        tool = 'pointer';
      }
    } else if (event.key === 'Escape' && tool !== 'pointer') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setTool('pointer');
    } else if (event.key === 'Escape' && selectedIds.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      select(null);
    }
  }
  function draw(
    nextTool: ScreenshotTool,
    geometry: DockMarkGeometry,
    creationUnit = 1,
    autoWidthText = false,
  ) {
    if (blocked) return;
    const bounds = dockGeometryRect(geometry);
    if (!screenshotContains(frame, bounds)) return;
    if (nextTool === 'crop') {
      if (bounds.w < 2 || bounds.h < 2) return;
      cropCandidate = bounds;
      return;
    }
    const id = crypto.randomUUID();
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
    // Size only newly created labels in screen pixels, then store source coordinates.
    // Reopened labels keep their canonical saved font, width and padding.
    const labelUnit = Number.isFinite(creationUnit) && creationUnit > 0 ? creationUnit : 1;
    const labelWidth = canCreateV2 ? Math.min(4096, bounds.w) : bounds.w;
    const labelPadding =
      canCreateV2 && !autoWidthText
        ? Math.min(1024, 8 * labelUnit, labelWidth / 8, bounds.h / 8)
        : 0;
    const value: DockMediaGeometry =
      kind === 'text'
        ? {
            kind: 'text',
            x: bounds.x,
            y: bounds.y,
            text: '',
            ...(canCreateV2 && !autoWidthText
              ? {
                  style: 'sticky' as const,
                  width: labelWidth,
                  padding: labelPadding,
                }
              : {}),
            fontSize: Math.max(
              0.1,
              Math.min(
                24 * labelUnit,
                (bounds.h - 2 * labelPadding) / 1.4,
                (labelWidth - 2 * labelPadding) /
                  Math.max(1, m.dock_screenshotEditor_text().length * 0.65),
              ),
            ),
          }
        : geometry;
    const mark: DockMediaEditMark = {
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
    };
    if (kind === 'text') pendingTextMark = mark;
    else apply({ ...draft, marks: [...draft.marks, mark] });
    selectedMarkId = kind === 'text' ? id : null;
    selectedIds = kind === 'text' ? [id] : [];
    selectionAnchor = kind === 'text' ? id : null;
    if (kind === 'text') {
      tool = 'pointer';
      editingTextId = id;
    }
  }
  function text(id: string, value: string) {
    const pending = pendingTextMark?.id === id ? pendingTextMark : null;
    const mark = pending ?? draft.marks.find((item) => item.id === id);
    if (mark?.geometry.kind !== 'text') return;
    if (pending && !value.trim()) {
      pendingTextMark = null;
      return;
    }
    let geometry = { ...mark.geometry, text: value };
    const layout = layoutDockMediaText(geometry),
      available = frame.y + frame.h - geometry.y;
    if (layout.height > available) {
      const scale = available / layout.height;
      geometry = {
        ...geometry,
        fontSize: Math.max(0.0001, geometry.fontSize * scale),
        ...(geometry.style === 'sticky' ? { padding: layout.padding * scale } : {}),
      };
    }
    if (screenshotContains(frame, dockMediaGeometryRect(geometry))) {
      if (pending) {
        apply({
          ...draft,
          marks: [...draft.marks, { ...pending, geometry, label: value.slice(0, 2048) }],
        });
        pendingTextMark = null;
      } else update(id, { geometry, label: value.slice(0, 2048) });
    } else if (pending) {
      // An uncommittable provisional field must not survive as unsaved canvas art.
      pendingTextMark = null;
    }
  }
</script>

<svelte:window onkeydowncapture={onToolEscape} />

{#snippet main()}
  <div class="main-view">
    <div class="image-view">
      {#if source.visuals !== 'clean'}<p class="type-caption notice">
          {m.dock_screenshotEditor_readonly()}
        </p>{/if}
      {#if !previewFailed && (previewPending || publishedPreview?.url !== displayedPreview?.url) && (!frameReady || !redactionsReady)}<p
          class="type-caption notice"
          role="status"
        >
          {m.dock_screenshotEditor_preparing()}
        </p>{/if}
      {#if previewFailed}<p class="type-caption notice" role="alert">
          {m.dock_screenshotEditor_previewError()}
        </p>
        <Button variant="ghost" size="compact" onclick={() => previewRetry++}
          >{m.dock_screenshotEditor_retry()}</Button
        >{/if}
      <ScreenshotCanvas
        sourceUrl={source.visuals === 'clean' ? (previewUrl ?? '') : sourceUrl}
        raster={source.visuals === 'clean'}
        hidden={source.visuals === 'clean' && !frameReady}
        redactionPending={source.visuals === 'clean' && !redactionsReady}
        onRasterReady={rasterReady}
        onRasterError={(url) => {
          if (url === previewUrl) previewFailed = true;
        }}
        {pendingRedactions}
        width={source.width}
        height={source.height}
        {frame}
        {shapes}
        {annotationOps}
        {tool}
        documentKey={sourceIdentity}
        selectedId={selectedMarkId}
        {selectedIds}
        {brushRadius}
        onBlurStroke={blur}
        onGesturePending={(pending) => (gesturePending = pending)}
        onGesturePreview={(preview) => (gesturePreview = preview)}
        {cropCandidate}
        onCropChange={(candidate) => (cropCandidate = candidate)}
        bind:editingTextId
        onText={text}
        onTextCancel={(id) => {
          if (pendingTextMark?.id === id) pendingTextMark = null;
        }}
        onTextPreview={(preview) => (textPreview = preview)}
        disabled={blocked || !frameReady || previewFailed}
        onSelect={select}
        onSelectAll={selectAll}
        onDraw={draw}
        onTransform={transform}
        onDelete={remove}
      />
    </div>
    <div class="toolbar-dock">
      <ScreenshotTools
        {tool}
        canBlur={canCreateV2}
        disabled={blocked || !!cropCandidate}
        onSelect={setTool}
      >
        <ScreenshotHeaderActions
          cropping={tool === 'crop'}
          disabled={blocked}
          onCrop={crop}
          onApplyCrop={applyCrop}
          canApplyCrop={!previewPending && !previewFailed}
        />
      </ScreenshotTools>
    </div>
  </div>
{/snippet}
{#snippet sidebar()}
  <ScreenshotMarkRail
    items={cards}
    {selectedIds}
    disabled={blocked || !!cropCandidate}
    onSelect={selectFromList}
    onSelectAll={selectAllFromList}
    onDelete={() => remove()}
  />
{/snippet}
{#snippet headerActions()}{/snippet}
{#if children}
  {@render children(main, sidebar, headerActions)}
{:else}
  <div class="standalone" data-screenshot-editor>
    <div class="body">
      {@render main()}
      <div class="sidebar">{@render sidebar()}</div>
    </div>
  </div>
{/if}

<style>
  .main-view {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    flex: 1;
    height: 100%;
    min-width: 0;
    min-height: 0;
    padding: 8px;
  }
  .toolbar-dock {
    display: flex;
    justify-content: center;
    flex: 0 0 auto;
    padding: 4px 8px 8px;
    min-height: 52px;
  }
  .image-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    gap: 8px;
    position: relative;
  }
  .notice {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 1;
    pointer-events: none;
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
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 260px;
    min-height: 0;
    height: 100%;
  }
  .sidebar {
    border-inline-start: 1px solid hsl(var(--border));
  }
</style>

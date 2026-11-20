<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { base64ByteSize, base64ToBlob } from '$lib/utils/image-actions';
  import DockScreenshotEditorWindow from '$features/hud/media-editor/screenshot/DockScreenshotEditorWindow.svelte';
  import { renderDockMediaImage } from '$features/hud/composer/dock-media-render';
  import type {
    DockCaptureEditorSnapshot,
    DockCaptureEditorSaveResult,
  } from '$shared/dock-capture-editor';
  import type { ChatScreenshotPixels } from '$shared/dock-evidence';
  import {
    DOCK_MEDIA_OUTPUT_VERSION,
    type DockMediaEdit,
    type DockMediaSource,
  } from '$shared/dock-media-edit';
  import { m } from '$shared/paraglide/messages.js';
  import { imageAttachmentName } from './image-attachment-format';

  let {
    id,
    workspaceId,
    agentId,
    pixels,
    maxBytes,
    onAttach,
    onDelete,
    onFocusReturn,
  }: {
    id: string;
    workspaceId: string;
    agentId: string;
    pixels: ChatScreenshotPixels;
    maxBytes: number;
    onAttach: (file: File) => Promise<boolean>;
    onDelete: () => void;
    onFocusReturn: () => void;
  } = $props();

  const original = untrack(() => pixels);
  const originalName = imageAttachmentName(original.mimeType, 'screenshot');
  const blob = base64ToBlob(original.base64, original.mimeType);
  const mediaUrl = URL.createObjectURL(blob);
  let file = new File([blob], originalName, { type: original.mimeType });
  const source: DockMediaSource = untrack(() => ({
    id,
    revision: 0,
    kind: 'screenshot',
    attachmentId: id,
    path: `.intent/attachments/${id}.png`,
    durationMs: 0,
    width: original.width,
    height: original.height,
    audio: 'none',
    visuals: 'clean',
    batches: [],
    capturedMarks: [],
  }));
  const snapshot: DockCaptureEditorSnapshot = untrack(() => ({
    openId: id,
    kind: 'screenshot',
    workspaceId,
    agentId,
    attachmentId: id,
    sourceRevision: '0',
    title: '',
    mediaUrl,
    marks: [],
    provenance: { visuals: 'clean' },
    source,
    output: { ready: true, version: DOCK_MEDIA_OUTPUT_VERSION },
  }));
  let dialog = $state<HTMLElement | null>(null);
  let attaching = false;
  let active = true;
  onDestroy(() => {
    active = false;
    URL.revokeObjectURL(mediaUrl);
  });

  async function save({ edit }: { edit: DockMediaEdit }): Promise<DockCaptureEditorSaveResult> {
    const requestId = crypto.randomUUID();
    const rendered = await renderDockMediaImage(source, edit, original);
    if (!active) return { requestId, result: 'stale-source' };
    if (base64ByteSize(rendered.data) > maxBytes) return { requestId, result: 'failed' };
    file = new File([base64ToBlob(rendered.data, rendered.mimeType)], 'screenshot.png', {
      type: rendered.mimeType,
    });
    return { requestId, result: 'saved', saved: { ...edit, revision: edit.revision + 1 } };
  }

  async function attach(): Promise<boolean> {
    if (attaching || !active) return false;
    attaching = true;
    try {
      return await onAttach(file);
    } finally {
      attaching = false;
    }
  }
</script>

<ContentDialog
  open
  bind:contentRef={dialog}
  size="editor"
  title={m.dock_screenshotEditor_title()}
  showCloseButton={false}
  escapeKeydownBehavior="ignore"
  dismissOnInteractOutside={false}
  onCloseAutoFocus={(event) => {
    event.preventDefault();
    onFocusReturn();
  }}
>
  <div class="screenshot-editor-surface">
    <DockScreenshotEditorWindow
      {snapshot}
      shortcutDialog={dialog}
      onClose={attach}
      onAttach={attach}
      onDelete={async () => {
        onDelete();
        return true;
      }}
      onSave={save}
    />
  </div>
</ContentDialog>

<style>
  .screenshot-editor-surface {
    height: min(70dvh, 46rem);
  }
</style>

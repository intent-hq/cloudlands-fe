<script lang="ts">
  import DockScreenshotEditorWindow from '../DockScreenshotEditorWindow.svelte';
  import {
    defaultDockMediaEdit,
    type DockMediaSource,
    type DockMediaEditMark,
  } from '$shared/dock-media-edit';
  import type { DockCaptureEditorSnapshot } from '$shared/dock-capture-editor';
  let { count = 0 }: { count?: number } = $props();
  const source: DockMediaSource = {
    id: 'sidebar-fixture',
    revision: 0,
    kind: 'screenshot',
    attachmentId: 'fixture',
    path: '.intent/attachments/fixture.png',
    durationMs: 0,
    width: 800,
    height: 500,
    audio: 'none',
    batches: [],
    visuals: 'clean',
  };
  const image = document.createElement('canvas');
  image.width = 800;
  image.height = 500;
  const ctx = image.getContext('2d')!;
  ctx.fillStyle = '#e6e8ec';
  ctx.fillRect(0, 0, 800, 500);
  ctx.fillStyle = '#374151';
  ctx.font = '24px system-ui';
  ctx.fillText('Screenshot sidebar fixture', 45, 60);
  const marks = Array.from({ length: count }, (_, i): DockMediaEditMark => ({
    id: `mark-${i}`,
    atMs: 0,
    batchId: 'initial',
    source: 'editor',
    kind: 'box',
    included: true,
    geometry: {
      kind: 'rect',
      x: 40 + (i % 5) * 140,
      y: 100 + Math.floor(i / 5) * 55,
      w: 100,
      h: 40,
    },
    label: 'Box',
    note: '',
    context: { selector: null, text: null, url: null },
  }));
  const snapshot: DockCaptureEditorSnapshot = {
    openId: 'sidebar-fixture',
    kind: 'screenshot',
    workspaceId: 'fixture',
    agentId: 'fixture',
    attachmentId: 'fixture',
    sourceRevision: '0',
    title: 'Sidebar fixture',
    marks: [],
    provenance: { visuals: 'clean' },
    source,
    saved: defaultDockMediaEdit(source, marks, null),
    mediaUrl: image.toDataURL(),
    output: { ready: true, version: 2 },
  };
  let saved = $state(false);
</script>

<div class="fixture" data-saved={saved}>
  <DockScreenshotEditorWindow
    {snapshot}
    onClose={() => {}}
    onRetake={async () => null}
    onSave={async ({ edit }) => {
      saved = true;
      return { result: 'saved', saved: edit };
    }}
  />
</div>

<style>
  .fixture {
    height: 100dvh;
    width: 100%;
  }
</style>

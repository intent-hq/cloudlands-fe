<script lang="ts">
  import { untrack } from 'svelte';
  import { renderDockMediaImage } from '$features/hud/composer/dock-media-render';
  import { Button } from '$lib/components/ui/button';
  import DockScreenshotEditor from '../DockScreenshotEditor.svelte';
  import DockCaptureEditorShell from '../../DockCaptureEditorShell.svelte';
  import { createEditTransaction } from '../../edit-transaction.svelte';
  import {
    defaultDockMediaEdit,
    type DockMediaSource,
    type DockMediaEditMark,
    type DockMediaBlurRegion,
  } from '$shared/dock-media-edit';
  import { retakeScreenshotEdit } from '../screenshot-edit-geometry';
  let { initialMarks = [], initialBlurRegions = [] }: {
    initialMarks?: DockMediaEditMark[];
    initialBlurRegions?: DockMediaBlurRegion[];
  } = $props();
  const source: DockMediaSource = {
    id: 'synthetic-screenshot',
    revision: 0,
    kind: 'screenshot',
    attachmentId: 'synthetic-image',
    path: '.intent/attachments/synthetic-screen.png',
    durationMs: 0,
    width: 800,
    height: 500,
    audio: 'none',
    visuals: 'clean',
  };
  const picture = (width: number, height: number) => {
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    const context = image.getContext('2d');
    if (!context) throw new Error('Synthetic canvas unavailable');
    context.fillStyle = '#f4f2eb';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#d9e2d4';
    context.fillRect(50, 60, 220, 130);
    context.fillStyle = '#dce1ee';
    context.fillRect(420, 260, 200, 110);
    context.fillStyle = '#202020';
    context.font = '22px system-ui';
    context.fillText('Workspace settings', 70, 110);
    context.font = '18px system-ui';
    context.fillText('Sensitive account text', 70, 150);
    context.fillText('Save changes', 445, 320);
    return image.toDataURL('image/png');
  };
  const original = untrack(() => ({
    source,
    url: picture(800, 500),
    edit: {
      ...defaultDockMediaEdit(source, initialMarks, null),
      blurRegions: initialBlurRegions,
    },
  }));
  const transaction = createEditTransaction(original);
  let saved = $state('');
  let output = $state('');
  let saving = $state(false);
  let cancelled = $state(false);
  let dictatingId = $state<string | null>(null);
  function retake() {
    const candidate = { ...source, revision: 1, width: 600, height: 400 };
    transaction.apply({
      source: candidate,
      url: picture(600, 400),
      edit: retakeScreenshotEdit(transaction.draft.edit, candidate, {
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
      }),
    });
  }
</script>

<!-- i18n-ignore (synthetic screenshot editor walkthrough only) -->
<div
  class="fixture"
  data-testid="screenshot-editor-harness"
  data-draft={JSON.stringify(transaction.draft.edit)}
  data-source={JSON.stringify(transaction.draft.source)}
  data-saved={saved}
  data-output={output}
  data-cancelled={cancelled}
>
  <DockScreenshotEditor
    source={transaction.draft.source}
    sourceUrl={transaction.draft.url}
    draft={transaction.draft.edit}
    onChange={(edit) => transaction.apply({ ...transaction.draft, edit })}
    onRetake={retake}
    {dictatingId}
    onNoteDictation={(id, phase) => {
      dictatingId = phase === 'start' ? id : null;
      if (phase === 'stop')
        transaction.apply({
          ...transaction.draft,
          edit: {
            ...transaction.draft.edit,
            marks: transaction.draft.edit.marks.map((mark) =>
              mark.id === id ? { ...mark, note: 'Synthetic dictated note' } : mark,
            ),
          },
        });
    }}
  >
    {#snippet children(main, sidebar, headerActions)}
      <DockCaptureEditorShell
        title="Screenshot · Region"
        subtitle="Synthetic source"
        dirty={transaction.dirty}
        {saving}
        onCancel={() => {
          transaction.reset(original);
          cancelled = true;
        }}
        onSave={async () => {
          saving = true;
          try {
            const bundle = transaction.draft;
            const rendered = await renderDockMediaImage(bundle.source, bundle.edit, {
              base64: bundle.url.split(',')[1],
              mimeType: 'image/png',
            });
            output = rendered.data;
            saved = JSON.stringify(bundle.edit);
            transaction.commit(bundle);
          } finally {
            saving = false;
          }
        }}
        onUndo={() => transaction.undo()}
        onRedo={() => transaction.redo()}
        {main}
        {sidebar}
        {headerActions}
      />
    {/snippet}
  </DockScreenshotEditor>
  <div class="fixture-controls">
    <Button variant="ghost" size="compact" onclick={() => transaction.reset(original)}
      >Reset fixture</Button
    >
  </div>
</div>

<style>
  .fixture {
    width: 1040px;
    max-width: 100%;
    color: hsl(var(--foreground));
    background: hsl(var(--background));
  }
  .fixture-controls {
    padding: 8px;
  }
</style>

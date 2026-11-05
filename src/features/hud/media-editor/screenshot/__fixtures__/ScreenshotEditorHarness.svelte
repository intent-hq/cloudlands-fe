<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import DockScreenshotEditor from '../DockScreenshotEditor.svelte';
  import DockCaptureEditorShell from '../../DockCaptureEditorShell.svelte';
  import { createEditTransaction } from '../../edit-transaction.svelte';
  import { defaultDockMediaEdit, type DockMediaSource } from '$shared/dock-media-edit';
  import { retakeScreenshotEdit } from '../screenshot-edit-geometry';
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
  const picture = (w: number, h: number) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f4f2eb"/><rect x="50" y="60" width="220" height="130" rx="12" fill="#d9e2d4"/><rect x="420" y="260" width="200" height="110" rx="12" fill="#dce1ee"/><text x="70" y="110" font-family="system-ui" font-size="22">Workspace settings</text><text x="70" y="150" font-family="system-ui" font-size="18">Sensitive account text</text><text x="445" y="320" font-family="system-ui" font-size="22">Save changes</text></svg>`)}`;
  const original = { source, url: picture(800, 500), edit: defaultDockMediaEdit(source, [], null) };
  const transaction = createEditTransaction(original);
  let saved = $state('');
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

<div
  class="fixture"
  data-testid="screenshot-editor-harness"
  data-draft={JSON.stringify(transaction.draft.edit)}
  data-source={JSON.stringify(transaction.draft.source)}
  data-saved={saved}
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
        onCancel={() => {
          transaction.reset(original);
          cancelled = true;
        }}
        onSave={() => {
          saved = JSON.stringify(transaction.draft.edit);
          transaction.commit(transaction.draft);
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

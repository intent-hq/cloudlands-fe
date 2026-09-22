<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { SharingState } from './content-sharing.preview-fixtures';

  const states: SharingState[] = [
    'ready',
    'note-raw',
    'note-unsaved',
    'note-empty',
    'note-loading',
    'note-stale',
    'chat-empty',
    'chat-streaming',
    'clipboard-failure',
    'narrow',
  ];
  export const preview = definePreview<{ state: SharingState }>({
    id: 'content-sharing',
    title: 'Note and chat sharing',
    defaultState: 'ready',
    states: Object.fromEntries(states.map((state) => [state, { props: { state } }])),
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import ContentSharingPreviewPanel from './ContentSharingPreviewPanel.svelte';
  import { seedSharingPreview } from './content-sharing.preview-fixtures';
  import { isolateSharingPreview, type SharingCapture } from './content-sharing.preview-isolation';

  let { state: scene }: { state: SharingState } = $props();
  let capture = $state<SharingCapture | null>(null);
  // svelte-ignore state_referenced_locally -- each named scene remounts its isolated fixture.
  const dispose = isolateSharingPreview(scene, (next) => {
    capture = next;
  });
  // svelte-ignore state_referenced_locally -- each named scene seeds once at mount.
  seedSharingPreview(scene);
  onDestroy(() => {
    void dispose();
  });
  const explanations: Record<SharingState, string> = {
    ready:
      'Try either visible Copy button, then open each panel menu for Copy link and Download Markdown. Chat export includes only loaded messages.',
    'note-raw':
      'Raw Markdown mode uses the same sharing controls. Copy and download preserve the Markdown source.',
    'note-unsaved':
      'Edit the raw note, then immediately press Copy. The export reads the live editor draft, even before the save debounce. All saves stay in this mock.',
    'note-empty':
      'A genuinely empty, loaded note can be copied and downloaded. This is different from content that has not loaded.',
    'note-loading':
      'The note body has not loaded. Full-note copy and download are disabled; its Intent link remains available.',
    'note-stale':
      'A slim note row says content exists, but the simulated content fetch failed. Copy/download stay disabled; retry cannot export an empty substitute.',
    'chat-empty':
      'The chat has loaded but contains no messages. Transcript copy/download are disabled; Copy link remains available.',
    'chat-streaming':
      'The agent is marked as streaming. Copy/download take a snapshot of the loaded conversation, not a promise of the full history.',
    'clipboard-failure':
      'Simulated clipboard denial on both native and browser seams. Try either Copy button or Copy link to see the real error toast.',
    narrow:
      'Production headers at 340px panel width. The primary Copy control and overflow menu remain available.',
  };
  const noteOnly = $derived(scene.startsWith('note-'));
  const chatOnly = $derived(scene.startsWith('chat-'));
</script>

<!-- i18n-ignore (developer-only preview fixture labels) -->
<div
  class="sharing-preview"
  class:narrow={scene === 'narrow'}
  data-content-sharing-preview
  data-sharing-state={scene}
>
  <header class="space-y-2">
    <p class="type-caption text-subtle">
      Interactive preview · fictional content · no daemon writes
    </p>
    <h2 class="type-title">Note and chat sharing</h2>
    <p class="type-body text-subtle">{explanations[scene]}</p>
  </header>
  <div class="panels" class:single={noteOnly || chatOnly}>
    {#if !chatOnly}<ContentSharingPreviewPanel kind="note" />{/if}
    {#if !noteOnly}<ContentSharingPreviewPanel kind="agent" />{/if}
  </div>
  <aside class="capture bg-muted rounded-lg p-3" aria-live="polite">
    <p class="type-caption text-subtle">
      {capture?.kind === 'blocked'
        ? 'Preview safety boundary'
        : 'Mock clipboard · inspected output'}
    </p>
    <pre data-sharing-output>{capture?.text ??
        'Nothing copied yet. Clipboard writes are captured here instead of changing your system clipboard. Downloads use the real browser download action.'}</pre>
  </aside>
</div>

<style>
  .sharing-preview {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .panels {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
  }
  .panels.single {
    grid-template-columns: minmax(0, 1fr);
  }
  .narrow .panels {
    grid-template-columns: repeat(2, 340px);
  }
  .capture pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin-top: 8px;
    max-height: 150px;
    overflow: auto;
    font-size: 12px;
  }
  @media (max-width: 760px) {
    .panels,
    .narrow .panels {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

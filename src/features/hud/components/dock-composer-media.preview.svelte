<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type {
    DockComposerAttachment,
    DockComposerMediaLabels,
    DockComposerMediaState,
  } from './dock-composer-media-presentation';

  type PreviewMode =
    'idle' | 'captured' | 'annotate-hovered' | 'annotating' | 'dictating' | 'recording';
  interface PreviewProps {
    mode?: PreviewMode;
    width?: number;
    state?: Partial<DockComposerMediaState>;
    items?: DockComposerAttachment[];
    disabled?: boolean;
    annotationNotice?: string;
    /** Motion fixtures only: confirm capture and recording at once, like a fast native owner. */
    simulateConfirm?: boolean;
  }

  export const preview = definePreview<PreviewProps>({
    id: 'dock-composer-media',
    title: 'Dock composer media',
    defaultState: 'idle',
    states: {
      idle: { props: { mode: 'idle' } },
      captured: { props: { mode: 'captured' } },
      'annotate-hovered': { props: { mode: 'annotate-hovered' } },
      annotating: { props: { mode: 'annotating' } },
      dictating: { props: { mode: 'dictating' } },
      recording: { props: { mode: 'recording' } },
      // i18n-ignore (isolated preview copy)
      'permission-error': {
        props: {
          mode: 'idle',
          state: {
            alerts: {
              annotate: 'Allow Accessibility in System Settings.',
              pick: 'Allow Accessibility in System Settings.',
              mic: 'Allow microphone and speech recognition in System Settings.',
            },
          },
        },
      },
    },
  });

  // i18n-ignore (isolated component preview copy; production passes localized labels)
  export const labels: DockComposerMediaLabels = {
    capture: 'Capture the screen',
    captureLimit: 'Up to 4 screenshots',
    clipLimit: 'Up to 5 recordings',
    record: 'Record the screen',
    stopRecording: 'Stop recording',
    annotate: 'Annotate the screen',
    annotationTools: 'Annotation tools',
    annotateCurrent: (tool) => `Annotate the screen. Current tool: ${tool}`,
    tools: { pick: 'Pick an element', box: 'Box', pen: 'Pen', arrow: 'Arrow' },
    dictate: 'Dictate · hold to talk',
    stopDictating: 'Stop dictating',
    annotating: 'Annotating',
    listening: 'Listening',
    recording: 'Recording',
    markUp: 'Mark up',
    remove: 'Remove',
    play: 'Play',
    done: 'Done',
    attachments: 'Attachments',
    retry: 'Retry',
    attachmentPending: 'Uploading',
    attachmentFailed: 'Upload failed',
    image: (marks) => `Screenshot with ${marks} marks. Open`,
    clip: (duration) => `Clip, ${duration}. Play`,
    recordingReference: (n, end) => (end ? `Recording ${n} ends` : `Recording ${n}`),
  };

  // An explicitly synthetic page drawing, used only by the preview and its CT.
  export function fixtureImage(marked: boolean): string {
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="310" viewBox="0 0 480 310"><rect width="480" height="310" fill="#f0f0eb"/><rect x="45" y="40" width="390" height="230" rx="20" fill="white" stroke="#d3d3d1"/><path d="M80 85h130M80 125h290" stroke="#dfdfdb" stroke-width="18" stroke-linecap="round"/><rect x="80" y="180" width="120" height="42" rx="8" fill="#141414"/><rect x="230" y="180" width="140" height="42" rx="8" fill="#efefeb"/>${marked ? '<rect x="226" y="176" width="148" height="50" rx="9" fill="none" stroke="#ddec61" stroke-width="5"/><rect x="295" y="68" width="90" height="28" rx="10" fill="none" stroke="#ddec61" stroke-width="5"/><circle cx="377" cy="173" r="20" fill="#ddec61"/><circle cx="389" cy="64" r="20" fill="#ddec61"/><g fill="#080808" font-family="sans-serif" font-size="24" text-anchor="middle"><text x="377" y="181">1</text><text x="389" y="72">2</text></g>' : ''}</svg>`)}`;
  }
</script>

<script lang="ts">
  import '$lib/styles/dock-tokens.css';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faArrowUp, faCircle } from '$lib/icons/phosphor-icons';
  import DockComposerMediaFooter from './DockComposerMediaFooter.svelte';
  import DockComposerAttachments from './DockComposerAttachments.svelte';
  import DockConversationSurface from './DockConversationSurface.svelte';
  import type { DockPointerRect } from '$shared/dock-layout';

  let {
    mode = 'idle',
    width = 420,
    state: overrides,
    items: suppliedItems,
    disabled = false,
    annotationNotice,
    simulateConfirm = false,
  }: PreviewProps = $props();
  let mediaState = $state<DockComposerMediaState>({
    captureRevision: 0,
    annotationActive: false,
    tool: 'pick',
    toolUsed: false,
    recording: false,
    recordingTime: '0:00',
    dictating: false,
    dictationTime: '0:00',
    inputLevels: [],
  });
  let items = $state<DockComposerAttachment[]>([]);
  let actions = $state<string[]>([]);
  let popupRegions = $state<DockPointerRect[]>([]);
  let draft = $state('');
  $effect(() => {
    const marked = ['annotating', 'dictating', 'recording'].includes(mode);
    mediaState = {
      captureRevision: 0,
      annotationActive: mode === 'annotating',
      tool: marked ? 'box' : 'pick',
      toolUsed: marked,
      recording: mode === 'recording',
      recordingTime: '0:14',
      dictating: mode === 'dictating',
      dictationTime: '0:09',
      // Deterministic preview samples, never used by the production component.
      inputLevels:
        mode === 'dictating' ? [0.12, 0.3, 0.5, 0.2, 0.7, 0.9, 0.3, 0.6, 0.2, 0.8, 1, 0.4] : [],
      ...overrides,
    };
    items =
      suppliedItems ??
      (mode === 'idle' || mode === 'annotate-hovered'
        ? []
        : [
            {
              kind: 'image',
              owner: 'evidence',
              id: 'image-one',
              url: fixtureImage(marked),
              markCount: marked ? 2 : 0,
            },
            ...(mode === 'recording'
              ? [
                  {
                    kind: 'clip' as const,
                    owner: 'evidence' as const,
                    id: 'clip-one',
                    duration: '0:14',
                    recording: true,
                  },
                ]
              : []),
          ]);
    draft = marked ? 'Closer, but this still has the old shadow.' : '';
  });
  function record(action: string): void {
    actions = [...actions, action];
  }
</script>

<section
  class="preview dark"
  data-dock-palette="notch"
  style:width={`${width}px`}
  data-actions={JSON.stringify(actions)}
  data-preview-mode={mode}
  data-confirmed-recording={mediaState.recording}
  data-confirmed-capture={mediaState.captureRevision}
  data-popup-regions={JSON.stringify(popupRegions)}
>
  <DockConversationSurface
    workspaceId="composer-media-preview"
    resizable={false}
    onRegionsChange={(regions) => (popupRegions = regions)}
  >
    <!-- This fixture proves presentation callbacks only, not the editor/session integration. -->
    <div class="preview-status" role="status">
      {#if mediaState.recording || mediaState.dictating || mediaState.annotationActive}
        <span
          class="status-dot"
          data-live={mediaState.recording || mediaState.dictating || undefined}
        ></span>
        {mediaState.recording
          ? labels.recording
          : mediaState.dictating
            ? labels.listening
            : labels.annotating}
      {/if}
    </div>
    <div class="composer">
      <DockComposerAttachments
        {items}
        {labels}
        {disabled}
        onMarkUp={(id) => record(`markup:${id}`)}
        onRetry={(id) => record(`retry:${id}`)}
        onRemove={(id) => {
          record(`remove:${id}`);
          items = items.filter((item) => item.id !== id);
        }}
      />
      <!-- i18n-ignore (isolated preview field; production uses the canonical rich editor) -->
      <Textarea
        class="preview-input"
        noFocusStyle
        aria-label="Message Main"
        bind:value={draft}
        placeholder={items.length ? 'Say what should change' : 'Message Main'}
        rows={3}
        {disabled}
      />
      <DockComposerMediaFooter
        state={mediaState}
        {labels}
        {disabled}
        {annotationNotice}
        onAlert={(target) => record(`open-settings:${target}`)}
        onCapture={() => {
          record('capture');
          if (simulateConfirm)
            mediaState = { ...mediaState, captureRevision: mediaState.captureRevision + 1 };
        }}
        onRecordToggle={() => {
          record('record');
          if (simulateConfirm) mediaState = { ...mediaState, recording: !mediaState.recording };
        }}
        onAnnotationToggle={() => record('annotation-toggle')}
        onToolSelect={(tool) => {
          record(`tool:${tool}`);
          mediaState = { ...mediaState, tool, toolUsed: true, annotationActive: true };
        }}
        onDictationToggle={() => record('dictation-toggle')}
        onDictationHoldStart={() => record('dictation-hold-start')}
        onDictationHoldEnd={() => record('dictation-hold-end')}
      >
        {#snippet model()}
          <!-- i18n-ignore (isolated model label) -->
          <span class="preview-model"><Fa icon={faCircle} size={16} /><span>6.1 Sol</span></span>
        {/snippet}
        {#snippet send()}
          <!-- i18n-ignore (isolated preview action; no submission transport) -->
          <Button
            variant="primary"
            size="icon-sm"
            aria-label="Send"
            disabled={disabled || (!draft && !items.length)}
            onclick={() => record('send')}><Fa icon={faArrowUp} size={17} /></Button
          >
        {/snippet}
      </DockComposerMediaFooter>
    </div>
  </DockConversationSurface>
</section>

<style>
  .preview {
    max-width: 100%;
    padding: 12px;
    color: hsl(var(--foreground));
    background: hsl(var(--background));
    border-radius: 16px;
  }
  .preview-status {
    display: flex;
    align-items: center;
    justify-content: end;
    gap: 6px;
    height: 24px;
    margin-bottom: 10px;
    font-size: var(--text-caption-size);
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: hsl(var(--primary));
  }
  .status-dot[data-live] {
    background: hsl(var(--capture-active));
  }
  .composer {
    padding: 12px;
    border: 1px solid hsl(var(--border));
    border-radius: 16px;
    background: hsl(var(--muted));
  }
  .composer :global(.preview-input) {
    display: block;
    width: 100%;
    min-height: 80px;
    resize: none;
    background: transparent;
    border: 0;
    padding: 0;
    font: inherit;
    outline: none;
    color: inherit;
    margin-bottom: 8px;
  }
  .composer :global(.preview-input::placeholder) {
    color: hsl(var(--muted-foreground));
  }
  .preview-model {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    font-weight: 500;
    font-size: var(--text-body-size);
  }
  .preview-model > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .preview-model :global(svg) {
    flex: none;
  }
</style>

<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { AnnotationVoiceStatus } from '../annotation-voice-service';
  interface Props {
    voiceStatus?: AnnotationVoiceStatus;
    pending?: boolean;
    captureError?: boolean;
    panelHeight?: number;
  }
  export const preview = definePreview<Props>({
    id: 'annotation-toolbar',
    title: 'Screen feedback toolbar',
    defaultState: 'idle',
    states: {
      idle: { props: { voiceStatus: 'idle' } },
      requesting: { props: { voiceStatus: 'requesting' } },
      recording: { props: { voiceStatus: 'recording' } },
      transcribing: { props: { voiceStatus: 'transcribing' } },
      error: { props: { voiceStatus: 'error' } },
      'send-pending': { props: { voiceStatus: 'idle', pending: true } },
      'capture-error': { props: { voiceStatus: 'idle', captureError: true } },
      'short-screen': { props: { voiceStatus: 'recording', panelHeight: 240 } },
    },
    captureReadiness: { selector: '[data-toolbar-preview]', count: 1 },
  });
</script>

<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import AnnotationToolbarPanel from './AnnotationToolbarPanel.svelte';
  import type { AnnotationTool } from '$shared/annotation';
  let {
    voiceStatus = 'idle',
    pending = false,
    captureError = false,
    panelHeight = 320,
  }: Props = $props();
  let tool = $state<AnnotationTool>('draw');
  let action = $state('');
  let workspaceId = $state('preview-workspace');
  let recipientId = $state('preview-main');
</script>

<div
  data-toolbar-preview
  data-last-action={action}
  style:height={`${panelHeight}px`}
  class="toolbar-preview"
>
  <AnnotationToolbarPanel
    {tool}
    {voiceStatus}
    {pending}
    errorMessage={captureError ? m.annotation_captureFailed_error() : ''}
    {workspaceId}
    {recipientId}
    recipientIsDefault={recipientId === 'preview-main'}
    workspaceOptions={[
      { value: 'preview-workspace', label: 'Navigation feedback' },
      { value: 'preview-other', label: 'Website polish' },
    ]}
    recipientOptions={[
      { value: 'preview-main', label: 'Coordinator · Main agent' },
      { value: 'preview-agent', label: 'Interface implementor' },
    ]}
    onWorkspace={(value) => (workspaceId = value)}
    onRecipient={(value) => (recipientId = value)}
    onRefresh={() => (action = 'refresh')}
    sendDisabled={voiceStatus === 'error'}
    elapsedMs={42000}
    onTool={(value) => (tool = value)}
    onVoice={() => (action = 'voice')}
    onScreenshot={() => (action = 'screenshot')}
    onSend={() => (action = 'send')}
    onCancel={() => (action = 'cancel')}
  />
</div>

<style>
  .toolbar-preview {
    width: 720px;
    max-width: 100%;
    display: flex;
    align-items: flex-end;
  }
</style>

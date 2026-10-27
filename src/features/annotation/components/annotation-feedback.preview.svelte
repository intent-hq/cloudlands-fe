<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    failFirst?: boolean;
    deliveryDelayMs?: number;
    screenshotDelayMs?: number;
    failFirstScreenshotReport?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'annotation-feedback',
    title: 'Direct screen feedback',
    defaultState: 'retry',
    states: {
      ready: { props: { failFirst: false } },
      retry: { props: { failFirst: true } },
    },
    // Production toolbar and overlay share the local fixture in this sandbox only.
    captureReadiness: { selector: '[data-feedback-preview]', count: 1 },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { selectAnnotationDraft } from '$store/renderer/slices/annotation/annotation-selectors';
  import AnnotationToolbar from './AnnotationToolbar.svelte';
  import AnnotationOverlay from './AnnotationOverlay.svelte';
  import { installFeedbackPreview } from './annotation-feedback.preview-fixtures';
  let {
    failFirst = true,
    deliveryDelayMs = 0,
    screenshotDelayMs = 60,
    failFirstScreenshotReport = false,
  }: Props = $props();
  const draft$ = selectAnnotationDraft();
  let ready = $state(false);
  let transcript = $state('[]');
  let evidenceImages = $state('[]');
  let liveUpdates = $state(0);
  let fixture: ReturnType<typeof installFeedbackPreview>;
  onMount(() => {
    fixture = installFeedbackPreview({
      failFirst,
      deliveryDelayMs,
      screenshotDelayMs,
      failFirstScreenshotReport,
      onDelivery: (attempts) => {
        evidenceImages = JSON.stringify(
          attempts.at(-1)?.frames.map((frame) => frame.imageDataUrl) ?? [],
        );
        transcript = JSON.stringify(
          attempts.map(({ frames, ...attempt }) => ({
            ...attempt,
            frames: frames.map(({ imageDataUrl, ...frame }) => ({
              ...frame,
              imageBytes: imageDataUrl.length,
            })),
          })),
        );
      },
    });
    ready = true;
    return () => fixture.stop();
  });
</script>

<div
  data-feedback-preview
  data-delivery-transcript={transcript}
  data-delivery-images={evidenceImages}
  data-capture-count={$draft$.frames.length}
  style="min-height: 720px"
>
  <section class="preview-live-ui" data-testid="annotation-live-ui">
    <h1 class="type-title">Navigation review</h1>
    <p class="type-body">The UI stays live while you mark it up.</p>
    <p class="type-body" data-testid="live-update-count">Live updates: {liveUpdates}</p>
    <Button variant="secondary" onclick={() => liveUpdates++}>Update live content</Button>
  </section>
  {#if ready}<AnnotationOverlay />{/if}
  {#if ready}<div class="preview-toolbar"><AnnotationToolbar /></div>{/if}
</div>

<style>
  .preview-live-ui {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    padding: 56px;
    color: hsl(var(--foreground));
    background: hsl(var(--background));
  }
  .preview-live-ui p {
    margin-block: 16px;
  }
  .preview-toolbar {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    width: min(720px, calc(100vw - 32px));
    height: 320px;
    pointer-events: none;
    z-index: 5;
  }
  .preview-toolbar :global(.toolbar-window) {
    width: 100%;
    height: 100%;
  }
  .preview-toolbar :global(.annotation-toolbar-panel),
  .preview-toolbar :global(.annotation-destination-popover) {
    pointer-events: auto;
  }
</style>

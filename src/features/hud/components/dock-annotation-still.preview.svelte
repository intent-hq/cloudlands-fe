<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { dockStillWindowBounds, type DockAnnotationOverlayState } from '$shared/dock-annotation';
  import { dockAnnotationStill } from './dock-annotation-overlay.fixtures';

  interface PreviewProps {
    marked?: boolean;
    /** Capture scale: a 2× Retina still frames at half its pixel size. */
    displayScale?: number;
  }

  export const preview = definePreview<PreviewProps>({
    id: 'dock-annotation-still',
    title: 'Dock Mark up window',
    defaultState: 'marked',
    states: {
      marked: { props: { marked: true } },
      empty: { props: { marked: false } },
      'small-still': { props: { marked: true, displayScale: 4 } },
    },
  });

  const W = 1600;
  const H = 1000;

  // An explicitly synthetic page drawing, used only by this preview.
  // i18n-ignore (synthetic preview image)
  const stillUrl = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f3f3ef"/><rect width="${W}" height="72" fill="#ffffff"/><rect x="40" y="24" width="160" height="24" rx="6" fill="#141414"/><rect x="1300" y="20" width="120" height="32" rx="8" fill="#efefeb"/><rect x="1440" y="20" width="120" height="32" rx="8" fill="#141414"/><rect x="40" y="120" width="300" height="840" rx="16" fill="#ffffff" stroke="#e1e1dd"/><path d="M72 172h200M72 222h236M72 272h180M72 322h220" stroke="#e4e4e0" stroke-width="18" stroke-linecap="round"/><rect x="380" y="120" width="1180" height="840" rx="16" fill="#ffffff" stroke="#e1e1dd"/><path d="M430 190h420M430 250h900M430 300h760" stroke="#e4e4e0" stroke-width="22" stroke-linecap="round"/><rect x="430" y="380" width="520" height="300" rx="14" fill="#ececf6"/><rect x="990" y="380" width="520" height="300" rx="14" fill="#eef4ea"/><rect x="430" y="740" width="200" height="56" rx="10" fill="#141414"/><rect x="650" y="740" width="200" height="56" rx="10" fill="#efefeb"/></svg>`)}`;

  const marks: DockAnnotationOverlayState['marks'] = [
    { n: 1, tool: 'box', geometry: { kind: 'rect', x: 420, y: 370, w: 540, h: 320 } },
    {
      n: 2,
      tool: 'arrow',
      geometry: { kind: 'arrow', from: { x: 900, y: 880 }, to: { x: 650, y: 790 } },
    },
    {
      n: 3,
      tool: 'pen',
      geometry: {
        kind: 'path',
        points: [
          { x: 1290, y: 60 },
          { x: 1360, y: 6 },
          { x: 1500, y: 4 },
          { x: 1575, y: 40 },
          { x: 1520, y: 70 },
          { x: 1360, y: 68 },
          { x: 1292, y: 50 },
        ],
      },
    },
  ];
</script>

<script lang="ts">
  import '$lib/styles/dock-tokens.css';
  import DockAnnotationOverlay from './DockAnnotationOverlay.svelte';
  import type { DockAnnotationOverlayTransport } from '$shared/dock-annotation';

  let { marked = true, displayScale = 2 }: PreviewProps = $props();
  // Sized exactly as main frames this still on a 1440×875 work area.
  const bounds = $derived(
    dockStillWindowBounds(
      { x: 0, y: 0, width: 1440, height: 875 },
      { width: W, height: H, displayScale },
    ),
  );

  const overlay = $derived<DockAnnotationOverlayState>({
    ...dockAnnotationStill,
    tool: 'box',
    image: { width: W, height: H },
    still: { imageId: 'preview-still', width: W, height: H },
    marks: marked ? marks : [],
    marksRevision: marked ? marks.length : 0,
  });
  // No main process here: the window answers every request and keeps its state.
  const transport: DockAnnotationOverlayTransport = {
    pointer: async () => ({ ok: true }),
    gesture: async () => ({ ok: true }),
    toolbar: async () => true,
  };
</script>

<!-- The transform makes this box the containing block of the window's fixed frame. -->
<div
  class="still-window"
  style:width="{bounds.width}px"
  style:height="{bounds.height}px"
  data-testid="dock-annotation-still-preview"
>
  <DockAnnotationOverlay {overlay} {stillUrl} {transport} />
</div>

<style>
  .still-window {
    position: relative;
    transform: translateZ(0);
  }
</style>

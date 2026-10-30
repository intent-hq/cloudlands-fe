<script lang="ts" module>
  export type DockComposerGlyph =
    | 'viewfinder'
    | 'video'
    | 'pencil'
    | 'target'
    | 'box'
    | 'pen'
    | 'arrow'
    | 'mic'
    | 'stop'
    | 'play'
    | 'x'
    | 'cursor'
    | 'check'
    | 'paperclip'
    | 'eraser'
    | 'trash';
</script>

<script lang="ts">
  /**
   * Dock composer glyphs on the design-system icon grid: 16px, 1.5px stroke,
   * flat caps and rounded joins. 12px forms are simplified, not thinner.
   */
  let { glyph, size = 16 }: { glyph: DockComposerGlyph; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="butt"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
  data-dock-glyph={glyph}
>
  {#if glyph === 'viewfinder'}
    <path d="M2 5.5V3.5a1.5 1.5 0 0 1 1.5-1.5h2M10.5 2h2A1.5 1.5 0 0 1 14 3.5v2" />
    <path d="M14 10.5v2a1.5 1.5 0 0 1-1.5 1.5h-2M5.5 14h-2A1.5 1.5 0 0 1 2 12.5v-2" />
    <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
  {:else if glyph === 'video'}
    <rect x="1.75" y="4" width="8.75" height="8" rx="1.75" />
    <path d="M10.5 7l3.75-2.25v6.5L10.5 9" />
  {:else if glyph === 'pencil'}
    <path d="M10.25 2.75l3 3L5.5 13.5 2.25 13.75 2.5 10.5z" />
    <path d="M8.75 4.25l3 3" />
  {:else if glyph === 'target'}
    <circle cx="8" cy="8" r="5.75" />
    <circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none" />
  {:else if glyph === 'box'}
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
  {:else if glyph === 'pen'}
    <path d="M2 11.5c1.5-4 3.25-6.5 4.5-6.5 1.75 0 0 6 1.75 6S11.75 6 14 4.5" />
  {:else if glyph === 'arrow'}
    <path d="M3.5 12.5l8.5-8.5M6 3.75h6.25V10" />
  {:else if glyph === 'mic'}
    <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" />
    <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
  {:else if glyph === 'stop'}
    <rect x="2" y="2" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" />
  {:else if glyph === 'play'}
    <path d="M4.5 3v10l8.5-5z" fill="currentColor" />
  {:else if glyph === 'x'}
    <path d="M4 4l8 8M12 4l-8 8" />
  {:else if glyph === 'cursor'}
    <path d="M3.5 2.5l9 4.25-3.9 1.35L7.25 12z" />
  {:else if glyph === 'check'}
    <path d="M3 8.5l3.25 3.25L13 5" />
  {:else if glyph === 'eraser'}
    <path d="M9.25 2.5l4.25 4.25-6.25 6.25H4.5L2.5 11z" />
    <path d="M5.75 6l4.25 4.25M8 13h5.5" />
  {:else if glyph === 'trash'}
    <path
      d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.1M6.75 6.75v4M9.25 6.75v4"
    />
  {:else if glyph === 'paperclip'}
    <path
      d="M13.25 7.5l-5.5 5.5a3.18 3.18 0 0 1-4.5-4.5l5.75-5.75a2.12 2.12 0 0 1 3 3L6.25 11.5a1.06 1.06 0 0 1-1.5-1.5L10 4.75"
    />
  {/if}
</svg>

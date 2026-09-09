<script lang="ts">
  import type { MapActivityKind } from './core/types';

  let { kind }: { kind: MapActivityKind } = $props();
</script>

<svg
  aria-hidden="true"
  class="size-3 shrink-0"
  data-semantic-map-kind-glyph={kind}
  viewBox="0 0 12 12"
  width="12"
  height="12"
>
  {#if kind === 'read'}
    <circle cx="6" cy="6" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5" />
  {:else if kind === 'tool'}
    <rect
      x="3.25"
      y="3.25"
      width="5.5"
      height="5.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      transform="rotate(45 6 6)"
    />
  {:else if kind === 'thinking'}
    <circle
      cx="6"
      cy="6"
      r="4"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-dasharray="2 1.5"
    />
  {:else if kind === 'move'}
    <path
      d="M2 8L9 4M7 3L10 4L8.5 6.5"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.5"
    />
  {:else}
    <circle cx="6" cy="6" r="3.5" fill="currentColor" />
    {#if kind === 'delete'}
      <path
        d="M2.5 9.5L9.5 2.5"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-width="1.5"
      />
    {/if}
  {/if}
</svg>

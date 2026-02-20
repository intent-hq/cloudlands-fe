<script lang="ts">
  /**
   * ColorLegend - Shows color scale legend for commit-based encoding
   * Ported from githubocto/repo-visualizer
   */
  import { timeFormat } from 'd3';
  import type { ColorEncoding } from './types';

  interface Props {
    scale: ((value: number | Date) => string) | null;
    extent: [number | Date, number | Date];
    colorEncoding: ColorEncoding;
    width?: number;
    height?: number;
  }

  let { scale, extent, colorEncoding, width = 1000, height = 1000 }: Props = $props();

  // Format values appropriately based on type
  const formatValue = (d: number | Date): string => {
    if (typeof d === 'number') return String(d);
    return timeFormat('%b %Y')(d);
  };

  // Get ticks from the scale
  const ticks = $derived.by(() => {
    if (!scale || typeof (scale as any).ticks !== 'function') return [];
    return (scale as any).ticks(10) as (number | Date)[];
  });

  const gradientId = 'color-legend-gradient';
  const xPos = $derived(width - 160);
  const yPos = $derived(height - 90);

  const title = $derived(
    colorEncoding === 'number-of-changes' ? 'Number of changes' : 'Last change date',
  );
</script>

{#if scale && ticks.length > 0}
  <g transform="translate({xPos}, {yPos})">
    <text x="50" y="-5" font-size="10" text-anchor="middle" fill="currentColor">
      {title}
    </text>

    <defs>
      <linearGradient id={gradientId}>
        {#each ticks as tick, i (`tick-${i}-${tick}`)}
          {@const color = scale(tick)}
          <stop offset={i / (ticks.length - 1)} stop-color={color} />
        {/each}
      </linearGradient>
    </defs>

    <rect x="0" width="100" height="13" fill="url(#{gradientId})" />

    {#each extent as d, i (`extent-${i}-${d}`)}
      <text
        x={i ? 100 : 0}
        y="23"
        font-size="10"
        text-anchor={i ? 'end' : 'start'}
        fill="currentColor"
      >
        {formatValue(d)}
      </text>
    {/each}
  </g>
{/if}

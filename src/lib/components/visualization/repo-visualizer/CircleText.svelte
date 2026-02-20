<script lang="ts">
  /**
   * CircleText - Renders text along a circular path
   * Ported from githubocto/repo-visualizer
   */
  import { uniqueId } from './utils';

  interface Props {
    r?: number;
    rotate?: number;
    text?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: string;
    fontSize?: number;
    class?: string;
  }

  let {
    r = 10,
    rotate = 0,
    text = '',
    fill = '#374151',
    stroke,
    strokeWidth,
    fontSize = 14,
    class: className,
  }: Props = $props();

  // Generate unique ID for this instance
  const pathId = uniqueId('CircleText');

  // Build the circular path - a circle centered at origin
  const pathD = $derived(
    [
      ['M', 0, r].join(' '),
      ['A', r, r, 0, 0, 1, 0, -r].join(' '),
      ['A', r, r, 0, 0, 1, 0, r].join(' '),
    ].join(' '),
  );
</script>

<g class={className}>
  <path
    fill="none"
    d={pathD}
    id={pathId}
    transform="rotate({rotate})"
    style="pointer-events: none"
  />
  <text
    text-anchor="middle"
    {fill}
    {stroke}
    stroke-width={strokeWidth}
    style="font-size: {fontSize}px; transition: all 0.5s ease-out"
  >
    <textPath href="#{pathId}" startOffset="50%">
      {text}
    </textPath>
  </text>
</g>

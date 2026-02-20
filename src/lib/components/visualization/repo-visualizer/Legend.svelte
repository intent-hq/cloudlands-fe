<script lang="ts">
  /**
   * Legend - Shows file type color legend
   * Ported from githubocto/repo-visualizer
   */

  interface Props {
    fileTypes: string[];
    fileColors: Record<string, string>;
    width?: number;
    height?: number;
  }

  let { fileTypes = [], fileColors, width = 1000, height = 1000 }: Props = $props();

  const xPos = $derived(width - 60);
  const yPos = $derived(height - fileTypes.length * 15 - 20);
</script>

<g transform="translate({xPos}, {yPos})">
  {#each fileTypes as extension, i (extension)}
    <g transform="translate(0, {i * 15})">
      <circle r="5" fill={fileColors[extension] || 'hsl(var(--muted))'} />
      <text
        x="10"
        style="font-size: 14px; font-weight: 300"
        dominant-baseline="middle"
        fill="hsl(var(--foreground))"
      >
        .{extension}
      </text>
    </g>
  {/each}
  <g
    transform="translate(0, {fileTypes.length * 15 + 5})"
    fill="hsl(var(--muted-foreground))"
    style="font-weight: 300; font-style: italic; font-size: 12px"
  >
    <text>each dot sized by file size</text>
  </g>
</g>

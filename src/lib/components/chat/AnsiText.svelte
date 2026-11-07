<script lang="ts">
  import {
    ansi256ToHex,
    hasAnsi,
    parseAnsi,
    type AnsiColor,
    type AnsiSegment,
  } from '$lib/utils/ansi';

  let { text }: { text: string } = $props();

  // Tokyo Night, matching the shell output card's fixed dark surface.
  // Black and bright black text use a readable gray instead of near-background tones.
  const FG_PALETTE = [
    '#565f89',
    '#f7768e',
    '#9ece6a',
    '#e0af68',
    '#7aa2f7',
    '#bb9af7',
    '#7dcfff',
    '#a9b1d6',
    '#565f89',
    '#ff899d',
    '#9fe044',
    '#faba4a',
    '#8db0ff',
    '#c7a9ff',
    '#a4daff',
    '#c0caf5',
  ];
  const BG_PALETTE = [
    '#15161e',
    '#f7768e',
    '#9ece6a',
    '#e0af68',
    '#7aa2f7',
    '#bb9af7',
    '#7dcfff',
    '#a9b1d6',
    '#414868',
    '#ff899d',
    '#9fe044',
    '#faba4a',
    '#8db0ff',
    '#c7a9ff',
    '#a4daff',
    '#c0caf5',
  ];

  const color = (value: AnsiColor, palette: string[]) =>
    typeof value === 'string' ? value : value < 16 ? palette[value] : ansi256ToHex(value);

  function css(segment: AnsiSegment): string | undefined {
    const rules: string[] = [];
    if (segment.fg !== undefined) rules.push(`color:${color(segment.fg, FG_PALETTE)}`);
    if (segment.bg !== undefined) rules.push(`background-color:${color(segment.bg, BG_PALETTE)}`);
    if (segment.bold) rules.push('font-weight:600');
    if (segment.dim) rules.push('opacity:0.6');
    if (segment.italic) rules.push('font-style:italic');
    if (segment.underline) rules.push('text-decoration:underline');
    return rules.length > 0 ? rules.join(';') : undefined;
  }

  const segments = $derived(
    hasAnsi(text)
      ? parseAnsi(text).map((segment) => ({ text: segment.text, style: css(segment) }))
      : null,
  );
</script>

{#if segments}{#each segments as segment, index (index)}{#if segment.style}<span
        style={segment.style}>{segment.text}</span
      >{:else}{segment.text}{/if}{/each}{:else}{text}{/if}

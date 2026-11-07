<script lang="ts">
  import {
    ansi256ToHex,
    hasAnsi,
    parseAnsi,
    stripAnsi,
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

  const DEFAULT_FG = '#a9b1d6';
  const DEFAULT_BG = '#1a1b26';
  // Past this size, one text node beats thousands of spans.
  const MAX_STYLED_LENGTH = 200_000;

  function css(segment: AnsiSegment): string | undefined {
    let fg = segment.fg === undefined ? undefined : color(segment.fg, FG_PALETTE);
    let bg = segment.bg === undefined ? undefined : color(segment.bg, BG_PALETTE);
    if (segment.inverse) [fg, bg] = [bg ?? DEFAULT_BG, fg ?? DEFAULT_FG];
    if (segment.dim) fg = `color-mix(in srgb, ${fg ?? DEFAULT_FG} 60%, transparent)`;
    const rules: string[] = [];
    if (fg) rules.push(`color:${fg}`);
    if (bg) rules.push(`background-color:${bg}`);
    if (segment.bold) rules.push('font-weight:600');
    if (segment.italic) rules.push('font-style:italic');
    if (segment.underline) rules.push('text-decoration:underline');
    return rules.length > 0 ? rules.join(';') : undefined;
  }

  const plain = $derived(
    !hasAnsi(text) ? text : text.length > MAX_STYLED_LENGTH ? stripAnsi(text) : null,
  );
  const segments = $derived(
    plain === null
      ? parseAnsi(text).map((segment) => ({ text: segment.text, style: css(segment) }))
      : [],
  );
</script>

{#if plain === null}{#each segments as segment, index (index)}{#if segment.style}<span
        style={segment.style}>{segment.text}</span
      >{:else}{segment.text}{/if}{/each}{:else}{plain}{/if}

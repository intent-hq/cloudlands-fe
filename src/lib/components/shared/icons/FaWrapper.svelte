<script lang="ts">
  import RealFa from 'svelte-fa-original';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  // Local minimal copies of svelte-fa types to avoid subpath imports during typecheck
  type IconSize = 'xs' | 'sm' | 'lg' | `${number}x`;
  type FlipDir = 'horizontal' | 'vertical' | 'both';
  type PullDir = 'left' | 'right';
  type NormalizedSize = string; // allow values like "12px", "1rem", "2em", or "2x"

  interface Props {
    class?: string;
    id?: string;
    style?: string;
    icon: IconDefinition;
    title?: string;
    size?: number | string | IconSize;
    color?: string;
    fw?: boolean;
    pull?: PullDir;
    scale?: string | number;
    translateX?: string | number;
    translateY?: string | number;
    rotate?: number | string;
    flip?: FlipDir;
    spin?: boolean;
    pulse?: boolean;
    primaryColor?: string;
    secondaryColor?: string;
    primaryOpacity?: string | number;
    secondaryOpacity?: string | number;
    swapOpacity?: boolean;
  }

  let {
    class: className,
    id,
    style,
    icon,
    title,
    size,
    color,
    fw,
    pull,
    scale,
    translateX,
    translateY,
    rotate,
    flip,
    spin,
    pulse,
    primaryColor,
    secondaryColor,
    primaryOpacity,
    secondaryOpacity,
    swapOpacity,
  }: Props = $props();

  function toEmFromPx(px: number): NormalizedSize {
    const em = px / 16;
    // limit to 4 decimals and strip trailing zeros
    const val = Number(em.toFixed(4));
    return `${val}em` as NormalizedSize;
  }

  function normalizeSize(s?: number | string): NormalizedSize | undefined {
    if (s == null || s === '') return undefined;
    if (typeof s === 'number') return toEmFromPx(s);
    const str = String(s).trim();

    // Known FA keywords or Nx multiplier -> pass-through
    if (str === 'xs' || str === 'sm' || str === 'lg' || /^(\d+(?:\.\d+)?)x$/.test(str)) {
      return str as NormalizedSize;
    }

    // "12px" -> convert to em to avoid svelte-fa's internal "x" replacement breaking "px"
    const pxMatch = str.match(/^(\d+(?:\.\d+)?)px$/i);
    if (pxMatch) {
      return toEmFromPx(parseFloat(pxMatch[1]));
    }

    // Bare number -> interpret as pixels and convert to em
    if (/^\d+(?:\.\d+)?$/.test(str)) {
      return toEmFromPx(parseFloat(str));
    }

    // Any other CSS length or value (e.g., 1rem, 1.25em, clamp(...)) -> pass-through
    return str as NormalizedSize;
  }

  const normalizedSize = $derived(normalizeSize(size as any));
</script>

<RealFa
  {...{
    class: className,
    id,
    style,
    icon,
    title,
    color,
    fw,
    pull,
    scale,
    translateX,
    translateY,
    rotate,
    flip,
    spin,
    pulse,
    primaryColor,
    secondaryColor,
    primaryOpacity,
    secondaryOpacity,
    swapOpacity,
  }}
  size={normalizedSize}
/>

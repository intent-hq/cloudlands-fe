<script lang="ts">
  import { getPhosphorIconComponent, type IconDefinition } from '$lib/icons/phosphor-icons';

  type IconSize = 'xs' | 'sm' | 'lg' | `${number}x`;
  type FlipDir = 'horizontal' | 'vertical' | 'both';
  type PullDir = 'left' | 'right';
  type NormalizedSize = string;

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
    'data-panel-agent-chat-glyph'?: boolean;
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
    'data-panel-agent-chat-glyph': dataPanelAgentChatGlyph,
  }: Props = $props();

  function normalizeSize(s?: number | string): NormalizedSize | undefined {
    if (s == null || s === '') return undefined;
    if (typeof s === 'number') return `${s}px`;
    const str = String(s).trim();

    if (str === 'xs') return '0.75em';
    if (str === 'sm') return '0.875em';
    if (str === 'lg') return '1.333em';
    const multiplier = str.match(/^(\d+(?:\.\d+)?)x$/);
    if (multiplier) return `${multiplier[1]}em`;
    if (/^\d+(?:\.\d+)?$/.test(str)) return `${str}px`;
    return str;
  }

  const normalizedSize = $derived(normalizeSize(size as any));
  const Icon = $derived(getPhosphorIconComponent(icon));
  const iconWeight = $derived(
    secondaryColor || secondaryOpacity || primaryOpacity || swapOpacity ? 'duotone' : 'bold',
  );
  const mirrored = $derived(flip === 'horizontal' || flip === 'both');
  const transform = $derived.by(() => {
    const transforms: string[] = [];
    if (translateX || translateY)
      transforms.push(`translate(${translateX ?? 0}px, ${translateY ?? 0}px)`);
    if (scale) transforms.push(`scale(${scale})`);
    if (flip === 'vertical' || flip === 'both') transforms.push('scaleY(-1)');
    if (rotate) transforms.push(`rotate(${typeof rotate === 'number' ? `${rotate}deg` : rotate})`);
    return transforms.join(' ');
  });
  const computedStyle = $derived(
    [
      style,
      fw ? 'width: 1.25em' : '',
      pull ? `float: ${pull}` : '',
      transform ? `transform: ${transform}; transform-origin: center` : '',
    ]
      .filter(Boolean)
      .join('; '),
  );
  const computedClass = $derived(
    [className, spin ? 'animate-spin' : '', pulse ? 'animate-pulse' : ''].filter(Boolean).join(' '),
  );
</script>

<Icon
  class={computedClass || undefined}
  {id}
  style={computedStyle || undefined}
  size={normalizedSize}
  color={color ?? primaryColor ?? secondaryColor}
  weight={iconWeight}
  {mirrored}
  data-icon={icon.iconName}
  data-weight={iconWeight}
  data-panel-agent-chat-glyph={dataPanelAgentChatGlyph ? '' : undefined}
  aria-label={title}
  aria-hidden={title ? undefined : 'true'}
/>

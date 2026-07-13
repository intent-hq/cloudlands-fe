declare module 'svelte-fa' {
  import type { SvelteComponent } from 'svelte';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

  type IconSize = 'xs' | 'sm' | 'lg' | `${number}x`;
  type FlipDir = 'horizontal' | 'vertical' | 'both';
  type PullDir = 'left' | 'right';

  export interface FaProps {
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

  export class Fa extends SvelteComponent<FaProps> {}
  export default Fa;
  export class FaLayers extends SvelteComponent<Record<string, any>> {}
  export class FaLayersText extends SvelteComponent<Record<string, any>> {}
}

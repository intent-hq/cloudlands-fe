import type { HTMLInputAttributes } from 'svelte/elements';
import type { WithElementRef } from '$lib/utils';

export type SliderValue = number | [number, number];
export type SliderValuePosition = 'left' | 'right' | 'top' | 'bottom' | 'tooltip';
export type SliderAppearance = 'default' | 'overlay';

export interface SliderProps extends WithElementRef<
  Omit<HTMLInputAttributes, 'type' | 'value' | 'oninput' | 'onkeydown' | 'onfocus' | 'onblur'>
> {
  value?: number;
  onValueChange?: (value: number) => void;
  oninput?: HTMLInputAttributes['oninput'];
  onkeydown?: HTMLInputAttributes['onkeydown'];
  onfocus?: HTMLInputAttributes['onfocus'];
  onblur?: HTMLInputAttributes['onblur'];
  formatValue?: (value: number) => string;
  steps?: number[];
  showSteps?: boolean;
  showValue?: boolean;
  valuePosition?: SliderValuePosition;
  /** Make the track and fill transparent for use over surface-owned progress artwork. */
  appearance?: SliderAppearance;
  /** Called when pointer interaction begins, including presses that keep the current value. */
  onInteractionStart?: () => void;
}

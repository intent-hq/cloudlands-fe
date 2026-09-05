import { Spring } from '$lib/motion';

export function createSwitchThumbSpring(initial: number): Spring<number> {
  return new Spring(initial, 'fast');
}

export function retargetSwitchThumb(
  position: Spring<number>,
  target: number,
  instant = false,
): Spring<number> {
  void position.set(target, { instant });
  return position;
}

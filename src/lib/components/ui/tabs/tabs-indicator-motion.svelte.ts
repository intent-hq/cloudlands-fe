import { Spring } from '$lib/motion';
import type { ItemRect } from '$lib/interaction';

export interface TabsIndicatorSprings {
  top: Spring<number>;
  left: Spring<number>;
  width: Spring<number>;
  height: Spring<number>;
}

export function createTabsIndicatorSprings(rect: ItemRect): TabsIndicatorSprings {
  return {
    top: new Spring(rect.top, 'moderate'),
    left: new Spring(rect.left, 'moderate'),
    width: new Spring(rect.width, 'moderate'),
    height: new Spring(rect.height, 'moderate'),
  };
}

export function retargetTabsIndicator(
  springs: TabsIndicatorSprings,
  rect: ItemRect,
  instant = false,
): TabsIndicatorSprings {
  const options = { instant };
  void springs.top.set(rect.top, options);
  void springs.left.set(rect.left, options);
  void springs.width.set(rect.width, options);
  void springs.height.set(rect.height, options);
  return springs;
}

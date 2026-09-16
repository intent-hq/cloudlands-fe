/** Pause CSS animations on their targets, without invalidating every descendant of html. */
export function pauseWindowAnimations(root: HTMLElement) {
  const pausedTargets = new Set<Element>();
  const pauseAttribute = 'data-window-animation-paused';
  const isBlurred = () => root.hasAttribute('data-window-blurred');

  function pauseAnimations(animations: Animation[]) {
    // Collect all targets before changing styles, so enumeration does not repeatedly flush layout.
    const targets = new Set<Element>();
    for (const animation of animations) {
      if (
        !(animation instanceof CSSAnimation) ||
        (animation.playState !== 'running' && animation.playState !== 'paused')
      )
        continue;
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (target instanceof Element) targets.add(target);
    }
    for (const target of targets) {
      if (pausedTargets.has(target)) continue;
      pausedTargets.add(target);
      target.setAttribute(pauseAttribute, '');
    }
  }

  function resumeAnimations() {
    // Removing our override restores authored pause states, delays and progress. Do not call
    // Animation.play(): that would override animation-play-state changes made by components.
    for (const target of pausedTargets) target.removeAttribute(pauseAttribute);
    pausedTargets.clear();
  }

  function reconcile() {
    if (isBlurred()) pauseAnimations(root.getAnimations({ subtree: true }));
    else resumeAnimations();
  }

  function handleAnimationStart(event: AnimationEvent) {
    if (!isBlurred() || !(event.target instanceof Element)) return;
    // Also cover animations mounted or started after blur, including pseudo-elements.
    pauseAnimations(event.target.getAnimations({ subtree: true }));
  }

  const observer = new MutationObserver(reconcile);
  observer.observe(root, { attributes: true, attributeFilter: ['data-window-blurred'] });
  root.addEventListener('animationstart', handleAnimationStart, true);
  reconcile();

  return {
    destroy() {
      observer.disconnect();
      root.removeEventListener('animationstart', handleAnimationStart, true);
      resumeAnimations();
    },
  };
}

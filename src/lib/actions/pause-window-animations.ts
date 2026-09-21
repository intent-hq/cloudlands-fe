/**
 * Pause looping CSS animations on their targets while the window is blurred, without
 * invalidating every descendant of html.
 *
 * Only a `CSSAnimation` whose timing has `iterations === Infinity` (spinner, pulse,
 * shimmer) is marked. A finite animation is a one-shot entrance or flash and keeps
 * playing to completion in the background, so nothing freezes at frame 0 and replays
 * in a burst on refocus. Plain WAAPI animations (Svelte transitions) are never touched.
 */
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
        (animation.playState !== 'running' && animation.playState !== 'paused') ||
        animation.effect?.getTiming().iterations !== Infinity
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

  // A marked target whose loop was replaced by a finite animation (or none) while blurred
  // must not keep the finite one frozen until focus. Only marked targets are re-read.
  function releaseTargets(targets: Iterable<Element>) {
    for (const target of targets) {
      if (!pausedTargets.has(target)) continue;
      const loops =
        root.contains(target) &&
        target
          .getAnimations({ subtree: true })
          .some(
            (animation) =>
              animation instanceof CSSAnimation &&
              (animation.effect as KeyframeEffect | null)?.target === target &&
              animation.effect?.getTiming().iterations === Infinity,
          );
      if (loops) continue;
      pausedTargets.delete(target);
      target.removeAttribute(pauseAttribute);
    }
  }

  // animationstart arrives after a positive delay. Discover newly mounted or
  // restyled targets before their animation clocks advance while blurred.
  const targetObserver = new MutationObserver((records) => {
    if (!isBlurred()) return;
    const changed = new Set<Element>();
    const marked = new Set<Element>();
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          if (node instanceof Element) changed.add(node);
        }
      } else if (
        record.target instanceof Element &&
        record.attributeName !== pauseAttribute &&
        record.attributeName !== 'data-window-blurred'
      ) {
        changed.add(record.target);
      } else continue;
      if (!(record.target instanceof Element)) continue;
      for (const target of pausedTargets) {
        if (record.target.contains(target) || !root.contains(target)) marked.add(target);
      }
    }
    releaseTargets(marked);
    const animations: Animation[] = [];
    for (const target of changed) {
      if (!root.contains(target)) continue;
      let parent = target.parentElement;
      while (parent && !changed.has(parent)) parent = parent.parentElement;
      if (!parent) animations.push(...target.getAnimations({ subtree: true }));
    }
    pauseAnimations(animations);
  });

  function reconcile() {
    targetObserver.disconnect();
    if (isBlurred()) {
      targetObserver.observe(root, { childList: true, attributes: true, subtree: true });
      pauseAnimations(root.getAnimations({ subtree: true }));
    } else resumeAnimations();
  }

  function handleAnimationStart(event: AnimationEvent) {
    if (!isBlurred() || !(event.target instanceof Element)) return;
    // Also cover animations mounted or started after blur, including pseudo-elements.
    releaseTargets([event.target]);
    pauseAnimations(event.target.getAnimations({ subtree: true }));
  }

  // Stylesheet-driven changes do not mutate the target; its cancelled loop still reports here.
  function handleAnimationCancel(event: AnimationEvent) {
    if (!isBlurred() || !(event.target instanceof Element)) return;
    releaseTargets([event.target]);
  }

  const observer = new MutationObserver(reconcile);
  observer.observe(root, { attributes: true, attributeFilter: ['data-window-blurred'] });
  root.addEventListener('animationstart', handleAnimationStart, true);
  root.addEventListener('animationcancel', handleAnimationCancel, true);
  reconcile();

  return {
    destroy() {
      observer.disconnect();
      targetObserver.disconnect();
      root.removeEventListener('animationstart', handleAnimationStart, true);
      root.removeEventListener('animationcancel', handleAnimationCancel, true);
      resumeAnimations();
    },
  };
}

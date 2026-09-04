import { resize } from './size-transition';

type WorkspaceTabLifecycleMotionOptions = {
  duration: number;
  easing: (value: number) => number;
  phase: 'intro' | 'outro';
  onFrame: (overflow?: boolean) => void;
};

type PreparedTabOutro = {
  scrollLeft: number | null;
  basePaddingRight: number;
  paddingRight: number;
  originalPaddingRight: string;
  originalMarginRight: string;
  reserve: number;
  launcherLeft: number | null;
  launcherTargetLeft: number | null;
  gap: number;
  willOverflow: boolean;
};

type RetainedTabOutro = Pick<
  PreparedTabOutro,
  'basePaddingRight' | 'originalPaddingRight' | 'reserve'
>;

const preparedTabOutros = new WeakMap<HTMLElement, PreparedTabOutro>();
const retainedTabOutros = new WeakMap<HTMLElement, RetainedTabOutro>();

export function prepareTabOutro(strip: HTMLElement | null, workspaceId: string) {
  if (!strip) return;
  const slot = strip.querySelector<HTMLElement>(`[data-workspace-tab-motion="${workspaceId}"]`);
  if (!slot) return;
  const slotWidth = slot.getBoundingClientRect().width;
  const pinsRightEdge =
    strip.scrollWidth > strip.clientWidth + 1 &&
    strip.scrollWidth - strip.clientWidth - strip.scrollLeft <= 1;
  let retainedOutro = retainedTabOutros.get(strip);
  const gap = Number.parseFloat(getComputedStyle(strip).columnGap) || 0;
  const willOverflow =
    strip.scrollWidth -
      slotWidth -
      (strip.children.length > 1 ? gap : 0) -
      (retainedOutro?.reserve ?? 0) >
    strip.clientWidth + 1;
  if (retainedOutro && !pinsRightEdge) {
    strip.style.paddingRight = retainedOutro.originalPaddingRight;
    retainedTabOutros.delete(strip);
    retainedOutro = undefined;
  }
  const paddingRight = Number.parseFloat(getComputedStyle(strip).paddingRight) || 0;
  const reserve = pinsRightEdge ? slotWidth : 0;
  const launcher = strip.parentElement?.querySelector<HTMLElement>(
    '[data-workspace-repo-launcher], [data-preview-launcher]',
  );
  const launcherLeft = launcher?.getBoundingClientRect().left ?? null;
  const remainingRight = Math.max(
    ...Array.from(strip.children, (child) =>
      child === slot ? Number.NEGATIVE_INFINITY : child.getBoundingClientRect().right,
    ),
  );
  preparedTabOutros.set(strip, {
    scrollLeft: pinsRightEdge ? strip.scrollLeft : null,
    basePaddingRight: retainedOutro?.basePaddingRight ?? paddingRight,
    paddingRight,
    originalPaddingRight: retainedOutro?.originalPaddingRight ?? strip.style.paddingRight,
    originalMarginRight: slot.style.marginRight,
    reserve,
    gap,
    willOverflow,
    launcherLeft,
    launcherTargetLeft:
      launcherLeft !== null && Number.isFinite(remainingRight) && !willOverflow
        ? remainingRight + strip.scrollLeft + paddingRight
        : null,
  });
  if (pinsRightEdge) {
    strip.style.paddingRight = `${paddingRight + reserve}px`;
    slot.style.marginRight = `${-reserve}px`;
    strip.scrollLeft = preparedTabOutros.get(strip)?.scrollLeft ?? strip.scrollLeft;
  }
  return pinsRightEdge || willOverflow;
}

export function workspaceTabLifecycleMotion(
  node: HTMLElement,
  { duration, easing, phase, onFrame }: WorkspaceTabLifecycleMotionOptions,
) {
  const naturalWidth = node.getBoundingClientRect().width;
  const strip = node.parentElement;
  const controls = strip?.parentElement;
  const direction = phase;
  const preparedOutro = strip ? preparedTabOutros.get(strip) : undefined;
  const retainedIntro = direction === 'intro' && strip ? retainedTabOutros.get(strip) : undefined;
  const introReserve = Math.min(naturalWidth, retainedIntro?.reserve ?? 0);
  if (strip) preparedTabOutros.delete(strip);
  if (strip && direction === 'outro') retainedTabOutros.delete(strip);
  const launcher = controls?.querySelector<HTMLElement>(
    '[data-workspace-repo-launcher], [data-preview-launcher]',
  );
  const launcherOffset =
    preparedOutro?.launcherLeft != null && launcher
      ? preparedOutro.launcherLeft - launcher.getBoundingClientRect().left
      : naturalWidth + ((strip?.children.length ?? 0) > 1 ? 2 : 0);
  const pinnedScrollLeft =
    direction === 'outro' &&
    strip &&
    (preparedOutro?.scrollLeft != null ||
      (strip.scrollWidth > strip.clientWidth + 1 &&
        strip.scrollWidth - strip.clientWidth - strip.scrollLeft <= 1))
      ? (preparedOutro?.scrollLeft ?? strip.scrollLeft)
      : null;
  const offsetsLauncher = direction === 'outro' && Math.abs(launcherOffset) > 0.01;
  const launcherTargetLeft = preparedOutro?.launcherTargetLeft ?? null;
  const launcherStartLeft = preparedOutro?.launcherLeft ?? null;
  const releasesReserve =
    direction === 'outro' && preparedOutro != null && preparedOutro.scrollLeft !== null;
  const releasesLauncher =
    releasesReserve && launcherTargetLeft !== null && launcherStartLeft !== null;
  const tracksLauncher = offsetsLauncher || releasesReserve;
  let appliedLauncherOffset = offsetsLauncher ? launcherOffset : 0;
  let appliedReserve = preparedOutro?.reserve ?? 0;
  let appliedScrollLeft = pinnedScrollLeft;
  let previousLauncherLeft = preparedOutro?.launcherLeft ?? null;
  let appliedSlotOffset = 0;

  if (duration === 0) {
    if (strip && preparedOutro) strip.style.paddingRight = preparedOutro.originalPaddingRight;
    if (strip && retainedIntro) {
      const reserve = retainedIntro.reserve - introReserve;
      strip.style.paddingRight = `${retainedIntro.basePaddingRight + reserve}px`;
      if (reserve > 0) retainedTabOutros.set(strip, { ...retainedIntro, reserve });
      else retainedTabOutros.delete(strip);
    }
    if (preparedOutro) node.style.marginRight = preparedOutro.originalMarginRight;
    node.style.removeProperty('overflow');
    const visual = node.querySelector<HTMLElement>('[data-workspace-tab-visual]');
    visual?.style.removeProperty('translate');
    visual?.style.removeProperty('opacity');
    controls?.style.setProperty('--workspace-tab-launcher-offset', '0px');
    onFrame(
      preparedOutro && preparedOutro.scrollLeft !== null && !preparedOutro.willOverflow
        ? false
        : undefined,
    );
    return { duration: 0 };
  }

  if (controls && offsetsLauncher) {
    controls.style.setProperty('--workspace-tab-launcher-offset', `${launcherOffset}px`);
  } else if (direction === 'intro') {
    controls?.style.setProperty('--workspace-tab-launcher-offset', '0px');
  }
  const slotTransition = resize(node, {
    axis: 'x',
    duration,
    easing,
    fade: false,
    clip: true,
  });
  const lifecycleDuration = releasesReserve ? duration * 2.25 : duration;
  const collapseEndProgress = releasesReserve ? 1 - duration / lifecycleDuration : 0;
  const getSlotProgress = (progress: number) =>
    releasesReserve
      ? progress > collapseEndProgress
        ? easing((progress - collapseEndProgress) / (1 - collapseEndProgress))
        : 0
      : progress;

  return {
    ...slotTransition,
    duration: lifecycleDuration,
    easing: releasesReserve ? (value: number) => value : easing,
    css: (progress: number) => {
      const slotProgress = getSlotProgress(progress);
      return `${slotTransition.css?.(slotProgress, 1 - slotProgress) ?? ''}; max-width: ${slotProgress * naturalWidth}px`;
    },
    tick: (progress: number) => {
      const slotProgress = getSlotProgress(progress);
      const releaseProgress = releasesReserve
        ? progress < 0.85
          ? 1 - easing(1 - progress / 0.85)
          : 1
        : 1;
      if (strip && pinnedScrollLeft !== null) {
        if (preparedOutro) {
          const desiredReserve = releaseProgress * preparedOutro.reserve;
          appliedReserve += Math.min(5.5, Math.max(-5.5, desiredReserve - appliedReserve));
          const reserve = appliedReserve;
          const targetScrollLeft = preparedOutro.willOverflow
            ? Math.max(0, pinnedScrollLeft - preparedOutro.reserve - preparedOutro.gap)
            : 0;
          const desiredScrollLeft =
            targetScrollLeft + releaseProgress * (pinnedScrollLeft - targetScrollLeft);
          appliedScrollLeft ??= desiredScrollLeft;
          appliedScrollLeft += Math.min(7.5, Math.max(-7.5, desiredScrollLeft - appliedScrollLeft));
          strip.style.paddingRight = `${preparedOutro.paddingRight + reserve}px`;
          node.style.marginRight = `${-slotProgress * preparedOutro.reserve}px`;
          strip.scrollLeft = appliedScrollLeft;
          if (reserve > 0.01) {
            retainedTabOutros.set(strip, {
              basePaddingRight: preparedOutro.basePaddingRight,
              originalPaddingRight: preparedOutro.originalPaddingRight,
              reserve: preparedOutro.paddingRight - preparedOutro.basePaddingRight + reserve,
            });
          } else {
            strip.style.paddingRight = preparedOutro.originalPaddingRight;
            retainedTabOutros.delete(strip);
          }
        } else {
          strip.scrollLeft = pinnedScrollLeft;
        }
      }
      if (strip && retainedIntro) {
        const reserve = retainedIntro.reserve - progress * introReserve;
        strip.style.paddingRight = `${retainedIntro.basePaddingRight + reserve}px`;
        if (reserve > 0.01) retainedTabOutros.set(strip, { ...retainedIntro, reserve });
        else retainedTabOutros.delete(strip);
      }
      if ((slotProgress > 0 && slotProgress < 1) || direction === 'outro')
        node.style.overflow = 'hidden';
      else node.style.removeProperty('overflow');
      const previousSlot = direction === 'outro' ? node.previousElementSibling : null;
      if (previousSlot instanceof HTMLElement) {
        const targetLeft = previousSlot.getBoundingClientRect().right + (preparedOutro?.gap ?? 0);
        appliedSlotOffset += targetLeft - node.getBoundingClientRect().left;
        node.style.translate = `${appliedSlotOffset}px 0`;
      }
      if (controls && tracksLauncher) {
        const desiredOffset = slotProgress * launcherOffset;
        const currentLeft = launcher?.getBoundingClientRect().left;
        if (currentLeft != null && previousLauncherLeft != null && progress > 0) {
          const desiredLeft =
            launcherTargetLeft !== null && launcherStartLeft !== null
              ? launcherTargetLeft + releaseProgress * (launcherStartLeft - launcherTargetLeft)
              : currentLeft + desiredOffset - appliedLauncherOffset;
          const delta = Math.min(0, Math.max(-7.5, desiredLeft - previousLauncherLeft));
          previousLauncherLeft += delta;
          appliedLauncherOffset = releasesLauncher
            ? previousLauncherLeft - currentLeft + appliedLauncherOffset
            : desiredOffset + previousLauncherLeft - desiredLeft;
        } else {
          appliedLauncherOffset = desiredOffset;
          previousLauncherLeft = currentLeft ?? previousLauncherLeft;
        }
        controls.style.setProperty('--workspace-tab-launcher-offset', `${appliedLauncherOffset}px`);
      }
      const visual = node.querySelector<HTMLElement>('[data-workspace-tab-visual]');
      if (visual) {
        if (direction === 'intro' && slotProgress === 1) {
          visual.style.removeProperty('translate');
          visual.style.removeProperty('opacity');
        } else {
          visual.style.translate = `0 ${(1 - slotProgress) * 10}px`;
          visual.style.opacity = String(slotProgress);
        }
      }
      onFrame(
        releasesReserve && releaseProgress < 1 && preparedOutro && !preparedOutro.willOverflow
          ? false
          : undefined,
      );
    },
  };
}

import { resize } from './size-transition';

type WorkspaceTabLifecycleMotionOptions = {
  duration: number;
  easing: (value: number) => number;
  phase: 'intro' | 'outro';
  onFrame: (overflow?: boolean) => void;
};

type PreparedTabOutroGroup = {
  scrollLeft: number | null;
  basePaddingRight: number;
  paddingRight: number;
  originalPaddingRight: string;
  reserve: number;
  removedFootprint: number;
  launcherLeft: number | null;
  launcherTargetLeft: number | null;
  gap: number;
  willOverflow: boolean;
};

type PreparedTabOutro = {
  group: PreparedTabOutroGroup;
  managesGroup: boolean;
  originalMarginRight: string;
  slotReserve: number;
};

type PreparedTabOutroRegistration = {
  originalPaddingRight: string;
  slots: Array<{ node: HTMLElement; originalMarginRight: string }>;
};

type RetainedTabOutro = Pick<
  PreparedTabOutroGroup,
  'basePaddingRight' | 'originalPaddingRight' | 'reserve'
>;

const preparedTabOutros = new WeakMap<HTMLElement, PreparedTabOutro>();
const preparedTabOutroRegistrations = new WeakMap<HTMLElement, PreparedTabOutroRegistration>();
const retainedTabOutros = new WeakMap<HTMLElement, RetainedTabOutro>();
const WORKSPACE_TAB_MAX_RESERVE_STEP_PX = 5.5;
const WORKSPACE_TAB_MAX_LAUNCHER_STEP_PX = 2.5;
export const WORKSPACE_TAB_MAX_SCROLL_STEP_PX = 7.5;

export function prepareTabOutros(strip: HTMLElement | null, workspaceIds: string[]) {
  if (!strip) return;
  const previousRegistration = preparedTabOutroRegistrations.get(strip);
  if (previousRegistration) {
    strip.style.paddingRight = previousRegistration.originalPaddingRight;
    for (const { node, originalMarginRight } of previousRegistration.slots) {
      node.style.marginRight = originalMarginRight;
      preparedTabOutros.delete(node);
    }
    preparedTabOutroRegistrations.delete(strip);
  }
  const requestedIds = new Set(workspaceIds);
  const slots = Array.from(strip.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && requestedIds.has(child.dataset.workspaceTabMotion ?? ''),
  );
  if (slots.length === 0) return;
  const slotWidths = slots.map((slot) => slot.getBoundingClientRect().width);
  const slotWidth = slotWidths.reduce((total, width) => total + width, 0);
  const pinsRightEdge =
    strip.scrollWidth > strip.clientWidth + 1 &&
    strip.scrollWidth - strip.clientWidth - strip.scrollLeft <= 1;
  let retainedOutro = retainedTabOutros.get(strip);
  const gap = Number.parseFloat(getComputedStyle(strip).columnGap) || 0;
  if (retainedOutro && !pinsRightEdge) {
    strip.style.paddingRight = retainedOutro.originalPaddingRight;
    retainedTabOutros.delete(strip);
    retainedOutro = undefined;
  }
  const paddingRight = Number.parseFloat(getComputedStyle(strip).paddingRight) || 0;
  const remainingCount = strip.children.length - slots.length;
  const removedGapCount = Math.max(0, strip.children.length - 1) - Math.max(0, remainingCount - 1);
  const removedFootprint = slotWidth + removedGapCount * gap;
  const willOverflow =
    strip.scrollWidth - removedFootprint - (retainedOutro?.reserve ?? 0) > strip.clientWidth + 1;
  const reserve = pinsRightEdge ? slotWidth : 0;
  const launcher = strip.parentElement?.querySelector<HTMLElement>(
    '[data-workspace-repo-launcher], [data-preview-launcher]',
  );
  const launcherLeft = launcher?.getBoundingClientRect().left ?? null;
  const closingSlots = new Set(slots);
  const remainingRight = Math.max(
    ...Array.from(strip.children, (child) =>
      closingSlots.has(child as HTMLElement)
        ? Number.NEGATIVE_INFINITY
        : child.getBoundingClientRect().right,
    ),
  );
  const group: PreparedTabOutroGroup = {
    scrollLeft: pinsRightEdge ? strip.scrollLeft : null,
    basePaddingRight: retainedOutro?.basePaddingRight ?? paddingRight,
    paddingRight,
    originalPaddingRight: retainedOutro?.originalPaddingRight ?? strip.style.paddingRight,
    reserve,
    removedFootprint,
    gap,
    willOverflow,
    launcherLeft,
    launcherTargetLeft:
      launcherLeft !== null && Number.isFinite(remainingRight) && !willOverflow
        ? remainingRight + strip.scrollLeft + paddingRight
        : null,
  };
  const registration = {
    originalPaddingRight: group.originalPaddingRight,
    slots: slots.map((node) => ({ node, originalMarginRight: node.style.marginRight })),
  };
  preparedTabOutroRegistrations.set(strip, registration);
  slots.forEach((slot, index) => {
    preparedTabOutros.set(slot, {
      group,
      managesGroup: index === 0,
      originalMarginRight: slot.style.marginRight,
      slotReserve: slotWidths[index],
    });
  });
  if (pinsRightEdge) {
    strip.style.paddingRight = `${paddingRight + reserve}px`;
    slots.forEach((slot, index) => (slot.style.marginRight = `${-slotWidths[index]}px`));
    strip.scrollLeft = group.scrollLeft ?? strip.scrollLeft;
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
  const preparedOutro = preparedTabOutros.get(node);
  const preparedGroup = preparedOutro?.group;
  if (preparedOutro) preparedTabOutros.delete(node);
  if (strip && preparedOutro) preparedTabOutroRegistrations.delete(strip);
  const retainedIntro = direction === 'intro' && strip ? retainedTabOutros.get(strip) : undefined;
  const introReserve = Math.min(naturalWidth, retainedIntro?.reserve ?? 0);
  if (strip && direction === 'outro' && (!preparedOutro || preparedOutro.managesGroup)) {
    retainedTabOutros.delete(strip);
  }
  const launcher = controls?.querySelector<HTMLElement>(
    '[data-workspace-repo-launcher], [data-preview-launcher]',
  );
  const launcherOffset =
    preparedOutro && !preparedOutro.managesGroup
      ? 0
      : preparedGroup?.launcherLeft != null && launcher
        ? preparedGroup.launcherLeft - launcher.getBoundingClientRect().left
        : naturalWidth + ((strip?.children.length ?? 0) > 1 ? 2 : 0);
  const pinnedScrollLeft =
    direction === 'outro' &&
    strip &&
    (!preparedOutro || preparedOutro.managesGroup) &&
    (preparedGroup?.scrollLeft != null ||
      (strip.scrollWidth > strip.clientWidth + 1 &&
        strip.scrollWidth - strip.clientWidth - strip.scrollLeft <= 1))
      ? (preparedGroup?.scrollLeft ?? strip.scrollLeft)
      : null;
  const offsetsLauncher = direction === 'outro' && Math.abs(launcherOffset) > 0.01;
  const launcherTargetLeft = preparedGroup?.launcherTargetLeft ?? null;
  const launcherStartLeft = preparedGroup?.launcherLeft ?? null;
  const releasesReserve =
    direction === 'outro' && preparedGroup != null && preparedGroup.scrollLeft !== null;
  const releasesLauncher =
    releasesReserve && launcherTargetLeft !== null && launcherStartLeft !== null;
  const tracksLauncher =
    (preparedOutro?.managesGroup ?? true) && (offsetsLauncher || releasesReserve);
  let appliedLauncherOffset = offsetsLauncher ? launcherOffset : 0;
  let appliedReserve = preparedGroup?.reserve ?? 0;
  let appliedScrollLeft = pinnedScrollLeft;
  let previousLauncherLeft = preparedGroup?.launcherLeft ?? null;
  let appliedSlotOffset = 0;

  if (duration === 0) {
    if (strip && preparedOutro?.managesGroup && preparedGroup) {
      strip.style.paddingRight = preparedGroup.originalPaddingRight;
    }
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
      preparedOutro?.managesGroup &&
        preparedGroup &&
        preparedGroup.scrollLeft !== null &&
        !preparedGroup.willOverflow
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
      const previousSlot = direction === 'outro' ? node.previousElementSibling : null;
      const previousSlotRight =
        previousSlot instanceof HTMLElement ? previousSlot.getBoundingClientRect().right : null;
      const nodeLeft = previousSlotRight === null ? null : node.getBoundingClientRect().left;
      const launcherLeft =
        controls && tracksLauncher ? launcher?.getBoundingClientRect().left : undefined;
      const slotProgress = getSlotProgress(progress);
      const releaseProgress = releasesReserve
        ? progress < 0.85
          ? 1 - easing(1 - progress / 0.85)
          : 1
        : 1;
      if (strip && pinnedScrollLeft !== null) {
        if (preparedOutro?.managesGroup && preparedGroup) {
          const desiredReserve = releaseProgress * preparedGroup.reserve;
          appliedReserve += Math.min(
            WORKSPACE_TAB_MAX_RESERVE_STEP_PX,
            Math.max(-WORKSPACE_TAB_MAX_RESERVE_STEP_PX, desiredReserve - appliedReserve),
          );
          const reserve = appliedReserve;
          const targetScrollLeft = preparedGroup.willOverflow
            ? Math.max(0, pinnedScrollLeft - preparedGroup.removedFootprint)
            : 0;
          const desiredScrollLeft =
            targetScrollLeft + releaseProgress * (pinnedScrollLeft - targetScrollLeft);
          appliedScrollLeft ??= desiredScrollLeft;
          appliedScrollLeft += Math.min(
            WORKSPACE_TAB_MAX_SCROLL_STEP_PX,
            Math.max(-WORKSPACE_TAB_MAX_SCROLL_STEP_PX, desiredScrollLeft - appliedScrollLeft),
          );
          strip.style.paddingRight = `${preparedGroup.paddingRight + reserve}px`;
          strip.scrollLeft = appliedScrollLeft;
          if (reserve > 0.01) {
            retainedTabOutros.set(strip, {
              basePaddingRight: preparedGroup.basePaddingRight,
              originalPaddingRight: preparedGroup.originalPaddingRight,
              reserve: preparedGroup.paddingRight - preparedGroup.basePaddingRight + reserve,
            });
          } else {
            strip.style.paddingRight = preparedGroup.originalPaddingRight;
            retainedTabOutros.delete(strip);
          }
        } else {
          strip.scrollLeft = pinnedScrollLeft;
        }
      }
      if (direction === 'outro' && preparedOutro) {
        node.style.marginRight = `${-slotProgress * preparedOutro.slotReserve}px`;
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
      if (previousSlotRight !== null && nodeLeft !== null) {
        const targetLeft =
          previousSlotRight +
          (preparedGroup?.gap ?? 0) +
          ((appliedScrollLeft ?? 0) > 0.5 ? WORKSPACE_TAB_MAX_RESERVE_STEP_PX : 0);
        appliedSlotOffset += targetLeft - nodeLeft;
        node.style.translate = `${appliedSlotOffset}px 0`;
      }
      if (controls && tracksLauncher) {
        const desiredOffset = slotProgress * launcherOffset;
        const currentLeft = launcherLeft;
        if (currentLeft != null && previousLauncherLeft != null) {
          const desiredLeft =
            launcherTargetLeft !== null && launcherStartLeft !== null
              ? launcherTargetLeft + releaseProgress * (launcherStartLeft - launcherTargetLeft)
              : currentLeft + desiredOffset - appliedLauncherOffset;
          const delta = Math.min(
            0,
            Math.max(-WORKSPACE_TAB_MAX_LAUNCHER_STEP_PX, desiredLeft - previousLauncherLeft),
          );
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
        releasesReserve &&
          preparedOutro?.managesGroup &&
          preparedGroup &&
          !preparedGroup.willOverflow
          ? (appliedScrollLeft ?? 0) > 0.5
          : undefined,
      );
    },
  };
}

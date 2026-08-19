export interface LayoutRevealElements {
  container: HTMLElement;
  target: HTMLElement;
}

interface LayoutStableRevealRequest {
  resolveElements: () => LayoutRevealElements | null;
  isCurrent: () => boolean;
  reveal: (elements: LayoutRevealElements) => void;
  onTargetRemoved?: () => void;
}

interface LayoutSnapshot {
  values: number[];
}

const REQUIRED_STABLE_FRAMES = 2;

function measureLayout({ container, target }: LayoutRevealElements): LayoutSnapshot {
  const viewport = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetWidth = Number.isFinite(targetRect.width)
    ? targetRect.width
    : targetRect.right - targetRect.left;
  return {
    values: [
      viewport.left,
      viewport.right,
      container.clientWidth,
      container.scrollWidth,
      targetRect.left,
      targetRect.right,
      targetWidth,
      target.offsetLeft,
      target.offsetWidth,
    ],
  };
}

function snapshotsMatch(previous: LayoutSnapshot | null, next: LayoutSnapshot): boolean {
  if (!previous) return false;
  const tolerance = 0.25 / Math.max(1, globalThis.devicePixelRatio || 1);
  return next.values.every((value, index) => Math.abs(value - previous.values[index]) <= tolerance);
}

/** Wait for mounted horizontal geometry to remain stable before one reveal commit. */
export function createLayoutStableRevealScheduler() {
  let frame: number | null = null;
  let version = 0;

  function cancel() {
    version += 1;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function schedule(request: LayoutStableRevealRequest) {
    cancel();
    const requestVersion = version;
    let previous: LayoutSnapshot | null = null;
    let stableFrames = 0;
    let sawTarget = false;

    const measure = () => {
      frame = null;
      if (requestVersion !== version || !request.isCurrent()) return;
      const elements = request.resolveElements();
      if (!elements) {
        if (sawTarget) {
          request.onTargetRemoved?.();
          return;
        }
        frame = requestAnimationFrame(measure);
        return;
      }

      sawTarget = true;
      const next = measureLayout(elements);
      stableFrames = snapshotsMatch(previous, next) ? stableFrames + 1 : 0;
      previous = next;
      if (stableFrames >= REQUIRED_STABLE_FRAMES) {
        if (requestVersion === version && request.isCurrent()) request.reveal(elements);
        return;
      }
      frame = requestAnimationFrame(measure);
    };

    frame = requestAnimationFrame(measure);
  }

  return { cancel, schedule };
}

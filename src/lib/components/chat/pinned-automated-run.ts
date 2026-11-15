import { scheduleLayoutRead, type CancelLayoutTask } from '$lib/utils/layout-phases';

const SELECTOR = '[data-automated-run-hint][data-automated-run-expanded="true"]';

export interface PinnedAutomatedRunOptions {
  enabled: boolean;
  /** Re-measure when the set of expanded runs changes. */
  revision: string;
  onChange: (runId: string | null) => void;
}

/**
 * The expanded run whose hint row has scrolled above the viewport. It stays
 * pinned after the reader scrolls past the run, so Collapse is always reachable.
 */
function findPinnedAutomatedRun(container: HTMLElement): string | null {
  const top = container.getBoundingClientRect().top;
  let pinned: string | null = null;
  for (const hint of container.querySelectorAll<HTMLElement>(SELECTOR)) {
    if (hint.getBoundingClientRect().bottom <= top - 1)
      pinned = hint.dataset.automatedRunHint ?? null;
  }
  return pinned;
}

export function trackPinnedAutomatedRun(
  container: HTMLElement,
  initialOptions: PinnedAutomatedRunOptions,
) {
  let options = initialOptions;
  let current: string | null = null;
  let cancelRead: CancelLayoutTask | null = null;
  let readPending = false;
  let resizeObserver: ResizeObserver | null = null;

  const emit = (next: string | null) => {
    if (next === current) return;
    current = next;
    options.onChange(next);
  };
  const measure = () => {
    readPending = false;
    if (resizeObserver) emit(findPinnedAutomatedRun(container));
  };
  const schedule = () => {
    if (readPending || !resizeObserver) return;
    readPending = true;
    cancelRead = scheduleLayoutRead(measure);
  };

  // Attaches nothing while disabled, so the Labs switch off costs no observers.
  function start() {
    if (resizeObserver) return;
    resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(container);
    if (container.firstElementChild) resizeObserver.observe(container.firstElementChild);
    container.addEventListener('scroll', schedule, { passive: true });
    schedule();
  }
  function stop() {
    if (!resizeObserver) return emit(null);
    container.removeEventListener('scroll', schedule);
    resizeObserver?.disconnect();
    resizeObserver = null;
    cancelRead?.();
    cancelRead = null;
    readPending = false;
    emit(null);
  }

  if (options.enabled) start();

  return {
    update(next: PinnedAutomatedRunOptions) {
      options = next;
      if (!options.enabled) stop();
      else if (resizeObserver) schedule();
      else start();
    },
    destroy() {
      stop();
    },
  };
}

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
  const resizeObserver = new ResizeObserver(() => schedule());

  const emit = (next: string | null) => {
    if (next === current) return;
    current = next;
    options.onChange(next);
  };
  const measure = () => {
    readPending = false;
    emit(options.enabled ? findPinnedAutomatedRun(container) : null);
  };
  function schedule() {
    if (readPending) return;
    readPending = true;
    cancelRead = scheduleLayoutRead(measure);
  }

  container.addEventListener('scroll', schedule, { passive: true });
  resizeObserver.observe(container);
  if (container.firstElementChild) resizeObserver.observe(container.firstElementChild);
  schedule();

  return {
    update(next: PinnedAutomatedRunOptions) {
      options = next;
      if (!options.enabled) emit(null);
      else schedule();
    },
    destroy() {
      container.removeEventListener('scroll', schedule);
      resizeObserver.disconnect();
      cancelRead?.();
    },
  };
}

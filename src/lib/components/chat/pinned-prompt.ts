import type { AgentMessage } from '$shared/types';

export interface PinnedPromptState {
  id: string;
  message: AgentMessage;
}

export interface PinnedPromptController {
  update(container: HTMLElement, enabled: boolean): PinnedPromptState | null;
  reset(): void;
}

const SELECTOR = '[data-pinnable-user-prompt][data-pinned-prompt-id]';
const ENTER_OFFSET = 1;
const EXIT_OFFSET = 2;

interface Candidate extends PinnedPromptState {
  sourceBottom: number;
  turnBottom: number;
}

export interface PinnedPromptTrackerOptions {
  enabled: boolean;
  onChange: (prompt: PinnedPromptState | null) => void;
}

function candidates(container: HTMLElement): Candidate[] {
  return Array.from(container.querySelectorAll<HTMLElement>(SELECTOR))
    .map((source) => {
      const id = source.dataset.pinnedPromptId;
      const message = (source as HTMLElement & { __pinnedPromptMessage?: AgentMessage })
        .__pinnedPromptMessage;
      const turn = source.closest<HTMLElement>('[data-conversation-turn]');
      if (!id || !message || !turn) return null;
      return {
        id,
        message,
        sourceBottom: source.getBoundingClientRect().bottom,
        turnBottom: turn.getBoundingClientRect().bottom,
      };
    })
    .filter((candidate): candidate is Candidate => candidate !== null);
}

export function createPinnedPromptController(): PinnedPromptController {
  let currentId: string | null = null;
  return {
    update(container, enabled) {
      if (!enabled) {
        currentId = null;
        return null;
      }
      const containerTop = container.getBoundingClientRect().top;
      const measured = candidates(container);
      const current = measured.find((candidate) => candidate.id === currentId);
      if (
        current &&
        current.sourceBottom <= containerTop + EXIT_OFFSET &&
        current.turnBottom > containerTop
      ) {
        return current;
      }

      for (let index = measured.length - 1; index >= 0; index -= 1) {
        const candidate = measured[index];
        if (
          candidate.sourceBottom <= containerTop - ENTER_OFFSET &&
          candidate.turnBottom > containerTop + ENTER_OFFSET
        ) {
          currentId = candidate.id;
          return candidate;
        }
      }
      currentId = null;
      return null;
    },
    reset() {
      currentId = null;
    },
  };
}

export function trackPinnedPrompt(
  container: HTMLElement,
  initialOptions: PinnedPromptTrackerOptions,
) {
  const controller = createPinnedPromptController();
  let options = initialOptions;
  let current: PinnedPromptState | null = null;
  let frame: number | null = null;
  let destroyed = false;
  const observedElements = new WeakSet<Element>();

  const measure = () => {
    frame = null;
    if (destroyed) return;
    const next = controller.update(container, options.enabled);
    if (next?.id === current?.id && next?.message === current?.message) return;
    current = next;
    options.onChange(next);
  };
  const schedule = () => {
    if (destroyed || frame !== null) return;
    frame = requestAnimationFrame(measure);
  };
  const resizeObserver = new ResizeObserver(schedule);
  const observeGeometry = () => {
    for (const element of [container, container.firstElementChild]) {
      if (!element || observedElements.has(element)) continue;
      observedElements.add(element);
      resizeObserver.observe(element);
    }
  };
  observeGeometry();
  const mutationObserver = new MutationObserver(() => {
    observeGeometry();
    schedule();
  });
  mutationObserver.observe(container, { childList: true, subtree: true, characterData: true });
  container.addEventListener('scroll', schedule, { passive: true });
  schedule();

  return {
    update(nextOptions: PinnedPromptTrackerOptions) {
      options = nextOptions;
      schedule();
    },
    destroy() {
      destroyed = true;
      container.removeEventListener('scroll', schedule);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      controller.reset();
    },
  };
}

export function attachPinnedPromptMessage(element: HTMLElement, message: AgentMessage): void {
  (element as HTMLElement & { __pinnedPromptMessage?: AgentMessage }).__pinnedPromptMessage =
    message;
}

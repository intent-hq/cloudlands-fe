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

export function createPinnedPromptController(): PinnedPromptController {
  return {
    update(container, enabled) {
      if (!enabled) return null;
      const containerTop = container.getBoundingClientRect().top;
      let candidate: HTMLElement | null = null;
      for (const element of container.querySelectorAll<HTMLElement>(SELECTOR)) {
        if (element.getBoundingClientRect().top <= containerTop) candidate = element;
        else break;
      }
      if (!candidate) return null;
      const id = candidate.dataset.pinnedPromptId;
      const message = (candidate as HTMLElement & { __pinnedPromptMessage?: AgentMessage })
        .__pinnedPromptMessage;
      return id && message ? { id, message } : null;
    },
    reset() {},
  };
}

export function attachPinnedPromptMessage(element: HTMLElement, message: AgentMessage): void {
  (element as HTMLElement & { __pinnedPromptMessage?: AgentMessage }).__pinnedPromptMessage =
    message;
}

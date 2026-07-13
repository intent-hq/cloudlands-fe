import { store as appStore } from "$store/renderer/store";
import {
  selectUiHighlightDurationMs,
  selectUiHighlightToken,
} from '$store/renderer/slices/ui-highlight/ui-highlight-selectors';
import { UI_HIGHLIGHT_DURATION_MS } from '$store/renderer/slices/ui-highlight/ui-highlight-slice';

export type HighlightTargetParams = {
  id?: string;
};

const HIGHLIGHT_CLASS = 'ui-highlight-pulse-ring';

function normalizeHighlightId(id: string | null | undefined): string {
  return (id ?? '').trim();
}

export function highlightTarget(node: HTMLElement, params: HighlightTargetParams = {}) {
  let highlightId = normalizeHighlightId(params.id ?? node.dataset.highlightId);
  let lastToken = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function clearPulse() {
    node.classList.remove(HIGHLIGHT_CLASS);
  }

  function applyPulse() {
    node.classList.remove(HIGHLIGHT_CLASS);
    void node.offsetWidth;
    node.classList.add(HIGHLIGHT_CLASS);

    if (timeout) clearTimeout(timeout);
    const durationMs = highlightId
      ? selectUiHighlightDurationMs.select(appStore.state, highlightId)
      : undefined;
    timeout = setTimeout(clearPulse, durationMs ?? UI_HIGHLIGHT_DURATION_MS);
  }

  function syncHighlight() {
    if (!highlightId) return;
    const token = selectUiHighlightToken.select(appStore.state, highlightId);
    if (token > 0 && token !== lastToken) {
      lastToken = token;
      applyPulse();
    }
  }

  // Use a Svelte effect to react to state changes
  // Since this is used in a Svelte action, we use a simple interval poll
  const interval = setInterval(syncHighlight, 100);
  syncHighlight();

  return {
    update(nextParams: HighlightTargetParams = {}) {
      const nextId = normalizeHighlightId(nextParams.id ?? node.dataset.highlightId);
      if (nextId === highlightId) return;
      highlightId = nextId;
      lastToken = 0;
      clearPulse();
      syncHighlight();
    },
    destroy() {
      clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      clearPulse();
    },
  };
}

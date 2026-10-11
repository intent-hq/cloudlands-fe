import { useCallback } from 'react';
import { store } from '@/store';
import {
  selectUiHighlightDurationMs,
  selectUiHighlightToken,
} from '@/store/ui-highlight/ui-highlight-selectors';
import { UI_HIGHLIGHT_DURATION_MS } from '../../../../../../src/store/renderer/slices/ui-highlight/ui-highlight-slice';
import './highlight-target.css';

export type HighlightTargetParams = { id?: string };

const HIGHLIGHT_CLASS = 'ui-highlight-pulse-ring';

export function highlightTarget(node: HTMLElement, params: HighlightTargetParams = {}) {
  let highlightId = (params.id ?? node.dataset.highlightId ?? '').trim();
  let lastToken = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function clearPulse() {
    node.classList.remove(HIGHLIGHT_CLASS);
  }

  function applyPulse(durationMs?: number) {
    clearPulse();
    void node.offsetWidth;
    node.classList.add(HIGHLIGHT_CLASS);
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(clearPulse, durationMs ?? UI_HIGHLIGHT_DURATION_MS);
  }

  function syncHighlight() {
    if (!highlightId) return;
    let state: typeof store.state;
    try {
      state = store.state;
    } catch {
      return;
    }
    const token = selectUiHighlightToken.select(state, highlightId);
    if (token > 0 && token !== lastToken) {
      lastToken = token;
      applyPulse(selectUiHighlightDurationMs.select(state, highlightId));
    }
  }

  const interval = setInterval(syncHighlight, 100);
  syncHighlight();

  return {
    update(nextParams: HighlightTargetParams = {}) {
      const nextId = (nextParams.id ?? node.dataset.highlightId ?? '').trim();
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

export function useHighlightTarget(id?: string) {
  return useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      return highlightTarget(node, { id }).destroy;
    },
    [id],
  );
}

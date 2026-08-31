import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QueuedMessageBottomGapHost from './QueuedMessageBottomGapHost.svelte';
import {
  CHAT_SCROLL_END_MARKER_CLASS,
  chatTranscriptBottomInsetClass,
} from '../chat-queue-edge-layout';

describe('queued-message outer bottom layout', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it('mounts no queue shell for an empty queue and keeps a zero-size scroll marker', () => {
    render(QueuedMessageBottomGapHost, { props: { queueCount: 0 } });

    expect(screen.queryByTestId('queued-message-utility-area')).toBeNull();
    expect(screen.queryByTestId('queued-messages-container')).toBeNull();
    expect(screen.getByTestId('chat-scroll-end-marker').className).toBe(
      CHAT_SCROLL_END_MARKER_CLASS,
    );
    // The layout-neutral bottom anchor coexists with the zero-size end
    // marker; its box/margin invariant is asserted in smartScroll.test.ts
    // and its real-browser behavior in bottom-anchoring.ct.spec.ts.
    expect(document.querySelector('[data-follow-bottom-anchor]')).not.toBeNull();
  });

  it('gives the queue zero outer inset without changing the normal empty-state inset', () => {
    expect(
      chatTranscriptBottomInsetClass({
        isChiefWorkspace: false,
        isCompactMode: false,
        showQueue: true,
      }),
    ).toBe('');
    expect(
      chatTranscriptBottomInsetClass({
        isChiefWorkspace: false,
        isCompactMode: false,
        showQueue: false,
      }),
    ).toBe('pb-6');
    expect(
      chatTranscriptBottomInsetClass({
        isChiefWorkspace: false,
        isCompactMode: true,
        showQueue: false,
      }),
    ).toBe('pb-3');
  });
});

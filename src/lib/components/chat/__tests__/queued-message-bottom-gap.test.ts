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
    // Layout-neutral anchor: 1px box (zero-sized boxes are rejected as
    // scroll-anchor candidates) cancelled by a -1px margin.
    const anchor = document.querySelector<HTMLElement>('[data-follow-bottom-anchor]');
    expect(anchor?.style.height).toBe('1px');
    expect(anchor?.style.marginTop).toBe('-1px');
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

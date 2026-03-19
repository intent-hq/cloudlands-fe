import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faRotateRight: { iconName: 'rotate-right' },
  faStop: { iconName: 'stop' },
  faInfoCircle: { iconName: 'info-circle' },
  faExclamationTriangle: { iconName: 'exclamation-triangle' },
}));

vi.mock('$lib/components/ui/button', async () => {
  const Button = (await import('../../ui/__tests__/mocks/button.svelte')).default;
  return { Button };
});

vi.mock('$lib/components/ui/indicators', async () => {
  const Spinner = (await import('./mocks/SlotOnly.svelte')).default;
  return { Spinner };
});

import StreamingStatus from '../StreamingStatus.svelte';

describe.skip('StreamingStatus', () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('shows a slow-response message when stalled after prior tool-call activity', () => {
    const now = Date.now();

    render(StreamingStatus, {
      props: {
        isProcessing: true,
        startTime: now - 120_000,
        lastChunkTime: now - 95_000,
        streamingContentLength: 0,
        isStalled: true,
      },
    });

    expect(screen.getByText('Agent is taking longer than usual to respond.')).toBeTruthy();
    expect(
      screen.queryByText('No response received. Check your network connection or try again.'),
    ).toBeNull();
  });

  it('shows the no-response warning only when nothing has been received yet', () => {
    const now = Date.now();

    render(StreamingStatus, {
      props: {
        isProcessing: true,
        startTime: now - 120_000,
        streamingContentLength: 0,
        isStalled: true,
      },
    });

    expect(
      screen.getByText('No response received. Check your network connection or try again.'),
    ).toBeTruthy();
  });
});

/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ConversationTurnGap from '../ConversationTurnGap.svelte';

afterEach(cleanup);

describe('ConversationTurnGap', () => {
  it('exposes 8px operational, 0px tool, and normal editorial turn seams', async () => {
    const { container, rerender } = render(ConversationTurnGap, {
      props: {
        currentIsEventNotification: false,
        currentHasAssistantMessages: true,
        nextIsEventNotification: false,
        compactOperationalSeam: true,
        zeroToolSeam: false,
      },
    });
    const gap = container.firstElementChild!;
    expect(gap.className).toContain('h-2');
    expect(gap.getAttribute('data-operational-seam')).toBe('true');
    expect(gap.getAttribute('aria-hidden')).toBe('true');

    await rerender({
      currentIsEventNotification: false,
      currentHasAssistantMessages: true,
      nextIsEventNotification: false,
      compactOperationalSeam: true,
      zeroToolSeam: true,
    });
    expect(gap.className).toContain('h-0');
    expect(gap.getAttribute('data-tool-seam')).toBe('true');

    await rerender({
      currentIsEventNotification: false,
      currentHasAssistantMessages: true,
      nextIsEventNotification: true,
      compactOperationalSeam: false,
      zeroToolSeam: false,
    });
    expect(gap.className).toContain('h-0');

    await rerender({
      currentIsEventNotification: false,
      currentHasAssistantMessages: true,
      nextIsEventNotification: false,
      nextHasUserMessage: true,
      compactOperationalSeam: false,
      zeroToolSeam: false,
    });
    expect(gap.className).toContain('h-10');

    await rerender({
      currentIsEventNotification: true,
      currentHasAssistantMessages: false,
      nextIsEventNotification: false,
      nextHasUserMessage: false,
      compactOperationalSeam: false,
      zeroToolSeam: false,
    });
    expect(gap.className).toContain('h-8');

    await rerender({
      currentIsEventNotification: false,
      currentHasAssistantMessages: true,
      nextIsEventNotification: false,
      nextHasUserMessage: false,
      compactOperationalSeam: false,
      zeroToolSeam: false,
    });
    expect(gap.className).toContain('h-8');
    expect(gap.hasAttribute('data-operational-seam')).toBe(false);
    expect(gap.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders a compact batched-delivery seam that wins over the user-message gap', async () => {
    const { container, rerender } = render(ConversationTurnGap, {
      props: {
        currentIsEventNotification: false,
        currentHasAssistantMessages: false,
        nextIsEventNotification: false,
        nextHasUserMessage: true,
        batchedDeliverySeam: true,
      },
    });
    const gap = container.firstElementChild!;
    expect(gap.className).toContain('h-2');
    expect(gap.getAttribute('data-batched-seam')).toBe('true');
    expect(gap.getAttribute('aria-hidden')).toBe('true');

    // Same seam without the batch flag renders the default h-10 user gap.
    await rerender({
      currentIsEventNotification: false,
      currentHasAssistantMessages: false,
      nextIsEventNotification: false,
      nextHasUserMessage: true,
      batchedDeliverySeam: false,
    });
    expect(gap.className).toContain('h-10');
    expect(gap.hasAttribute('data-batched-seam')).toBe(false);
  });

  it('applies the batched seam to wake-card boundaries on both sides', async () => {
    // Batch member followed by a wake card in the same batch.
    const { container, rerender } = render(ConversationTurnGap, {
      props: {
        currentIsEventNotification: false,
        currentHasAssistantMessages: false,
        nextIsEventNotification: true,
        batchedDeliverySeam: true,
      },
    });
    const gap = container.firstElementChild!;
    expect(gap.className).toContain('h-2');
    expect(gap.getAttribute('data-batched-seam')).toBe('true');
    expect(gap.hasAttribute('data-gap-before-wake')).toBe(false);

    // Wake card followed by a plain user message in the same batch.
    await rerender({
      currentIsEventNotification: true,
      currentHasAssistantMessages: false,
      nextIsEventNotification: false,
      nextHasUserMessage: true,
      batchedDeliverySeam: true,
    });
    expect(gap.className).toContain('h-2');
    expect(gap.getAttribute('data-batched-seam')).toBe('true');
  });
});

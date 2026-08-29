/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatImageBlock from '../ChatImageBlock.svelte';

afterEach(cleanup);

// 1x1 transparent PNG
const pngData =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('ChatImageBlock', () => {
  it('opens the lightbox when the thumbnail is clicked', async () => {
    render(ChatImageBlock, {
      props: { data: pngData, mimeType: 'image/png', alt: 'screenshot.png' },
    });

    const trigger = screen.getByRole('button', { name: /view screenshot\.png full size/i });
    expect(trigger.querySelector('img')?.src).toBe(`data:image/png;base64,${pngData}`);

    await fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /image preview/i })).toBeTruthy();
    });
  });

  it('requests hydration instead of opening the lightbox for a truncated thumbnail block', async () => {
    const onHydrate = vi.fn();
    render(ChatImageBlock, {
      props: {
        data: pngData,
        mimeType: 'image/png',
        alt: 'screenshot.png',
        dataTruncated: true,
        dataIsThumbnail: true,
        onHydrate,
      },
    });

    const trigger = screen.getByRole('button', { name: /load full-size screenshot\.png/i });
    await fireEvent.click(trigger);

    expect(onHydrate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a placeholder chip with on-demand fetch when a truncated block has no data', async () => {
    const onHydrate = vi.fn();
    render(ChatImageBlock, {
      props: {
        mimeType: 'image/png',
        alt: 'screenshot.png',
        dataTruncated: true,
        onHydrate,
      },
    });

    const placeholder = screen.getByTestId('chat-image-placeholder');
    await fireEvent.click(placeholder);

    expect(onHydrate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

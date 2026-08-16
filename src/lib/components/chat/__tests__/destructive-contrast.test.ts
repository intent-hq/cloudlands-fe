import '../../../../app.css';
import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import AttachmentPreview from '../AttachmentPreview.svelte';
import StreamingStatus from '../StreamingStatus.svelte';
import TurnFailureNotice from '../TurnFailureNotice.svelte';

// Mock IPC since these components don't need it
vi.mock('$shared/ipc/renderer', () => ({
  ipc: {
    on: vi.fn(),
    invoke: vi.fn(),
  },
}));

function contrastRatio(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const channels = value
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
    const linear = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Destructive foreground contrast', () => {
  test('AttachmentPreview uses destructive-foreground class', () => {
    const { container } = render(AttachmentPreview, {
      props: {
        attachmentId: 'test-id',
        fileName: 'test.txt',
        placementStatus: 'failed',
        chipVariant: true,
      },
    });

    const chip = container.querySelector('[data-placement-status="failed"]') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.className).toContain('text-destructive-foreground');
    expect(chip.className).not.toContain('text-destructive ');
  });

  test('StreamingStatus error title uses destructive-foreground class', () => {
    const { container } = render(StreamingStatus, {
      props: {
        error: 'Test error message',
        isStreaming: false,
      },
    });

    const errorTitle = container.querySelector('[data-testid="error-title"]') as HTMLElement;
    expect(errorTitle).toBeTruthy();
    expect(errorTitle.className).toContain('text-destructive-foreground');
    expect(errorTitle.className).not.toContain('text-destructive ');
  });

  test('TurnFailureNotice uses destructive-foreground class', () => {
    const { container } = render(TurnFailureNotice, {
      props: {
        reason: 'Test failure reason',
      },
    });

    const notice = container.querySelector('.turn-failure-notice') as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.className).toContain('text-destructive-foreground');
    expect(notice.className).not.toContain('text-destructive ');
  });
});

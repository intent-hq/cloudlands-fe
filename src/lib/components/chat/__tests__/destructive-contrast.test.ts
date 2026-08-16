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

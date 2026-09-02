import '../../../../app.css';
import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import AttachmentPreview from '../AttachmentPreview.svelte';
import StreamingStatus from '../StreamingStatus.svelte';
import TurnFailureNotice from '../TurnFailureNotice.svelte';

vi.mock('$shared/ipc/renderer', () => ({
  ipc: { on: vi.fn(), invoke: vi.fn() },
}));

describe('destructive state semantics', () => {
  test('marks a failed attachment with its placement state', () => {
    const { container } = render(AttachmentPreview, {
      props: {
        attachmentId: 'test-id',
        fileName: 'test.txt',
        placementStatus: 'failed',
        chipVariant: true,
      },
    });
    expect(container.querySelector('[data-placement-status="failed"]')).toBeTruthy();
  });

  test('shows a streaming error message', () => {
    const { getByText } = render(StreamingStatus, {
      props: { error: 'Test error message', isStreaming: false },
    });
    expect(getByText('Test error message')).toBeTruthy();
  });

  test('keeps turn failures exposed as alerts at 200% zoom', () => {
    const { container, getByRole } = render(TurnFailureNotice, {
      props: { reason: 'Test failure reason' },
    });
    container.style.zoom = '2';
    expect(getByRole('alert').textContent).toContain('Test failure reason');
  });
});

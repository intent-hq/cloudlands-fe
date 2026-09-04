import '../../../../app.css';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import AttachmentPreview from '../AttachmentPreview.svelte';
import StreamingStatus from '../StreamingStatus.svelte';
import TurnFailureNotice from '../TurnFailureNotice.svelte';

vi.mock('$shared/ipc/renderer', () => ({
  ipc: { on: vi.fn(), invoke: vi.fn() },
}));

type SemanticForeground = 'danger' | 'danger-background' | 'foreground';

let semanticColorStyles: HTMLStyleElement;

beforeEach(() => {
  semanticColorStyles = document.createElement('style');
  semanticColorStyles.textContent = `
    body, .text-foreground, .text-subtle, .text-muted-foreground { color: rgb(24, 24, 27); }
    .text-danger-background { color: rgb(254, 226, 226); }
    .text-danger { color: rgb(153, 27, 27); }
  `;
  document.head.append(semanticColorStyles);
});

afterEach(() => semanticColorStyles.remove());

function resolvedSemanticForeground(role: SemanticForeground): string {
  const probe = document.createElement('span');
  probe.className = `text-${role}`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function expectDangerForeground(element: HTMLElement): void {
  const color = getComputedStyle(element).color;
  const danger = resolvedSemanticForeground('danger');

  expect(color).toBe(danger);
  expect(color).not.toBe(resolvedSemanticForeground('foreground'));
  expect(color).not.toBe(resolvedSemanticForeground('danger-background'));
}

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
    const failedAttachment = container.querySelector<HTMLElement>(
      '[data-placement-status="failed"]',
    );
    expect(failedAttachment).toBeTruthy();
    expectDangerForeground(failedAttachment!);
  });

  test('shows a streaming error message', () => {
    const { getByTestId, getByText } = render(StreamingStatus, {
      props: { error: 'Test error message', isStreaming: false },
    });
    expect(getByText('Test error message')).toBeTruthy();
    expectDangerForeground(getByTestId('error-title'));
  });

  test('keeps turn failures exposed as alerts at 200% zoom', () => {
    const { container, getByRole } = render(TurnFailureNotice, {
      props: { reason: 'Test failure reason' },
    });
    container.style.zoom = '2';
    const alert = getByRole('alert');
    expect(alert.textContent).toContain('Test failure reason');
    expectDangerForeground(alert);
  });
});

import '../../../../app.css';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
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

  test('discloses raw diagnostics below the current failure heading', async () => {
    const { getByTestId, getByText, getByRole } = render(StreamingStatus, {
      props: { error: 'Test error message', isStreaming: false },
    });
    await fireEvent.click(getByRole('button', { name: 'Details', exact: true }));
    expect(getByText('Test error message')).toBeTruthy();
    expectDangerForeground(getByTestId('error-title'));
  });

  test('keeps historical failure details inspectable at 200% zoom', async () => {
    const { container, getByRole } = render(TurnFailureNotice, {
      props: { reason: 'Test failure reason' },
    });
    container.style.zoom = '2';
    await fireEvent.click(getByRole('button', { name: '1 recorded failure' }));
    expect(getByRole('region').textContent).toContain('Test failure reason');
  });
});

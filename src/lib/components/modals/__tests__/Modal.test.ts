/**
 * @vitest-environment jsdom
 *
 * Regression test for Bug 1: Modal aria-hidden="true" blocking interaction.
 *
 * The outer positioning div in Modal.svelte has aria-hidden="true" which
 * propagates to all descendants, causing the browser to block interaction
 * when a tiptap editor retains focus behind the modal.
 *
 * The inner div already has role="dialog", so the outer wrapper should NOT
 * have aria-hidden="true".
 *
 * This test should FAIL before the fix and PASS after.
 */
import {
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import Modal from '../Modal.svelte';
import { warmImport } from '../../../../test/warm-import';

// Mock the Portal component to render children inline (no DOM teleportation)
vi.mock('$lib/components/ui/Portal.svelte', async () => {
  const MockPortal = (await import('./mocks/MockPortal.svelte')).default;
  return { default: MockPortal };
});

// Mock svelte-fa to avoid icon import issues
vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

// Mock the Button component
vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const MockButton = (await import('../../terminal/__tests__/mocks/MockButton.svelte')).default;
  return { default: MockButton };
});

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('./mocks/MockPortal.svelte'));
warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../../terminal/__tests__/mocks/MockButton.svelte'));

describe('Modal - aria-hidden regression', () => {
  it('should NOT have aria-hidden="true" on the outer positioning wrapper div', async () => {
    // Render the Modal in "open" state
    const { container } = render(Modal, {
      props: {
        open: true,
        title: 'Test Modal',
      },
    });

    await tick();

    // Look for any element with aria-hidden="true" that also has role="presentation"
    // This is the outer positioning div (line 56-60 in Modal.svelte)
    const presentationDiv = container.querySelector('[role="presentation"]')
      ?? document.body.querySelector('[role="presentation"]');

    // Also search in the full document body since Portal may teleport content
    const allAriaHidden = document.querySelectorAll('[aria-hidden="true"]');
    const ariaHiddenWithPresentation = Array.from(allAriaHidden).filter(
      (el) => el.getAttribute('role') === 'presentation'
    );

    // The positioning wrapper with role="presentation" should NOT have aria-hidden="true"
    // Bug: currently it does have aria-hidden="true" which blocks interaction
    if (presentationDiv) {
      expect(presentationDiv.getAttribute('aria-hidden')).not.toBe('true');
    }

    // No element with both role="presentation" and aria-hidden="true" should exist
    expect(ariaHiddenWithPresentation.length).toBe(0);

    // Additionally, verify that no ancestor of role="dialog" has aria-hidden="true"
    const dialogEl = container.querySelector('[role="dialog"]')
      ?? document.body.querySelector('[role="dialog"]');

    if (dialogEl) {
      let parent = dialogEl.parentElement;
      while (parent) {
        expect(
          parent.getAttribute('aria-hidden'),
          `Parent element of dialog should not have aria-hidden="true": ${parent.outerHTML.substring(0, 100)}`
        ).not.toBe('true');
        parent = parent.parentElement;
      }
    }
  });
});


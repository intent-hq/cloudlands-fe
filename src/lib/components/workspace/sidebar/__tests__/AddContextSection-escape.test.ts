/**
 * AddContextSection.svelte Escape handling via the escape-layer stack.
 * Migrated from a manual `document` keydown listener; the layer is only
 * registered while the dropdown is expanded.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

// Stub the heavy integrations picker — the escape layer lives on the section.
vi.mock('$lib/components/workspace/initializer/IssueSuggestions.svelte', async () => ({
  default: (await import('../../initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/ui/Portal.svelte', async () => {
  const MockPortal = (await import('../../../modals/__tests__/mocks/MockPortal.svelte')).default;
  return { default: MockPortal };
});

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

import AddContextSection from '../AddContextSection.svelte';
import { warmImport } from '../../../../../test/warm-import';

async function expandDropdown() {
  const trigger = screen.getByText('Add context');
  await fireEvent.click(trigger);
  await waitFor(() => {
    expect(screen.getByText('Note')).toBeTruthy();
  });
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../../initializer/__tests__/mocks/MockComponent.svelte'));
warmImport(() => import('../../../modals/__tests__/mocks/MockPortal.svelte'));
warmImport(() => import('../../../ui/__tests__/mocks/Fa.svelte'));

describe('AddContextSection Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape collapses the expanded dropdown', async () => {
    render(AddContextSection, { props: {} });
    await expandDropdown();

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByText('Note')).toBeFalsy();
    });
  });

  it('Escape is not consumed while collapsed (no layer registered)', async () => {
    render(AddContextSection, { props: {} });
    expect(screen.queryByText('Note')).toBeFalsy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('creates a note directly from the compact trigger', async () => {
    const onAddNote = vi.fn();
    const onOpenBrowser = vi.fn();
    render(AddContextSection, { props: { compact: true, onAddNote, onOpenBrowser } });

    const trigger = screen.getByRole('button', { name: 'Add context' });
    expect(trigger.classList.contains('shadow-none')).toBe(true);
    expect(trigger.classList.contains('shadow-xs')).toBe(false);

    await fireEvent.click(trigger);

    expect(onAddNote).toHaveBeenCalledOnce();
    expect(onOpenBrowser).not.toHaveBeenCalled();
    expect(screen.queryByText('Note')).toBeFalsy();
    expect(screen.queryByText('Browser')).toBeFalsy();
  });
});

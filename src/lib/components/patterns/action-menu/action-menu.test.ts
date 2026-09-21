import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ActionMenuHarness from './ActionMenuHarness.svelte';
import { defineActions, resolveActions, splitActions } from './actions';

afterEach(cleanup);

const actions = defineActions([
  { id: 'first', label: 'First', shortcut: '⌘1' },
  { id: 'hidden', label: 'Hidden', when: false },
  { id: 'disabled', label: 'Disabled', disabledReason: 'Unavailable' },
  { id: 'last', label: 'Last' },
]);

describe('declarative action data', () => {
  it('filters conditional entries without adding behavior to the serialisable definitions', () => {
    expect(resolveActions(actions).map((action) => action.id)).toEqual([
      'first',
      'disabled',
      'last',
    ]);
    expect(JSON.parse(JSON.stringify(actions))).toEqual(actions);
  });

  it('splits resolved actions between the bar and overflow menu', () => {
    const split = splitActions(actions, 2);
    expect(split.visible.map((action) => action.id)).toEqual(['first', 'disabled']);
    expect(split.overflow.map((action) => action.id)).toEqual(['last']);
  });
});

describe('ActionMenu', () => {
  it('renders visible actions, disabled reasons, and shortcuts', async () => {
    render(ActionMenuHarness);
    await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

    expect(screen.queryByRole('menuitem', { name: 'Hidden' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Edit' }).querySelector('kbd')?.textContent).toBe(
      '⌘E',
    );
    const locked = screen.getByRole('menuitem', { name: 'Locked' });
    expect(locked.getAttribute('aria-disabled')).toBe('true');

    const tooltipTrigger = locked.closest<HTMLElement>('[data-tooltip-trigger]') ?? locked;
    await fireEvent.pointerMove(tooltipTrigger, { pointerType: 'mouse' });
    expect(
      await screen.findByRole('tooltip', { name: 'Requires access', hidden: true }),
    ).toBeTruthy();
  });

  it('opens at a supplied context-menu position and dispatches by id', async () => {
    render(ActionMenuHarness, { props: { context: true } });
    const menu = await screen.findByRole('menu', { name: 'Document actions' });
    expect(menu).toBeTruthy();
    const anchor = screen.getByRole('button', { name: 'Document actions' });
    expect(anchor.getAttribute('style')).toContain('left: 24px');
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(screen.getByTestId('selected').textContent).toBe('edit');
  });
});

describe('ActionBar', () => {
  it('keeps the configured leading actions inline and sends the remainder to overflow', async () => {
    render(ActionMenuHarness, { props: { bar: true } });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy());
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByTestId('selected').textContent).toBe('delete');
  });

  it.each([1, 2])(
    'keeps submenu child commands reachable with visibleCount=%i',
    async (visibleCount) => {
      render(ActionMenuHarness, { props: { bar: true, visibleCount } });
      expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();

      await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      const exportAction = await screen.findByRole('menuitem', { name: 'Export' });
      exportAction.focus();
      await fireEvent.keyDown(exportAction, { key: 'ArrowRight' });
      await fireEvent.click(await screen.findByRole('menuitem', { name: 'Export as PDF' }));

      expect(screen.getByTestId('selected').textContent).toBe('export-pdf');
    },
  );
});

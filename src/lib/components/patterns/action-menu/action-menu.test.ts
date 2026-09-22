import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SemanticMenuHarness from './SemanticMenuHarness.svelte';
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

  it('removes empty sections and submenus after recursive visibility filtering', () => {
    const resolved = resolveActions(
      defineActions([
        { id: 'empty', label: 'Empty', kind: 'section', children: [] },
        {
          id: 'submenu',
          label: 'Submenu',
          kind: 'submenu',
          children: [{ id: 'hidden-child', label: 'Hidden child', kind: 'action', when: false }],
        },
        { id: 'retained', label: 'Retained', kind: 'action' },
      ]),
    );
    expect(resolved.map((action) => action.id)).toEqual(['retained']);
  });

  it('rejects ambiguous identities and duplicate command targets within one scope', () => {
    expect(() =>
      resolveActions([
        { id: 'a', label: 'A' },
        { id: 'a', label: 'B' },
      ]),
    ).toThrow(/Duplicate menu action id/);
    expect(() =>
      resolveActions([
        { id: 'a', label: 'A', commandId: 'save' },
        { id: 'b', label: 'B', commandId: 'save' },
      ]),
    ).toThrow(/Duplicate menu command target/);
    expect(
      resolveActions([
        { id: 'a', label: 'A' },
        { id: 'a', label: 'Hidden', when: false },
      ]),
    ).toHaveLength(1);
  });
});

describe('ActionMenu', () => {
  it('keeps metadata non-actionable when the same model is used by an action bar', async () => {
    render(ActionMenuHarness, { props: { bar: true, metadata: true, visibleCount: 10 } });
    expect(screen.queryByRole('button', { name: 'Document metadata' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Document metadata' })).toBeNull();
    await fireEvent.click(screen.getByText('Document metadata'));
    expect(screen.getByTestId('selected').textContent).toBe('none');
  });

  it('renders visible actions, disabled reasons, and shortcuts', async () => {
    render(ActionMenuHarness);
    await fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

    expect(screen.queryByRole('menuitem', { name: 'Hidden' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Edit' }).querySelector('kbd')?.textContent).toBe(
      '⌘E',
    );
    const locked = screen.getByRole('menuitem', { name: 'Locked' });
    expect(locked.getAttribute('aria-disabled')).toBe('true');

    expect(document.getElementById(locked.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Requires access',
    );
    await fireEvent.click(locked);
    expect(screen.getByTestId('selected').textContent).toBe('none');
  });

  it('opens at a supplied context-menu position and dispatches by id', async () => {
    render(ActionMenuHarness, { props: { context: true } });
    const menu = await screen.findByRole('menu', { name: 'Document actions' });
    expect(menu).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Document actions' })).toBeNull();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(screen.getByTestId('selected').textContent).toBe('edit');
  });

  it('dispatches checkbox and radio choices with semantic state and keeps the menu open', async () => {
    render(SemanticMenuHarness);
    await fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    const checked = screen.getByRole('menuitemcheckbox', { name: 'Show details' });
    expect(checked.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(checked);
    expect(checked.getAttribute('aria-checked')).toBe('true');
    const compact = screen.getByRole('menuitemradio', { name: 'Compact' });
    await fireEvent.click(compact);
    expect(compact.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByRole('menuitemradio', { name: 'Comfortable' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByTestId('choices').textContent).toBe('details,compact');
    expect(screen.getByRole('menu')).toBeTruthy();
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

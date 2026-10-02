import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarMenuHarness from './SidebarMenuHarness.svelte';
import SidebarContextMenu from './SidebarContextMenu.svelte';
import { findSidebarItem, toSidebarActions } from './actions';
import type { SidebarMenuEntry } from '$lib/components/ui/sidebar-context-menu/types';

afterEach(cleanup);

it('opens with its default accessible label and dispatches the selected command', async () => {
  const onClick = vi.fn();
  render(SidebarContextMenu, {
    props: { x: 10, y: 10, items: [{ id: 'open', label: 'Open agent', onClick }] },
  });
  const command = await screen.findByRole('menuitem', { name: 'Open agent' });
  expect(screen.getByRole('menu').getAttribute('aria-label')).toBeTruthy();
  await fireEvent.click(command);
  expect(onClick).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

it('keeps metadata labels out of command roles, navigation and dispatch', async () => {
  const onClick = vi.fn();
  const items: SidebarMenuEntry[] = [
    { type: 'label', label: 'Specialist metadata' },
    { id: 'open', label: 'Open agent', onClick },
  ];
  const actions = toSidebarActions(items);
  expect(findSidebarItem(items, actions[0].id)).toBeUndefined();
  render(SidebarContextMenu, { props: { x: 10, y: 10, items, ariaLabel: 'Agent actions' } });
  const command = await screen.findByRole('menuitem', { name: 'Open agent' });
  expect(screen.getAllByRole('menuitem')).toEqual([command]);
  await fireEvent.click(screen.getByText('Specialist metadata'));
  expect(onClick).not.toHaveBeenCalled();
  expect(screen.getByRole('menu')).toBeTruthy();
  command.focus();
  await fireEvent.keyDown(command, { key: 'Home' });
  expect(document.activeElement).toBe(command);
  await fireEvent.click(command);
  expect(onClick).toHaveBeenCalledOnce();
});

it('groups root exclusive choices without converting the clear command', () => {
  const actions = toSidebarActions(
    [
      { id: 'first', label: 'First', checked: true, onClick() {} },
      { id: 'second', label: 'Second', checked: false, onClick() {} },
      { type: 'separator' },
      { id: 'clear', label: 'Clear', onClick() {} },
    ],
    'single',
    'Slot',
  );
  expect(actions.map((action) => action.kind)).toEqual(['radio-group', 'action']);
  expect(actions[0]).toMatchObject({
    value: 'first',
    children: [
      { kind: 'radio', id: 'first' },
      { kind: 'radio', id: 'second' },
    ],
  });
});

describe('context focus ownership', () => {
  const sources: HTMLElement[] = [];
  afterEach(() => sources.splice(0).forEach((source) => source.remove()));
  function source() {
    const button = document.createElement('button');
    document.body.append(button);
    sources.push(button);
    return button;
  }

  it('returns focus to the latest source when an unkeyed menu is retargeted', async () => {
    const first = source();
    const second = source();
    const props = {
      x: 10,
      y: 10,
      ariaLabel: 'Actions',
      returnFocus: first,
      items: [{ id: 'run', label: 'Run', onClick() {} }],
    };
    const { rerender } = render(SidebarContextMenu, { props });
    await screen.findByRole('menu');
    await rerender({ ...props, x: 30, y: 30, returnFocus: second });
    await fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Run' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(second));
  });

  it('does not restore focus to a source removed by the command', async () => {
    const button = source();
    const nearest = source();
    render(SidebarContextMenu, {
      props: {
        x: 10,
        y: 10,
        ariaLabel: 'Actions',
        returnFocus: button,
        items: [{ id: 'remove', label: 'Remove source', onClick: () => button.remove() }],
      },
    });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove source' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(nearest));
  });

  it('does not steal focus from a destination opened by the command', async () => {
    const button = source();
    const destination = source();
    render(SidebarContextMenu, {
      props: {
        x: 10,
        y: 10,
        ariaLabel: 'Actions',
        returnFocus: button,
        items: [{ id: 'dialog', label: 'Open dialog', onClick: () => destination.focus() }],
      },
    });
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Open dialog' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(destination));
  });
});

describe.each(['overflow', 'context', 'keyboard'] as const)('%s menu parity', (via) => {
  async function open() {
    render(SidebarMenuHarness);
    const source = screen.getByRole('button', {
      name: via === 'overflow' ? 'Workspace actions' : 'Workspace',
      exact: true,
    });
    source.focus();
    if (via === 'overflow') await fireEvent.click(source);
    else if (via === 'context') await fireEvent.contextMenu(source, { clientX: 24, clientY: 32 });
    else await fireEvent.keyDown(source, { key: 'F10', shiftKey: true });
    await screen.findByRole('menu', { name: 'Workspace actions' });
    return source;
  }

  it('preserves order, availability and command callbacks without empty separators', async () => {
    await open();
    expect(
      screen.getAllByRole('menuitem').map((item) => item.getAttribute('data-action-id')),
    ).toEqual(['rename', 'locked', 'choices', 'more', 'delete']);
    expect(document.querySelectorAll('[data-slot="menu-separator"]')).toHaveLength(2);
    const locked = screen.getByRole('menuitem', { name: 'Locked' });
    expect(document.getElementById(locked.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Requires access',
    );
    await fireEvent.click(locked);
    expect(screen.getByTestId('selection').textContent).toBe('none');
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(screen.getByTestId('selection').textContent).toBe('rename');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('keeps toggle and exclusive choices open with correct checked state', async () => {
    await open();
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Show details' });
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('checked').textContent).toBe('true');
    const choices = screen.getByRole('menuitem', { name: 'Assign slot' });
    choices.focus();
    await fireEvent.keyDown(choices, { key: 'ArrowRight' });
    const second = await screen.findByRole('menuitemradio', { name: 'Second slot' });
    await fireEvent.click(second);
    expect(screen.getByTestId('choice').textContent).toBe('second');
    expect(second.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByRole('menuitemradio', { name: 'First slot' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getAllByRole('menu')).toHaveLength(2);
  });

  it('closes the innermost submenu first and returns focus to the source', async () => {
    const source = await open();
    const more = screen.getByRole('menuitem', { name: 'More' });
    more.focus();
    await fireEvent.keyDown(more, { key: 'ArrowRight' });
    const child = await screen.findByRole('menuitem', { name: 'Export' });
    await fireEvent.keyDown(child, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Export' })).toBeNull());
    expect(document.activeElement).toBe(more);
    await fireEvent.keyDown(more, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(source));
  });
});

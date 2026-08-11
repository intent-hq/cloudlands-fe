import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import MenuTestHarness from './MenuTestHarness.svelte';
import LegacyMenuHarness from './LegacyMenuHarness.svelte';
import { menuMetadata, menuSemantics } from './menu.meta';

afterEach(cleanup);

async function openMenu() {
  const trigger = screen.getByRole('button', { name: 'Actions' });
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await screen.findByRole('menu');
  return trigger;
}

describe('Menu keyboard and focus behavior', () => {
  it('supports arrows, Home, End, and typeahead while skipping disabled items', async () => {
    render(MenuTestHarness);
    await openMenu();
    const apple = screen.getByRole('menuitem', { name: 'Apple' });
    const banana = screen.getByRole('menuitem', { name: 'Banana' });
    const cherry = screen.getByRole('menuitem', { name: 'Cherry' });
    const more = screen.getByRole('menuitem', { name: 'More' });
    await waitFor(() => expect(document.activeElement).toBe(apple));
    await fireEvent.keyDown(apple, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(banana);
    await fireEvent.keyDown(banana, { key: 'End' });
    expect(document.activeElement).toBe(more);
    await fireEvent.keyDown(more, { key: 'Home' });
    expect(document.activeElement).toBe(apple);
    await fireEvent.keyDown(apple, { key: 'c' });
    await waitFor(() => expect(document.activeElement).toBe(cherry));
  });

  it('dismisses with Escape and restores focus to the trigger', async () => {
    render(MenuTestHarness);
    const trigger = await openMenu();
    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('dismisses on an outside pointer interaction and restores focus', async () => {
    render(MenuTestHarness);
    const trigger = await openMenu();
    await fireEvent.pointerDown(document.body, { pointerType: 'mouse' });
    await fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('opens a submenu with ArrowRight and returns with ArrowLeft', async () => {
    render(MenuTestHarness);
    await openMenu();
    const more = screen.getByRole('menuitem', { name: 'More' });
    more.focus();
    await fireEvent.keyDown(more, { key: 'ArrowRight' });
    const archive = await screen.findByRole('menuitem', { name: 'Archive' });
    await waitFor(() => expect(document.activeElement).toBe(archive));
    await fireEvent.keyDown(archive, { key: 'ArrowLeft' });
    await waitFor(() => expect(document.activeElement).toBe(more));
  });
});

describe('Menu command state behavior', () => {
  it('prevents disabled selection and exposes disabled semantics', async () => {
    render(MenuTestHarness);
    await openMenu();
    const disabled = screen.getByRole('menuitem', { name: 'Disabled action' });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(disabled);
    expect(screen.getByTestId('selected').textContent).toBe('none');
  });

  it('updates checkbox and radio command state without closing', async () => {
    render(MenuTestHarness);
    await openMenu();
    const checkbox = screen.getByRole('menuitemcheckbox', { name: 'Show panel' });
    await fireEvent.click(checkbox);
    expect(checkbox.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('checked').textContent).toBe('true');
    const compact = screen.getByRole('menuitemradio', { name: 'Compact' });
    await fireEvent.click(compact);
    expect(compact.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('density').textContent).toBe('compact');
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('runs a destructive command with semantic styling and closes normally', async () => {
    render(MenuTestHarness);
    await openMenu();
    const item = screen.getByRole('menuitem', { name: 'Delete item' });
    expect(item.className).toContain('data-[destructive]:text-destructive');
    await fireEvent.click(item);
    expect(screen.getByTestId('selected').textContent).toBe('delete');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('Menu metadata and compatibility', () => {
  it('classifies Menu as commands rather than value selection', () => {
    expect(menuMetadata.category).toBe('primitive');
    expect(menuMetadata.owner).toBe('007-B5');
    expect(menuSemantics.interaction).toBe('command');
    expect(menuSemantics.selectionReplacement).toBe('$lib/components/ui/select');
    expect(menuMetadata.callers).toHaveLength(15);
    expect(menuMetadata.callers).toContain('src/lib/components/chat/RegularAgentWelcome.svelte');
  });

  async function verifyLegacyTrigger(stopPropagation: boolean) {
    render(LegacyMenuHarness, { props: { stopPropagation } });
    const trigger = screen.getByRole('button', { name: 'Legacy actions closed' });
    trigger.focus();
    await fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByTestId('legacy-open').textContent).toBe('true'));
    expect(screen.getByRole('button', { name: 'Legacy actions open' })).toBe(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Legacy command' })).toBeTruthy();
    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('legacy-open').textContent).toBe('false'));
    expect(screen.getByRole('button', { name: 'Legacy actions closed' })).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
  }

  it('preserves normal legacy trigger state and focus restoration', async () => {
    await verifyLegacyTrigger(false);
  });

  it('preserves stopped-propagation trigger state and focus restoration', async () => {
    await verifyLegacyTrigger(true);
  });

  it('uses compact editorial rows, semantic selected states, and a contained overlay surface', async () => {
    render(MenuTestHarness);
    await openMenu();
    const menu = screen.getByRole('menu');
    const apple = screen.getByRole('menuitem', { name: 'Apple' });
    const checkbox = screen.getByRole('menuitemcheckbox', { name: 'Show panel' });
    expect(menu.className).toContain('bg-popover');
    expect(menu.className).toContain('border-border');
    expect(menu.className).toContain('overflow-y-auto');
    expect(menu.className).toContain('rounded-md');
    expect(menu.className).toContain('shadow-(--elevation-overlay)');
    expect(apple.className).toContain('min-h-7');
    expect(apple.className).toContain('rounded-md');
    expect(apple.className).toContain('type-body');
    expect(checkbox.className).toContain('data-[state=checked]:bg-accent/60');
    expect(menu.className).not.toMatch(/bg-(?:white|black|gray|slate|zinc|neutral)-?/);
  });
});

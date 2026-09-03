import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import MenuTestHarness from './MenuTestHarness.svelte';
import LegacyMenuHarness from './LegacyMenuHarness.svelte';
import DropdownMenu from '../dropdown-menu.svelte';
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

  it('runs a destructive command with neutral menu styling and closes normally', async () => {
    render(MenuTestHarness);
    await openMenu();
    const item = screen.getByRole('menuitem', { name: 'Delete item' });
    expect(item.hasAttribute('data-destructive')).toBe(true);
    expect(item.className).toContain('data-[destructive]:text-foreground');
    expect(item.className).not.toContain('data-[destructive]:text-destructive');
    await fireEvent.click(item);
    expect(screen.getByTestId('selected').textContent).toBe('delete');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('renders the conventional command row with a leading icon and trailing shortcut', async () => {
    render(MenuTestHarness);
    await openMenu();
    const command = screen.getByRole('menuitem', { name: 'Attach files' });
    expect(command.getAttribute('data-slot')).toBe('menu-command-item');
    expect(command.querySelector('svg')).toBeTruthy();
    expect(command.querySelector('kbd')?.textContent).toBe('⇧⌘A');
  });
});

describe('Menu stacked content', () => {
  it('renders config-driven sections, shortcuts, and disabled commands', async () => {
    render(MenuTestHarness, { props: { stacked: true } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open stacked menu' }));

    expect(screen.getByRole('group', { name: 'My Account' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Team' })).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: 'Profile' }).querySelector('kbd')?.textContent,
    ).toBe('⇧⌘P');
    expect(screen.getByRole('menuitem', { name: 'Billing' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(document.querySelectorAll('[data-slot="menu-separator"]')).toHaveLength(1);
  });

  it('opens and selects a config-driven submenu', async () => {
    render(MenuTestHarness, { props: { stacked: true } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open stacked menu' }));
    const invite = screen.getByRole('menuitem', { name: 'Invite users' });
    await fireEvent.keyDown(invite, { key: 'ArrowRight' });
    const email = await screen.findByRole('menuitem', { name: 'Email' });
    expect(email.querySelector('svg')).toBeTruthy();
    await fireEvent.click(email);
    expect(screen.getByTestId('selected').textContent).toBe('email');
  });
});

describe('Menu metadata and compatibility', () => {
  it('classifies Menu as commands rather than value selection', () => {
    expect(menuMetadata.category).toBe('primitive');
    expect(menuMetadata.owner).toBe('007-B5');
    expect(menuSemantics.interaction).toBe('command');
    expect(menuSemantics.selectionReplacement).toBe('$lib/components/ui/select');
    expect(menuMetadata.callers).toHaveLength(21);
    expect(menuMetadata.callers).toContain('src/features/hud/components/HudHeaderFilters.svelte');
    expect(menuMetadata.callers).toContain(
      'src/lib/components/layout/sidebar-nav/SidebarPanel.svelte',
    );
    expect(menuMetadata.callers).toContain('src/lib/components/chat/input/SimpleRichInput.svelte');
  });

  async function verifyLegacyTrigger(stopPropagation: boolean) {
    render(LegacyMenuHarness, { props: { stopPropagation } });
    const trigger = screen.getByRole('button', { name: 'Legacy actions closed' });
    expect(trigger.getAttribute('data-slot')).toBe('menu-trigger');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.focus();
    await fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByTestId('legacy-open').textContent).toBe('true'));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Legacy actions open' })).toBe(trigger);
    const command = await screen.findByRole('menuitem', { name: 'Legacy command' });
    expect(document.body.contains(command)).toBe(true);
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

  it('syncs the shared open state after Escape, reopen, and outside pointer dismissal', async () => {
    render(LegacyMenuHarness);
    const trigger = screen.getByRole('button', { name: 'Legacy actions closed' });

    await fireEvent.click(trigger);
    await fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('legacy-open').textContent).toBe('false'));

    await fireEvent.click(trigger);
    await screen.findByRole('menu');
    await fireEvent.pointerDown(document.body, {
      button: 0,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });

    await waitFor(() => expect(screen.getByTestId('legacy-open').textContent).toBe('false'));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it.each(['Enter', ' '])(
    'opens the legacy trigger with %s and updates ARIA state',
    async (key) => {
      render(LegacyMenuHarness);
      const trigger = screen.getByRole('button', { name: 'Legacy actions closed' });
      trigger.focus();
      await fireEvent.keyDown(trigger, { key });
      await screen.findByRole('menu');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    },
  );

  it('closes the previous menu when another shared trigger opens', async () => {
    render(LegacyMenuHarness, { props: { label: 'First actions' } });
    render(LegacyMenuHarness, { props: { label: 'Second actions' } });
    const first = screen.getByRole('button', { name: 'First actions closed' });
    const second = screen.getByRole('button', { name: 'Second actions closed' });

    await fireEvent.click(first);
    await screen.findByRole('button', { name: 'First actions open' });
    await fireEvent.keyDown(second, { key: 'Enter' });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'First actions open' })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Second actions open' })).toBe(second);
    expect(screen.getAllByRole('menu')).toHaveLength(1);
  });

  it('runs a legacy action once and closes the menu', async () => {
    render(LegacyMenuHarness);
    await fireEvent.click(screen.getByRole('button', { name: 'Legacy actions closed' }));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Legacy command' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByTestId('legacy-action-count').textContent).toBe('1');
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

  it('bounds content height by the viewport-derived bits-ui var when no maxHeight override is provided', async () => {
    render(MenuTestHarness);
    await openMenu();
    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('style')).toMatch(
      /max-height: var\(--bits-dropdown-menu-content-available-height, ?calc\(100dvh - 1rem\)\)/,
    );
    expect(menu.getAttribute('style')).not.toContain('24rem');
  });

  it('keeps the viewport-bounded default through the DropdownMenu wrapper when contentMaxHeight is not passed', async () => {
    render(DropdownMenu, { props: { open: true } });
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    const menu = screen.getByRole('menu');
    expect(menu.getAttribute('style')).toMatch(
      /max-height: var\(--bits-dropdown-menu-content-available-height, ?calc\(100dvh - 1rem\)\)/,
    );
    expect(menu.getAttribute('style')).not.toContain('24rem');
  });

  it('bounds submenu content height by the menu-prefixed bits-ui var', async () => {
    // SubContent uses --bits-menu-content-available-height (the shared 'menu'
    // prefix), not the 'dropdown-menu' prefix the root content uses.
    render(MenuTestHarness);
    await openMenu();
    const more = screen.getByRole('menuitem', { name: 'More' });
    more.focus();
    await fireEvent.keyDown(more, { key: 'ArrowRight' });
    await screen.findByRole('menuitem', { name: 'Archive' });
    const subContent = document.querySelector('[data-slot="menu-sub-content"]');
    expect(subContent).toBeTruthy();
    expect(subContent?.getAttribute('style')).toMatch(
      /max-height: var\(--bits-menu-content-available-height, ?calc\(100dvh - 1rem\)\)/,
    );
  });
});

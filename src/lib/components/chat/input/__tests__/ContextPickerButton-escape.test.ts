/**
 * ContextPickerButton.svelte Escape handling via the escape-layer stack.
 * Migrated from a <svelte:window onkeydown>; Escape must still dismiss
 * the open popover.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: {} });
});

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));

vi.mock('$lib/services/mentions', () => ({
  getMentionSystem: () => ({ search: searchMock }),
}));

import ContextPickerButton from '../ContextPickerButton.svelte';

describe('ContextPickerButton Escape handling (escape-layer stack)', () => {
  beforeEach(() => {
    searchMock.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('Escape dismisses the open popover', async () => {
    render(ContextPickerButton, { props: { panels: [] } });

    const trigger = screen.getByRole('button', { name: 'Add Context' });
    await fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /select context panels/i })).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /select context panels/i })).toBeFalsy();
    });
  });

  it('Escape is not consumed while the popover is closed (no layer registered)', async () => {
    render(ContextPickerButton, { props: { panels: [] } });
    expect(screen.queryByRole('dialog', { name: /select context panels/i })).toBeFalsy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('can open against an external menu anchor', async () => {
    const view = render(ContextPickerButton, { props: { panels: [] } });
    const anchor = document.createElement('button');
    anchor.getBoundingClientRect = () =>
      ({ left: 42, top: 100, bottom: 120, right: 62, width: 20, height: 20 }) as DOMRect;
    document.body.append(anchor);

    await view.component.open(anchor);

    const dialog = await screen.findByRole('dialog', { name: /select context panels/i });
    expect(dialog.getAttribute('style')).toContain('left: 42px');
    expect(dialog.getAttribute('style')).toContain('top: 124px');
    anchor.remove();
  });

  it('stops loading when a newer query supersedes a search that never settles', async () => {
    vi.useFakeTimers();
    searchMock.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce([]);
    render(ContextPickerButton, {
      props: { panels: [], workspace: { id: 'workspace-1' } as any },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Add Context' }));
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'a' } });
    await vi.advanceTimersByTimeAsync(250);
    expect(searchMock).toHaveBeenCalledWith('a', { workspaceId: 'workspace-1' });
    expect(document.querySelector('.animate-spin')).toBeTruthy();

    await fireEvent.input(input, { target: { value: 'ab' } });
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(document.querySelector('.animate-spin')).toBeNull());
    expect(searchMock).toHaveBeenLastCalledWith('ab', { workspaceId: 'workspace-1' });
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });

  it('renders panel and selection choices with textless Toggles and preserves controlled state', async () => {
    const onToggle = vi.fn();
    const onToggleSelection = vi.fn();
    const panels = [
      {
        id: 'file-1',
        panelId: 'panel-1',
        tabId: 'tab-1',
        type: 'file' as const,
        label: 'README.md',
        checked: false,
      },
    ];
    const selections = [
      {
        id: 'selection-1',
        panelId: 'panel-1',
        tabId: 'tab-1',
        sourceType: 'file' as const,
        sourceLabel: 'README.md',
        text: 'Selected context',
        checked: true,
        timestamp: 1,
      },
    ];
    const view = render(ContextPickerButton, {
      props: { panels, selections, onToggle, onToggleSelection },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Add Context' }));
    const panelToggle = screen.getByRole('button', { name: 'README.md', pressed: false });
    const selectionToggle = screen.getByRole('button', { name: 'Selected context', pressed: true });
    expect(panelToggle.textContent?.trim()).toBe('');
    expect(selectionToggle.textContent?.trim()).toBe('');
    expect(panelToggle.getAttribute('aria-pressed')).toBe('false');
    expect(selectionToggle.getAttribute('aria-pressed')).toBe('true');

    await fireEvent.click(panelToggle);
    expect(onToggle).toHaveBeenCalledWith('file-1');

    await view.rerender({
      panels: [{ ...panels[0], checked: true }],
      selections,
      onToggle,
      onToggleSelection,
    });
    expect(
      screen.getByRole('button', { name: 'README.md', pressed: true }).getAttribute('aria-pressed'),
    ).toBe('true');

    await fireEvent.click(selectionToggle);
    expect(onToggleSelection).toHaveBeenCalledWith('selection-1');
  });
});

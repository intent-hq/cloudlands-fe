/**
 * ContextPickerButton.svelte Escape handling via the escape-layer stack,
 * plus open/close behavior when items are picked.
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

  it('renders its picker body inside an owning submenu and keeps it open when toggling a panel', async () => {
    const onToggle = vi.fn();
    const onPick = vi.fn();
    render(ContextPickerButton, {
      props: {
        panels: [
          {
            id: 'note-1',
            panelId: 'panel-1',
            tabId: 'tab-1',
            type: 'note',
            label: 'Project notes',
            checked: false,
          },
        ],
        renderTrigger: false,
        embedded: true,
        onToggle,
        onPick,
      },
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-context-picker-body][data-embedded]')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Project notes/i }));
    expect(onToggle).toHaveBeenCalledWith('note-1');
    expect(onPick).not.toHaveBeenCalled();
    expect(document.querySelector('[data-context-picker-body][data-embedded]')).toBeTruthy();
  });

  it('keeps the standalone popover open when toggling a panel', async () => {
    const onToggle = vi.fn();
    const onPick = vi.fn();
    render(ContextPickerButton, {
      props: {
        panels: [
          {
            id: 'note-1',
            panelId: 'panel-1',
            tabId: 'tab-1',
            type: 'note',
            label: 'Project notes',
            checked: false,
          },
        ],
        onToggle,
        onPick,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Add Context' }));
    await screen.findByRole('dialog', { name: /select context panels/i });

    await fireEvent.click(screen.getByRole('button', { name: /Project notes/i }));
    expect(onToggle).toHaveBeenCalledWith('note-1');
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /select context panels/i })).toBeTruthy();
  });

  it('reports a pick and closes after inserting a terminal mention chip', async () => {
    vi.useFakeTimers();
    searchMock.mockResolvedValue([
      {
        id: 'term-1',
        type: 'terminal',
        label: 'Build terminal',
        uri: 'devspace://terminal/term-1',
      },
    ]);
    const onInsertMention = vi.fn();
    const onPick = vi.fn();
    render(ContextPickerButton, {
      props: {
        panels: [],
        workspace: { id: 'workspace-1' } as any,
        onInsertMention,
        onPick,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Add Context' }));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'build' } });
    await vi.advanceTimersByTimeAsync(250);
    const result = await vi.waitFor(() => screen.getByRole('button', { name: /Build terminal/i }));

    await fireEvent.click(result);
    expect(onInsertMention).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'term-1',
        type: 'terminal',
        uri: 'devspace://terminal/term-1',
      }),
    );
    expect(onPick).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /select context panels/i })).toBeNull(),
    );
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
    expect(screen.getByRole('status')).toBeTruthy();

    await fireEvent.input(input, { target: { value: 'ab' } });
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(searchMock).toHaveBeenLastCalledWith('ab', { workspaceId: 'workspace-1' });
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });
});

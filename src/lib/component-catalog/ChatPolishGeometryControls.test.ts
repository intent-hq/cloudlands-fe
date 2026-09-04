/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import { getCatalogEntry } from './catalog';
import CatalogFixtureList from './CatalogFixtureList.svelte';
import {
  CHAT_POLISH_STORAGE_KEY,
  chatPolishGeometryControls,
  defaultChatPolishGeometry,
} from './chat-polish/chat-polish-geometry';

const entry = getCatalogEntry('chat-polish')!;

describe('ChatPolishGeometryControls', () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    cleanup();
    vi.mocked(localStorage.getItem).mockReset().mockReturnValue(null);
    vi.mocked(localStorage.setItem).mockReset();
    vi.mocked(localStorage.removeItem).mockReset();
  });

  it('exposes named keyboard controls and updates every scoped custom property', async () => {
    const view = render(CatalogFixtureList, { props: { entry } });
    const workbench = screen.getByTestId('chat-polish-workbench');
    const sidebar = screen.getByTestId('chat-polish-sidebar');
    const examples = screen.getByTestId('chat-polish-examples');
    expect(
      sidebar.compareDocumentPosition(examples) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(chatPolishGeometryControls.length);

    for (const [index, control] of chatPolishGeometryControls.entries()) {
      const slider = screen.getByRole('slider', { name: control.label });
      const value = control.min + control.step * 2;
      await fireEvent.input(slider, { target: { value: String(value) } });
      expect(slider.getAttribute('aria-valuetext')).toBe(`${value} ${control.unit}`);
      const cssName = [
        '--chat-polish-',
        control.key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      ].join('');
      const aliases: Record<string, string> = {
        '--chat-polish-user-message-bottom-gap': '--chat-polish-user-bottom-gap',
        '--chat-polish-operational-row-gap': '--chat-operational-row-gap',
        '--chat-polish-operational-text-gap': '--chat-operational-text-gap',
        '--chat-polish-thinking-top-gap': '--chat-polish-thinking-top-gap',
        '--chat-polish-subscription-bottom-gap': '--chat-polish-subscription-bottom-gap',
        '--chat-polish-row-padding': '--chat-polish-row-padding',
        '--chat-polish-card-radius': '--chat-polish-card-radius',
      };
      expect(workbench.style.getPropertyValue(aliases[cssName] ?? cssName)).toBe(`${value}px`);
      expect(sliders[index]).toBe(slider);
    }

    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Compact mode' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Simulate sticky user messages' })).toBeTruthy();
    expect(screen.getByLabelText('Nested group spacing').textContent).toContain('6px fixed');
    expect(screen.getByLabelText('Expanded content bottom gap').textContent).toContain(
      '16px fixed',
    );
    expect(screen.getByLabelText('Current geometry values').textContent).toContain('W300');
    view.unmount();
  });

  it('keeps live changes unsaved until Save, then reloads and clears them on Reset', async () => {
    const first = render(CatalogFixtureList, { props: { entry } });
    const width = screen.getByRole('slider', { name: 'Panel width' });
    const operationalGap = screen.getByRole('slider', { name: 'Operational row gap' });
    await fireEvent.input(width, { target: { value: '640' } });
    await fireEvent.input(operationalGap, { target: { value: '12' } });
    await fireEvent.click(screen.getByRole('switch', { name: 'Compact mode' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Simulate sticky user messages' }));

    expect(screen.getAllByTestId('chat-polish-preview')).toHaveLength(1);
    expect((width as HTMLInputElement).value).toBe('640');
    expect(screen.getByTestId('chat-polish-preview').dataset.stickySimulated).toBe('true');
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Save status').textContent).toBe('Unsaved changes');
    await fireEvent.click(screen.getByRole('button', { name: 'Save tweaks' }));
    expect(screen.getByLabelText('Save status').textContent).toBe('All tweaks saved');
    expect(
      vi.mocked(localStorage.setItem).mock.calls.every(([key]) => key === CHAT_POLISH_STORAGE_KEY),
    ).toBe(true);
    const stored = vi.mocked(localStorage.setItem).mock.calls.at(-1)?.[1] ?? null;
    expect(stored).toContain('640');
    expect(stored).toContain('"operationalRowGap":12');
    first.unmount();

    vi.mocked(localStorage.getItem).mockReturnValue(stored);
    render(CatalogFixtureList, { props: { entry } });
    await waitFor(() => {
      expect((screen.getByRole('slider', { name: 'Panel width' }) as HTMLInputElement).value).toBe(
        '640',
      );
      expect(screen.getAllByTestId('chat-polish-preview')).toHaveLength(1);
      expect(
        (screen.getByRole('slider', { name: 'Operational row gap' }) as HTMLInputElement).value,
      ).toBe('12');
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset production defaults' }));
    expect((screen.getByRole('slider', { name: 'Panel width' }) as HTMLInputElement).value).toBe(
      String(defaultChatPolishGeometry.panelWidth),
    );
    expect(screen.getByRole('switch', { name: 'Compact mode' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(
      (screen.getByRole('slider', { name: 'Operational row gap' }) as HTMLInputElement).value,
    ).toBe(String(defaultChatPolishGeometry.operationalRowGap));
    expect(screen.getAllByTestId('chat-polish-preview')).toHaveLength(entry.fixtures.length);
    expect(localStorage.removeItem).toHaveBeenCalledWith(CHAT_POLISH_STORAGE_KEY);
    expect(screen.getByLabelText('Save status').textContent).toBe('Production defaults restored');
  });

  it('keeps live preview changes and reports save and reset storage failures', async () => {
    render(CatalogFixtureList, { props: { entry } });
    const width = screen.getByRole('slider', { name: 'Panel width' });
    await fireEvent.input(width, { target: { value: '680' } });
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('quota');
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save tweaks' }));
    expect((width as HTMLInputElement).value).toBe('680');
    expect(screen.getByLabelText('Save status').textContent).toContain('Could not save tweaks');

    vi.mocked(localStorage.removeItem).mockImplementation(() => {
      throw new Error('blocked');
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Reset production defaults' }));
    expect((width as HTMLInputElement).value).toBe(String(defaultChatPolishGeometry.panelWidth));
    expect(screen.getByLabelText('Save status').textContent).toContain(
      'saved override could not be cleared',
    );
  });
});

/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { themePresets } from '$lib/utils/theme-presets';
import {
  clearThemeCustomization,
  importCustomTheme,
  selectThemePreset,
  setThemeError,
} from '$store/renderer/slices/theme/theme-slice';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    theme: {
      name: 'light',
      preference: 'system',
      error: null as string | null,
      hasCustomTheme: false,
      customThemeName: null as string | null,
      activePresetId: null as string | null,
    },
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMock, createStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createStoreMockModule(
    createAppStoreMock({ state: () => mocks.state, dispatch: mocks.dispatch }),
  );
});

import ColorThemeSettings from './ColorThemeSettings.svelte';

function fileWithText(name: string, text: string) {
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(text) });
  return file;
}

beforeEach(() => {
  mocks.dispatch.mockClear();
  Object.assign(mocks.state.theme, {
    name: 'light',
    preference: 'system',
    error: null,
    hasCustomTheme: false,
    customThemeName: null,
    activePresetId: null,
  });
});

afterEach(cleanup);

describe('ColorThemeSettings', () => {
  it('uses canonical radio choices with selected and roving-focus semantics', async () => {
    render(ColorThemeSettings);
    expect(screen.getByText('Color Palette')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Color Palette' })).toBeTruthy();
    const defaultChoice = screen.getByRole('radio', { name: 'Default' });
    const presetChoice = screen.getByRole('radio', { name: themePresets[0].label });

    expect(defaultChoice.getAttribute('aria-checked')).toBe('true');
    expect(defaultChoice.parentElement?.className).toContain('border-transparent');
    expect(defaultChoice.className).toContain('data-[state=on]:border-transparent');
    defaultChoice.focus();
    await fireEvent.keyDown(defaultChoice, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(presetChoice);
    await fireEvent.click(presetChoice);

    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      setThemeError(null),
      selectThemePreset(themePresets[0].id),
    ]);
  });

  it('dispatches the exact default and imported-theme clear actions', async () => {
    mocks.state.theme.hasCustomTheme = true;
    mocks.state.theme.activePresetId = themePresets[0].id;
    const first = render(ColorThemeSettings);
    await fireEvent.click(screen.getByRole('radio', { name: 'Default' }));
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      setThemeError(null),
      clearThemeCustomization(),
    ]);
    first.unmount();

    mocks.dispatch.mockClear();
    mocks.state.theme.activePresetId = null;
    mocks.state.theme.customThemeName = 'Imported editorial theme';
    render(ColorThemeSettings);
    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      setThemeError(null),
      clearThemeCustomization(),
    ]);
  });

  it('imports JSONC through FileInput and resets so the same file can be selected again', async () => {
    const { container } = render(ColorThemeSettings);
    const input = container.querySelector('#color-theme-file') as HTMLInputElement;
    const json = { name: 'Editorial', type: 'dark', colors: { 'editor.background': '#111111' } };
    const file = fileWithText('editorial.json', `// theme\n${JSON.stringify(json)}`);

    expect(input.accept).toBe('.json');
    expect(input.multiple).toBe(false);
    expect(input.closest('[data-slot="file-input"]')).not.toBeNull();
    expect(input.closest('[data-slot="file-input"]')?.getAttribute('data-variant')).toBe('flat');
    expect(input.className).toContain('sr-only');
    expect(input.className).not.toContain('hidden');

    await fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(importCustomTheme(json)));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('JSON files only'),
    );

    await fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      const imports = mocks.dispatch.mock.calls.filter(
        ([action]) => action.type === importCustomTheme(json).type,
      );
      expect(imports).toHaveLength(2);
    });
  });

  it('shows invalid JSON feedback, resets, and accepts a subsequent valid file', async () => {
    const { container } = render(ColorThemeSettings);
    const input = container.querySelector('#color-theme-file') as HTMLInputElement;
    await fireEvent.change(input, {
      target: { files: [fileWithText('broken.json', '{ invalid json')] },
    });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Invalid JSON file. Please select a valid VS Code theme file.',
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      mocks.dispatch.mock.calls.some(([action]) => action.type === importCustomTheme({}).type),
    ).toBe(false);

    const valid = { name: 'Recovered', type: 'light', colors: {} };
    await fireEvent.change(input, {
      target: { files: [fileWithText('recovered.json', JSON.stringify(valid))] },
    });
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(importCustomTheme(valid)));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

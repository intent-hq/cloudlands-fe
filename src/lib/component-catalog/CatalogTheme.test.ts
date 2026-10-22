import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { setThemeName, setThemePreference } from '$store/renderer/slices/theme/theme-slice';
import SandboxLayout from '../../routes/sandbox/+layout.svelte';

vi.mock('$app/state', () => ({
  page: { params: {}, url: new URL('http://localhost/sandbox') },
}));

let disposeStore: () => void;
beforeEach(() => {
  disposeStore = store.init();
  window.history.replaceState(null, '', '/sandbox?theme=light');
  document.documentElement.className = 'dark';
});
afterEach(() => {
  cleanup();
  disposeStore();
  document.documentElement.removeAttribute('class');
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
});

describe('sandbox renderer theme ownership', () => {
  it('synchronizes initial light and round trips without changing application preferences', async () => {
    const initialTheme = { ...store.state.theme };
    const dispatch = vi.spyOn(store, 'dispatch');
    const layout = render(SandboxLayout);

    await waitFor(() => expect(store.state.theme.name).toBe('light'));
    for (const theme of ['Dark', 'Light'] as const) {
      await fireEvent.click(screen.getByRole('radio', { name: theme }));
      await waitFor(() => expect(store.state.theme.name).toBe(theme.toLowerCase()));
      expect(document.documentElement.classList.contains(theme.toLowerCase())).toBe(true);
    }
    expect(store.state.theme).toEqual({ ...initialTheme, name: 'light' });
    layout.unmount();
    expect(store.state.theme).toEqual(initialTheme);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    // Only the transient resolved name action is allowed; no preference/persistence request.
    expect(new Set(dispatch.mock.calls.map(([action]) => action.type))).toEqual(
      new Set(['theme/setThemeName']),
    );
    expect(localStorage.setItem).not.toHaveBeenCalledWith('theme', expect.anything());
  });

  it('restores only its theme name and preserves preference edits made while mounted', async () => {
    store.dispatch(setThemeName('light'));
    window.history.replaceState(null, '', '/sandbox?theme=dark');
    const layout = render(SandboxLayout);
    await waitFor(() => expect(store.state.theme.name).toBe('dark'));
    store.dispatch(setThemePreference('light'));
    layout.unmount();
    expect(store.state.theme.name).toBe('light');
    expect(store.state.theme.preference).toBe('light');
  });

  it('preserves a newer external theme name when leaving the preview', async () => {
    window.history.replaceState(null, '', '/sandbox?theme=dark');
    const layout = render(SandboxLayout);
    await waitFor(() => expect(document.documentElement.style.colorScheme).toBe('dark'));
    store.dispatch(setThemeName('light'));
    layout.unmount();
    expect(store.state.theme.name).toBe('light');
  });

  it('does not reclaim ownership when external changes return to the preview value', async () => {
    const layout = render(SandboxLayout);
    await waitFor(() => expect(store.state.theme.name).toBe('light'));
    store.dispatch(setThemeName('dark'));
    store.dispatch(setThemeName('light'));
    layout.unmount();
    expect(store.state.theme.name).toBe('light');
  });

  it('restores the newer external value after the user takes preview ownership again', async () => {
    window.history.replaceState(null, '', '/sandbox?theme=dark');
    const layout = render(SandboxLayout);
    await waitFor(() => expect(document.documentElement.style.colorScheme).toBe('dark'));
    store.dispatch(setThemeName('light'));
    await fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(store.state.theme.name).toBe('dark'));
    layout.unmount();
    expect(store.state.theme.name).toBe('light');
  });

  it('follows system appearance changes while the system option is selected', async () => {
    const media = new EventTarget();
    let dark = false;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      media: query,
      get matches() {
        return query === '(prefers-color-scheme: dark)' && dark;
      },
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: media.addEventListener.bind(media),
      removeEventListener: media.removeEventListener.bind(media),
      dispatchEvent: media.dispatchEvent.bind(media),
    }));
    window.history.replaceState(null, '', '/sandbox?theme=system');
    const layout = render(SandboxLayout);
    await waitFor(() => expect(store.state.theme.name).toBe('light'));
    dark = true;
    media.dispatchEvent(new Event('change'));
    await waitFor(() => expect(store.state.theme.name).toBe('dark'));
    dark = false;
    media.dispatchEvent(new Event('change'));
    await waitFor(() => expect(store.state.theme.name).toBe('light'));
    layout.unmount();
    expect(store.state.theme.name).toBe('dark');
    media.dispatchEvent(new Event('change'));
    expect(store.state.theme.name).toBe('dark');
  });
});

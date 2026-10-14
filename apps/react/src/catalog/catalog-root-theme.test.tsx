import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { selectIsDarkTheme } from '@/store/theme/theme-selectors';
import { setCatalogPreferences } from '@/store/catalog/catalog-slice';
import { setThemeName } from '../../../../src/store/renderer/slices/theme/theme-slice';
import { CatalogShell } from './catalog-shell';
import { ownCatalogRootTheme } from './catalog-root-theme';

const route = vi.hoisted(() => ({ pathname: '/sandbox', searchStr: '?fit=component' }));
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => route,
  useNavigate: () => vi.fn(),
}));
// The catalog inventory is unrelated to root ownership; keep this a small unit mount.
vi.mock('./catalog', () => ({ catalogEntries: [] }));
vi.mock('./catalog-controls', () => ({ CatalogControls: () => null }));
vi.mock('./catalog-navigation-menu', () => ({ CatalogNavigationMenu: () => null }));
vi.mock('./catalog-link', () => ({ CatalogLink: () => null }));
vi.mock('./preview-discovery', () => ({ installPreviewBrowserApi: () => () => {} }));

function ThemeReader() {
  const dark = selectIsDarkTheme();
  return <output>{dark.value ? 'dark' : 'light'}</output>;
}

describe('catalog root theme ownership', () => {
  let disposeStore: () => void;
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let systemDark: boolean;
  let media: EventTarget;
  let originalClasses: string;
  let originalStyle: string | null;
  const listeners = new Set<EventListenerOrEventListenerObject>();

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    systemDark = false;
    media = new EventTarget();
    listeners.clear();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return query === '(prefers-color-scheme: dark)' && systemDark;
      },
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (query !== '(prefers-color-scheme: dark)') return;
        listeners.add(listener);
        media.addEventListener(type, listener);
      },
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (query !== '(prefers-color-scheme: dark)') return;
        listeners.delete(listener);
        media.removeEventListener(type, listener);
      },
    }));
    route.searchStr = '?fit=component';
    originalClasses = document.documentElement.className;
    originalStyle = document.documentElement.getAttribute('style');
    document.documentElement.className = 'outside dark';
    document.documentElement.style.setProperty('color-scheme', 'dark', 'important');
    disposeStore = store.init();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(store, 'dispatch');
    disposeStore();
    document.documentElement.className = originalClasses;
    if (originalStyle === null) document.documentElement.removeAttribute('style');
    else document.documentElement.setAttribute('style', originalStyle);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(
        <StrictMode>
          <CatalogShell>
            <ThemeReader />
          </CatalogShell>
        </StrictMode>,
      );
    });
  }

  async function settleSignals() {
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }

  function expectTheme(name: 'light' | 'dark') {
    expect(selectIsDarkTheme.select(store.state)).toBe(name === 'dark');
    expect(container.querySelector('output')?.textContent).toBe(name);
    expect(document.documentElement.classList.contains(name)).toBe(true);
    expect(document.documentElement.classList.contains(name === 'dark' ? 'light' : 'dark')).toBe(
      false,
    );
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe(name);
  }

  it('publishes explicit and system changes to the real selector, then restores on disposal', async () => {
    const before = store.state.theme;
    const dispatch = vi.fn(store.dispatch);
    Object.defineProperty(store, 'dispatch', { configurable: true, get: () => dispatch });
    route.searchStr = '?fit=component&theme=light';
    await render();
    await settleSignals();
    expectTheme('light');

    systemDark = true;
    await act(async () => {
      media.dispatchEvent(new Event('change'));
    });
    await settleSignals();
    expectTheme('light');

    route.searchStr = '?fit=component&theme=dark';
    await render();
    await settleSignals();
    expectTheme('dark');

    route.searchStr = '?fit=component&theme=system';
    await render();
    systemDark = false;
    await act(async () => {
      media.dispatchEvent(new Event('change'));
    });
    await settleSignals();
    expectTheme('light');

    systemDark = true;
    await act(async () => {
      media.dispatchEvent(new Event('change'));
    });
    await settleSignals();
    expectTheme('dark');
    expect(listeners.size).toBe(1);

    await act(async () => root.unmount());
    mounted = false;
    expect(listeners.size).toBe(0);
    expect(store.state.theme).toEqual(before);
    expect(document.documentElement.className).toBe('outside dark');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark');
    expect(document.documentElement.style.getPropertyPriority('color-scheme')).toBe('important');
    const after = store.state;
    media.dispatchEvent(new Event('change'));
    expect(store.state).toBe(after);
    // Catalog persistence stays with its existing action; no theme preference request is sent.
    expect(new Set(dispatch.mock.calls.map(([action]) => action.type))).toEqual(
      new Set([setThemeName.type, setCatalogPreferences.type]),
    );
  });

  it('reacts to saved preferences without a URL override and preserves external root writes', async () => {
    await render();
    await settleSignals();
    expectTheme('light');
    await act(async () => {
      store.dispatch(setCatalogPreferences({ ...store.state.catalog.preferences, theme: 'dark' }));
    });
    await settleSignals();
    await settleSignals();
    expectTheme('dark');
    document.documentElement.style.setProperty('color-scheme', 'light', 'important');
    store.dispatch(setThemeName('light'));
    await act(async () => root.unmount());
    mounted = false;
    expect(store.state.theme.name).toBe('light');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
    expect(document.documentElement.style.getPropertyPriority('color-scheme')).toBe('important');
  });

  it('defers older cleanup and does not resurrect a disposed owner even for equal theme values', () => {
    const restored: string[] = [];
    const element = document.documentElement;
    const releaseOlder = ownCatalogRootTheme(element, store, 'light', () => restored.push('older'));
    const releaseNewer = ownCatalogRootTheme(element, store, 'light', () => restored.push('newer'));
    releaseOlder();
    expect(restored).toEqual([]);
    expect(selectIsDarkTheme.select(store.state)).toBe(false);
    releaseNewer();
    expect(restored).toEqual(['newer', 'older']);
    expect(selectIsDarkTheme.select(store.state)).toBe(true);
    releaseNewer();
    releaseOlder();
    expect(restored).toHaveLength(2);
  });

  it('restores a still-mounted owner before restoring the original theme', () => {
    const element = document.documentElement;
    const releaseOlder = ownCatalogRootTheme(element, store, 'light', () => {});
    const releaseNewer = ownCatalogRootTheme(element, store, 'dark', () => {});
    releaseNewer();
    expect(selectIsDarkTheme.select(store.state)).toBe(false);
    releaseOlder();
    expect(selectIsDarkTheme.select(store.state)).toBe(true);
  });
});

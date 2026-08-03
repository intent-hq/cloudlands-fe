/**
 * HudHeader tests — the workspace state counter strip moved to the footer
 * (HudFooter.svelte, which owns the counter/blink tests); the header keeps
 * the wordmark, filters, clock, and controls. This suite pins the header
 * against regressions re-introducing the counter strip, plus the macOS-only
 * traffic-light spacer strip above the header row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { requestThemePreferenceChange } from '$store/renderer/slices/theme/theme-slice';
import { ThemeManager } from '$lib/utils/theme';
import { __resetThemeMutationForTests } from '../../theme/theme-service';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import HudHeader from './HudHeader.svelte';

const NOW_MS = Date.parse('2026-07-30T12:00:00Z');

describe('HudHeader after the counter strip moved to the footer', () => {
  beforeEach(() => {
    appStore.init();
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('renders the header without any workspace state counters', () => {
    const { container } = render(HudHeader, { props: { nowMs: NOW_MS } });

    expect(screen.getByTestId('hud-header')).toBeTruthy();
    expect(screen.queryByTestId('hud-header-stat-attn')).toBeNull();
    expect(screen.queryByTestId('hud-header-stat-fail')).toBeNull();
    expect(container.querySelector('.hud-header-stats')).toBeNull();
  });

  it('stays counter-free when workspaces enter attention states', () => {
    const { container } = render(HudHeader, { props: { nowMs: NOW_MS } });

    appStore.dispatch(
      setWorkspaceEntity({
        id: 'ws-1' as WorkspaceId,
        title: 'Workspace ws-1',
        branch: 'main',
        displayStatus: 'needs_attention',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        status: WorkspaceStatus.Active,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as unknown as Workspace),
    );
    flushSync();

    expect(screen.queryByTestId('hud-header-stat-attn')).toBeNull();
    expect(container.querySelector('.hud-header-stats')).toBeNull();
  });
});

describe('HudHeader macOS traffic-light spacer', () => {
  beforeEach(() => {
    appStore.init();
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
  });

  it('renders the drag-region spacer strip above the header on darwin', () => {
    (window as any).electronAPI.platform = 'darwin';
    render(HudHeader, { props: { nowMs: NOW_MS } });

    const spacer = screen.getByTestId('hud-titlebar-spacer');
    expect(spacer.classList.contains('hud-titlebar-spacer')).toBe(true);
    // The header row sits fully BELOW the strip so the traffic lights never
    // cover the wordmark/filters/clock.
    const header = screen.getByTestId('hud-header');
    expect(spacer.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(['win32', 'linux'])('renders no spacer strip on %s (framed window)', (platform) => {
    (window as any).electronAPI.platform = platform;
    render(HudHeader, { props: { nowMs: NOW_MS } });

    expect(screen.queryByTestId('hud-titlebar-spacer')).toBeNull();
    expect(screen.getByTestId('hud-header')).toBeTruthy();
  });

  it('keeps the wordmark in the header row (left gutter unchanged), not in the spacer', () => {
    (window as any).electronAPI.platform = 'darwin';
    render(HudHeader, { props: { nowMs: NOW_MS } });

    const header = screen.getByTestId('hud-header');
    const wordmark = header.querySelector('.hud-header-wordmark');
    expect(wordmark?.textContent).toBe('INTENT');
    // Alignment regression: the spacer holds no content and the wordmark's
    // container is still the header's left side track (24px gutter from the
    // header padding, aligned with the SYSTEM card).
    expect(screen.getByTestId('hud-titlebar-spacer').textContent).toBe('');
    expect(wordmark?.closest('.hud-header-side-left')).toBeTruthy();
  });
});

describe('HudHeader theme switcher with SYSTEM mode', () => {
  /**
   * These tests run the REAL theme plumbing the main app uses: the theme
   * mutation middleware (installed in the configured store) routes
   * `requestThemePreferenceChange` through the ThemeManager singleton, which
   * persists to the shared `theme` localStorage key and resolves `system`
   * through the `prefers-color-scheme` media query. A controllable matchMedia
   * stub captures the manager's change listener so an OS appearance flip can
   * be simulated.
   */
  let mediaMatches = false;
  let mediaChangeListeners: Array<() => void> = [];

  function stubControllableMatchMedia(): void {
    mediaMatches = false;
    mediaChangeListeners = [];
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return mediaMatches;
        },
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (type: string, cb: () => void) => {
          if (type === 'change') mediaChangeListeners.push(cb);
        },
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  function themeState(): { preference: string; name: string } {
    return (appStore.state as { theme: { preference: string; name: string } }).theme;
  }

  beforeEach(() => {
    stubControllableMatchMedia();
    ThemeManager.resetInstance();
    __resetThemeMutationForTests();
    appStore.init();
  });
  afterEach(() => {
    cleanup();
    appStore.dispose();
    ThemeManager.resetInstance();
    __resetThemeMutationForTests();
  });

  it('cycles LIGHT → DARK → SYSTEM → LIGHT and labels all three states', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });
    const btn = screen.getByTestId('hud-header-theme-btn');

    // Default preference is `system` (same as the main app's default).
    expect(btn.textContent?.trim()).toBe('THEME · SYSTEM');

    await fireEvent.click(btn);
    flushSync();
    expect(themeState().preference).toBe('light');
    expect(btn.textContent?.trim()).toBe('THEME · LIGHT');

    await fireEvent.click(btn);
    flushSync();
    expect(themeState().preference).toBe('dark');
    expect(btn.textContent?.trim()).toBe('THEME · DARK');

    await fireEvent.click(btn);
    flushSync();
    expect(themeState().preference).toBe('system');
    expect(btn.textContent?.trim()).toBe('THEME · SYSTEM');

    await fireEvent.click(btn);
    flushSync();
    expect(themeState().preference).toBe('light');
    expect(btn.textContent?.trim()).toBe('THEME · LIGHT');
  });

  it('persists the preference under the main app\'s shared `theme` localStorage key', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });
    const btn = screen.getByTestId('hud-header-theme-btn');

    await fireEvent.click(btn);
    flushSync();

    // i18n-ignore (localStorage key, wire constant)
    expect(window.localStorage.setItem).toHaveBeenCalledWith('theme', 'light');
  });

  it('resolves SYSTEM to the OS appearance and re-themes live on an appearance change', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });
    const btn = screen.getByTestId('hud-header-theme-btn');

    appStore.dispatch(requestThemePreferenceChange('system'));
    flushSync();

    // OS reports light (mediaMatches=false) → resolved name is light.
    expect(themeState().preference).toBe('system');
    expect(themeState().name).toBe('light');
    expect(mediaChangeListeners.length).toBeGreaterThan(0);

    // Simulate the OS flipping to dark: the ThemeManager media-query listener
    // re-applies the theme and its `theme-changed` window event flows back
    // into Redux — no reload, no re-dispatch from the HUD.
    mediaMatches = true;
    for (const cb of mediaChangeListeners) cb();
    flushSync();

    expect(themeState().preference).toBe('system');
    expect(themeState().name).toBe('dark');
    expect(btn.textContent?.trim()).toBe('THEME · SYSTEM');
  });
});

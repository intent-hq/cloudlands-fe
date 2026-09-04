/**
 * HudHeader tests — the workspace state counter strip moved to the footer
 * (HudFooter.svelte, which owns the counter/blink tests); the header keeps
 * the wordmark, filters, clock, and controls. This suite pins the header
 * against regressions re-introducing the counter strip, plus the macOS-only
 * traffic-light spacer strip above the header row.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';

import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  requestThemePreferenceChange,
  setThemePreference,
} from '$store/renderer/slices/theme/theme-slice';
import { themeSaga } from '$store/renderer/slices/theme/sagas/theme-saga';
import { ThemeManager } from '$lib/utils/theme';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';

import HudHeader from './HudHeader.svelte';
import {
  getHudSoundVolume,
  HUD_SOUND_DEFAULT_VOLUME,
  HUD_SOUND_ENABLED_STORAGE_KEY,
  HUD_SOUND_VOLUME_STORAGE_KEY,
  setHudSoundEnabled,
  setHudSoundVolume,
} from '../sound/hud-sound-state';
import { playHudSoundCue } from '../sound/hud-sound-player';

// The toggle plays a confirmation cue in-gesture on enable (audio unlock);
// mock the player so the test asserts the call without real Audio.
vi.mock('../sound/hud-sound-player', () => ({
  playHudSoundCue: vi.fn().mockResolvedValue(undefined),
}));

const NOW_MS = Date.parse('2026-07-30T12:00:00Z');

beforeAll(() => appStore.init());
afterAll(() => appStore.dispose());

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('HudHeader after the counter strip moved to the footer', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the header without any workspace state counters', () => {
    const { container } = render(HudHeader, { props: { nowMs: NOW_MS } });

    expect(screen.getByTestId('hud-header')).toBeTruthy();
    expect(screen.queryByTestId('hud-header-stat-attn')).toBeNull();
    expect(screen.queryByTestId('hud-header-stat-fail')).toBeNull();
    expect(container.querySelector('.hud-header-stats')).toBeNull();
  });

  it('marks the header as an app-drag-region so interactive children stay no-drag (#1907)', () => {
    // The global app.css no-drag rule is scoped to .app-drag-region
    // descendants; the header carries the class so its theme button/filters
    // remain clickable inside the frameless window's drag region.
    render(HudHeader, { props: { nowMs: NOW_MS } });

    const header = screen.getByTestId('hud-header');
    expect(header.classList.contains('app-drag-region')).toBe(true);
    expect(screen.getByTestId('hud-header-theme-btn').closest('.app-drag-region')).toBe(header);
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
  afterEach(() => {
    cleanup();
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

  it('hides the spacer strip on darwin in full screen (traffic lights hidden)', () => {
    (window as any).electronAPI.platform = 'darwin';
    render(HudHeader, { props: { nowMs: NOW_MS, isFullScreen: true } });

    expect(screen.queryByTestId('hud-titlebar-spacer')).toBeNull();
    expect(screen.getByTestId('hud-header')).toBeTruthy();
  });

  it('re-shows the spacer when full screen exits (prop reactivity)', async () => {
    (window as any).electronAPI.platform = 'darwin';
    const { rerender } = render(HudHeader, { props: { nowMs: NOW_MS, isFullScreen: false } });
    expect(screen.getByTestId('hud-titlebar-spacer')).toBeTruthy();

    await rerender({ nowMs: NOW_MS, isFullScreen: true });
    expect(screen.queryByTestId('hud-titlebar-spacer')).toBeNull();

    await rerender({ nowMs: NOW_MS, isFullScreen: false });
    expect(screen.getByTestId('hud-titlebar-spacer')).toBeTruthy();
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
   * These tests run the REAL theme plumbing the main app uses: the root-owned
   * theme saga routes `requestThemePreferenceChange` through the ThemeManager singleton, which
   * persists to the shared `theme` localStorage key and resolves `system`
   * through the `prefers-color-scheme` media query. A controllable matchMedia
   * stub captures the manager's change listener so an OS appearance flip can
   * be simulated.
   */
  let mediaMatches = false;
  let mediaChangeListeners: Array<() => void> = [];
  let stopThemeSaga: (() => void) | null = null;

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

  beforeEach(async () => {
    stubControllableMatchMedia();
    ThemeManager.resetInstance();
    appStore.dispatch(setThemePreference('system'));
    stopThemeSaga = appStore.runSaga(themeSaga);
    await settle();
  });
  afterEach(async () => {
    stopThemeSaga?.();
    stopThemeSaga = null;
    await settle();
    cleanup();
    ThemeManager.resetInstance();
  });

  it('cycles LIGHT → DARK → SYSTEM → LIGHT and labels all three states', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });
    const btn = screen.getByTestId('hud-header-theme-btn');

    // Default preference is `system` (same as the main app's default).
    expect(btn.textContent?.trim()).toBe('THEME · SYSTEM');

    await fireEvent.click(btn);
    await settle();
    expect(themeState().preference).toBe('light');
    await waitFor(() => {
      flushSync();
      expect(btn.textContent?.trim()).toBe('THEME · LIGHT');
    });

    await fireEvent.click(btn);
    await settle();
    expect(themeState().preference).toBe('dark');
    await waitFor(() => {
      flushSync();
      expect(btn.textContent?.trim()).toBe('THEME · DARK');
    });

    await fireEvent.click(btn);
    await settle();
    expect(themeState().preference).toBe('system');
    await waitFor(() => {
      flushSync();
      expect(btn.textContent?.trim()).toBe('THEME · SYSTEM');
    });

    await fireEvent.click(btn);
    await settle();
    expect(themeState().preference).toBe('light');
    await waitFor(() => {
      flushSync();
      expect(btn.textContent?.trim()).toBe('THEME · LIGHT');
    });
  });

  it("persists the preference under the main app's shared `theme` localStorage key", async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });
    const btn = screen.getByTestId('hud-header-theme-btn');

    await fireEvent.click(btn);
    await settle();
    flushSync();

    // i18n-ignore (localStorage key, wire constant)
    expect(window.localStorage.setItem).toHaveBeenCalledWith('theme', 'light');
  });

  it('resolves SYSTEM to the OS appearance and re-themes live on an appearance change', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });
    const btn = screen.getByTestId('hud-header-theme-btn');

    appStore.dispatch(requestThemePreferenceChange('system'));
    await settle();
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
    await settle();
    flushSync();

    expect(themeState().preference).toBe('system');
    expect(themeState().name).toBe('dark');
    expect(btn.textContent?.trim()).toBe('THEME · SYSTEM');
  });
});

describe('HudHeader sound-effects toggle', () => {
  /**
   * The speaker button drives the shared localStorage-backed enable state
   * (features/hud/sound/hud-sound-state.ts) the HUD sound service gates on.
   * The state is module-global (read from localStorage once at import; the
   * test-setup localStorage mock is a no-op vi.fn), so each test resets it
   * to the OFF default and persistence is asserted via setItem calls.
   */
  beforeEach(() => {
    setHudSoundEnabled(false);
    vi.mocked(window.localStorage.setItem).mockClear();
    vi.mocked(playHudSoundCue).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the speaker button immediately LEFT of the theme button, same styling', () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    const soundBtn = screen.getByTestId('hud-header-sound-btn');
    const themeBtn = screen.getByTestId('hud-header-theme-btn');
    // The button sits in the hover group (with the volume slider) whose
    // next sibling is the theme button.
    const group = screen.getByTestId('hud-header-sound-group');
    expect(soundBtn.closest('[data-testid="hud-header-sound-group"]')).toBe(group);
    expect(group.nextElementSibling).toBe(themeBtn);
    // Same bordered JetBrains Mono uppercase look as the theme button, and
    // still clickable inside the frameless window's drag region.
    expect(soundBtn.classList.contains('hud-header-sound-btn')).toBe(true);
    expect(soundBtn.closest('.app-drag-region')).toBe(screen.getByTestId('hud-header'));
  });

  it('renders OFF when the shared state is off (the first-run default)', () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    const soundBtn = screen.getByTestId('hud-header-sound-btn');
    expect(soundBtn.textContent?.trim()).toBe('SOUND · OFF');
    expect(soundBtn.getAttribute('aria-pressed')).toBe('false');
    expect(soundBtn.getAttribute('aria-label')).toBe('Toggle HUD sound effects');
  });

  it('click toggles ON/OFF and persists each state to localStorage', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });
    const soundBtn = screen.getByTestId('hud-header-sound-btn');

    await fireEvent.click(soundBtn);
    flushSync();
    expect(soundBtn.textContent?.trim()).toBe('SOUND · ON');
    expect(soundBtn.getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(HUD_SOUND_ENABLED_STORAGE_KEY, 'true');

    await fireEvent.click(soundBtn);
    flushSync();
    expect(soundBtn.textContent?.trim()).toBe('SOUND · OFF');
    expect(soundBtn.getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      HUD_SOUND_ENABLED_STORAGE_KEY,
      'false',
    );
  });

  it('plays the confirmation cue only when toggling ON (in-gesture audio unlock)', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });
    const soundBtn = screen.getByTestId('hud-header-sound-btn');

    await fireEvent.click(soundBtn); // OFF -> ON
    expect(playHudSoundCue).toHaveBeenCalledTimes(1);
    expect(playHudSoundCue).toHaveBeenCalledWith('status-update');

    await fireEvent.click(soundBtn); // ON -> OFF: silent
    expect(playHudSoundCue).toHaveBeenCalledTimes(1);
  });

  it('reflects a pre-existing ON state on mount (persisted-state restore path)', () => {
    // Restart restore: hud-sound-state reads localStorage at import and the
    // header renders whatever the shared state holds when it mounts.
    setHudSoundEnabled(true);
    render(HudHeader, { props: { nowMs: NOW_MS } });

    const soundBtn = screen.getByTestId('hud-header-sound-btn');
    expect(soundBtn.textContent?.trim()).toBe('SOUND · ON');
    expect(soundBtn.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('HudHeader master-volume slider', () => {
  /**
   * The slider is hover-revealed (mouseenter/mouseleave on the sound group)
   * and focus-revealed (focusin, for keyboard users tabbing to the speaker
   * button) and drives the shared persisted master volume every cue play
   * multiplies with its per-cue pack volume.
   */
  beforeEach(() => {
    setHudSoundEnabled(false);
    setHudSoundVolume(HUD_SOUND_DEFAULT_VOLUME);
    vi.mocked(window.localStorage.setItem).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('is hidden until the pointer hovers the sound group, then hides on leave', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });
    const group = screen.getByTestId('hud-header-sound-group');

    expect(screen.queryByTestId('hud-header-volume-slider')).toBeNull();

    await fireEvent.mouseEnter(group);
    flushSync();
    expect(screen.getByTestId('hud-header-volume-slider')).toBeTruthy();

    await fireEvent.mouseLeave(group);
    flushSync();
    expect(screen.queryByTestId('hud-header-volume-slider')).toBeNull();
  });

  it('is revealed on keyboard focus within the group (focusin)', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });
    const soundBtn = screen.getByTestId('hud-header-sound-btn');

    await fireEvent.focusIn(soundBtn);
    flushSync();
    const slider = screen.getByTestId('hud-header-volume-slider') as HTMLInputElement;
    // Native range input semantics (0..1) keep it keyboard-operable.
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('1');
    expect(slider.getAttribute('aria-label')).toBe('HUD sound volume');
  });

  it('defaults to the 0.3 master volume and stays a no-drag interactive child', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    await fireEvent.mouseEnter(screen.getByTestId('hud-header-sound-group'));
    flushSync();
    const slider = screen.getByTestId('hud-header-volume-slider') as HTMLInputElement;
    expect(Number(slider.value)).toBe(0.3);
    // Inside the header drag region: the global app.css no-drag rule covers inputs.
    expect(slider.closest('.app-drag-region')).toBe(screen.getByTestId('hud-header'));
  });

  it('dragging updates the shared master volume live and persists it', async () => {
    render(HudHeader, { props: { nowMs: NOW_MS } });

    await fireEvent.mouseEnter(screen.getByTestId('hud-header-sound-group'));
    flushSync();
    const slider = screen.getByTestId('hud-header-volume-slider') as HTMLInputElement;

    await fireEvent.input(slider, { target: { value: '0.75' } });
    flushSync();
    expect(getHudSoundVolume()).toBe(0.75);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(HUD_SOUND_VOLUME_STORAGE_KEY, '0.75');
  });
});

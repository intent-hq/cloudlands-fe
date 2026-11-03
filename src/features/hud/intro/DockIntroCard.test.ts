/**
 * @vitest-environment jsdom
 *
 * The dock's "Meet the notch" card and its state: closed until the real dock
 * initializes it; open once per profile; "Got it" retires it for good; "Turn off"
 * retires it only after main confirms the dock is off, and a failed or rejected
 * save leaves it in place without claiming anything.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  request: vi.fn<(enabled: boolean) => Promise<boolean>>(),
}));
vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: {
    getItem: (key: string) => mocks.storage.get(key) ?? null,
    setItem: (key: string, value: string) => mocks.storage.set(key, value),
    removeItem: (key: string) => mocks.storage.delete(key),
  },
}));
vi.mock('$lib/dock-lab', () => ({ requestDockLabEnabled: mocks.request }));

import DockIntroCard from './DockIntroCard.svelte';
import { dismissDockIntro, dockIntro, initDockIntro } from './dock-intro.svelte';

beforeEach(() => {
  mocks.storage.clear();
  mocks.request.mockReset();
  dockIntro.open = false;
});

describe('dock intro state', () => {
  it('is closed until the dock initializes it, then open once per profile', () => {
    expect(dockIntro.open).toBe(false);
    initDockIntro();
    expect(dockIntro.open).toBe(true);
    dismissDockIntro();
    expect(dockIntro.open).toBe(false);
    initDockIntro();
    expect(dockIntro.open).toBe(false);
  });
});

describe('DockIntroCard', () => {
  it('shows the intro and retires it on "Got it"', async () => {
    initDockIntro();
    render(DockIntroCard);
    expect(screen.getByRole('heading', { name: m.dock_intro_title() })).toBeTruthy();
    expect(screen.getByText(m.dock_intro_description())).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: m.dock_intro_gotIt_label() }));
    expect(dockIntro.open).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('retires the intro on "Turn off" once main confirms the dock is off', async () => {
    initDockIntro();
    // Main closes the dock as soon as it confirms, so the card is already marked
    // seen when the request goes out.
    let seenAtRequest: string | undefined;
    mocks.request.mockImplementation(async () => {
      seenAtRequest = mocks.storage.get('intent:dock-intro-seen:v1');
      return true;
    });
    render(DockIntroCard);
    await fireEvent.click(screen.getByRole('button', { name: m.dock_intro_turnOff_label() }));
    expect(mocks.request).toHaveBeenCalledWith(false);
    await waitFor(() => expect(dockIntro.open).toBe(false));
    expect(seenAtRequest).toBe('1');
    initDockIntro();
    expect(dockIntro.open).toBe(false);
  });

  it('keeps the intro when the save fails or is rejected', async () => {
    initDockIntro();
    mocks.request.mockResolvedValue(false);
    render(DockIntroCard);
    const turnOff = screen.getByRole('button', { name: m.dock_intro_turnOff_label() });
    await fireEvent.click(turnOff);
    await waitFor(() => expect((turnOff as HTMLButtonElement).disabled).toBe(false));
    expect(dockIntro.open).toBe(true);
    expect(mocks.storage.size).toBe(0);
  });
});

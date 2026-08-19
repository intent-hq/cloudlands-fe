import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_POLISH_STORAGE_KEY,
  clearChatPolishPreferences,
  defaultChatPolishGeometry,
  formatChatPolishGeometry,
  readChatPolishPreferences,
  writeChatPolishPreferences,
} from './chat-polish-geometry';

describe('chat-polish sandbox preferences', () => {
  it('uses production defaults and validates stored preview values', () => {
    expect(defaultChatPolishGeometry).toEqual({
      panelWidth: 510,
      compact: false,
      contentInset: 22,
      userMessageBottomGap: 24,
      operationalRowGap: 4,
      operationalTextGap: 16,
      thinkingTopGap: 16,
      wakeTopGap: 20,
      wakeBottomGap: 16,
      subscriptionBottomGap: 16,
      rowPadding: 12,
      cardRadius: 9,
      failureNoticeTopGap: 16,
      failureNoticeBottomGap: 16,
      stickySimulation: false,
    });
    const storage = {
      getItem: vi.fn(() =>
        JSON.stringify({
          geometry: {
            panelWidth: 1200,
            contentInset: 17,
            operationalRowGap: -4,
            operationalTextGap: 100,
            compact: true,
            stickySimulation: true,
            cardRadius: 'invalid',
          },
          selectedScenario: 'mixed-order',
        }),
      ),
    } as unknown as Storage;

    expect(readChatPolishPreferences(storage)).toEqual({
      geometry: {
        ...defaultChatPolishGeometry,
        panelWidth: 900,
        contentInset: 17,
        operationalRowGap: 0,
        operationalTextGap: 32,
        compact: true,
        stickySimulation: true,
      },
      selectedScenario: 'mixed-order',
    });

    vi.mocked(storage.getItem).mockReturnValue('{');
    expect(readChatPolishPreferences(storage)).toEqual({
      geometry: defaultChatPolishGeometry,
      selectedScenario: 'all',
    });
  });

  it('writes one sandbox-only payload and formats a shareable summary', () => {
    const setItem = vi.fn();
    const value = {
      geometry: { ...defaultChatPolishGeometry, panelWidth: 620 },
      selectedScenario: 'wake-response',
    };
    expect(writeChatPolishPreferences({ setItem } as unknown as Storage, value)).toBe(true);
    expect(setItem).toHaveBeenCalledWith(CHAT_POLISH_STORAGE_KEY, JSON.stringify(value));
    expect(formatChatPolishGeometry(defaultChatPolishGeometry)).toBe(
      'W510 · inset22 · user24 · ops4 · opText16 · nested6 · think16 · wake20/16 · subs16 · fail16/16 · rows12 · radius9 · regular · flow',
    );
  });

  it('reports unavailable storage without stopping preview controls', () => {
    const error = new Error('storage unavailable');
    const storage = {
      setItem: vi.fn(() => {
        throw error;
      }),
      removeItem: vi.fn(() => {
        throw error;
      }),
    } as unknown as Storage;

    expect(
      writeChatPolishPreferences(storage, {
        geometry: defaultChatPolishGeometry,
        selectedScenario: 'all',
      }),
    ).toBe(false);
    expect(clearChatPolishPreferences(storage)).toBe(false);
  });
});

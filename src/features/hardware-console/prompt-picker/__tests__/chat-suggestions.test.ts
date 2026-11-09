import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFocusedChatSuggestions, publishFocusedChatSuggestions } from '../chat-suggestions';

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

describe('focused chat suggestions', () => {
  it('exposes the published source until it is released', () => {
    const source = { prompts: ['a'], send: vi.fn() };
    const release = publishFocusedChatSuggestions(source);
    expect(getFocusedChatSuggestions()).toBe(source);
    release();
    expect(getFocusedChatSuggestions()).toBeNull();
  });

  it('a stale release does not clear a newer chat', () => {
    const first = { prompts: ['a'], send: vi.fn() };
    const second = { prompts: ['b'], send: vi.fn() };
    const releaseFirst = publishFocusedChatSuggestions(first);
    releases.push(publishFocusedChatSuggestions(second));
    releaseFirst();
    expect(getFocusedChatSuggestions()).toBe(second);
  });
});

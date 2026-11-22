import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFocusedChatSuggestions, publishFocusedChatSuggestions } from '../chat-suggestions';

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
});

describe('focused chat suggestions', () => {
  it('exposes the published source until it is released', () => {
    const source = { ownerId: 'a', prompts: ['a'], send: vi.fn() };
    const release = publishFocusedChatSuggestions(source);
    expect(getFocusedChatSuggestions()).toBe(source);
    release();
    expect(getFocusedChatSuggestions()).toBeNull();
  });

  it('a stale release does not clear a newer chat', () => {
    const first = { ownerId: 'a', prompts: ['a'], send: vi.fn() };
    const second = { ownerId: 'b', prompts: ['b'], send: vi.fn() };
    const releaseFirst = publishFocusedChatSuggestions(first);
    releases.push(publishFocusedChatSuggestions(second));
    releaseFirst();
    expect(getFocusedChatSuggestions()).toBe(second);
  });
});

describe('fallback chat target', () => {
  it('serves the fallback chat only while no chat is focused', () => {
    const home = { ownerId: 'home', prompts: ['h'], send: vi.fn() };
    const focused = { ownerId: 'tab', prompts: ['t'], send: vi.fn() };
    releases.push(publishFocusedChatSuggestions(home, { fallback: true }));
    expect(getFocusedChatSuggestions()).toBe(home);
    const releaseFocused = publishFocusedChatSuggestions(focused);
    expect(getFocusedChatSuggestions()).toBe(focused);
    releaseFocused();
    expect(getFocusedChatSuggestions()).toBe(home);
  });

  it('a fallback published later does not displace a focused chat', () => {
    const focused = { ownerId: 'tab', prompts: ['t'], send: vi.fn() };
    const home = { ownerId: 'home', prompts: ['h'], send: vi.fn() };
    releases.push(publishFocusedChatSuggestions(focused));
    releases.push(publishFocusedChatSuggestions(home, { fallback: true }));
    expect(getFocusedChatSuggestions()).toBe(focused);
  });

  it('skips a fallback chat that is currently unavailable', () => {
    let available = false;
    const home = { ownerId: 'home', prompts: ['h'], send: vi.fn(), available: () => available };
    releases.push(publishFocusedChatSuggestions(home, { fallback: true }));
    expect(getFocusedChatSuggestions()).toBeNull();
    available = true;
    expect(getFocusedChatSuggestions()).toBe(home);
  });
});

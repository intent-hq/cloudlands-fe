/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    keysWithPrefix: (prefix: string) => [...storage.keys()].filter((key) => key.startsWith(prefix)),
    getJSON: (key: string) => {
      const value = storage.get(key);
      return value === undefined ? undefined : JSON.parse(value);
    },
    setJSON: (key: string, value: unknown) => storage.set(key, JSON.stringify(value)),
  },
}));

import {
  clearProposalDraft,
  loadProposalDraft,
  saveProposalDraft,
  type ProposalCardDraft,
} from './proposal-draft-storage';

describe('proposal draft storage migration', () => {
  beforeEach(() => storage.clear());

  it('moves a valid legacy tray draft to the inline proposal namespace', () => {
    const proposalId = 'toolu/legacy';
    const legacyKey = `chat.proposalTray/agent-a/draft/${encodeURIComponent(proposalId)}`;
    const currentKey = `chat.proposalDraft/agent-a/draft/${encodeURIComponent(proposalId)}`;
    const draft: ProposalCardDraft = {
      fieldValues: { title: 'Keep my edit' },
      selectedBulkItemIds: ['workspace-a'],
    };
    const stored = JSON.stringify({ version: 1, savedAt: Date.now(), value: draft });
    storage.set(legacyKey, stored);

    expect(loadProposalDraft('agent-a', proposalId)).toEqual(draft);
    expect(storage.get(currentKey)).toBe(stored);
    expect(storage.has(legacyKey)).toBe(false);
  });

  it('clears both current and legacy draft keys', () => {
    const suffix = 'agent-a/draft/toolu-clear';
    storage.set(`chat.proposalDraft/${suffix}`, 'current');
    storage.set(`chat.proposalTray/${suffix}`, 'legacy');

    clearProposalDraft('agent-a', 'toolu-clear');

    expect(storage.has(`chat.proposalDraft/${suffix}`)).toBe(false);
    expect(storage.has(`chat.proposalTray/${suffix}`)).toBe(false);
  });

  it('removes all legacy tray records when saving a draft', () => {
    storage.set('chat.proposalTray/agent-a/collapsed', 'true');
    storage.set('chat.proposalTray/agent-a/position', '2');
    storage.set('chat.proposalTray/agent-a/draft/old', 'fresh-but-unused');
    storage.set('unrelated/key', 'keep');

    saveProposalDraft('agent-a', 'toolu-new', {
      fieldValues: {},
      selectedBulkItemIds: [],
    });

    expect([...storage.keys()].some((key) => key.startsWith('chat.proposalTray/'))).toBe(false);
    expect(storage.get('unrelated/key')).toBe('keep');
  });
});

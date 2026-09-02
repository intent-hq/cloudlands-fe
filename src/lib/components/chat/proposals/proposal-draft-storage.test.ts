/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    keysWithPrefix: (prefix: string) => [...storage.keys()].filter((key) => key.startsWith(prefix)),
  },
}));

import { loadProposalDraft, type ProposalCardDraft } from './proposal-draft-storage';

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
});

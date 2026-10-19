import { describe, expect, it } from 'vitest';

import {
  MAX_REMEMBERED_AGENT_REPOS,
  mergeAgentByRepo,
  readAgentByRepo,
  rememberAgentForRepo,
} from './agent-by-repo';

const opus = { selectedModel: 'opus', selectedReasoningEffort: 'high' };
const sonnet = { selectedModel: 'sonnet' };

describe('rememberAgentForRepo', () => {
  it('replaces the entry for a repo and moves it to the most recent position', () => {
    const map = rememberAgentForRepo({ 'local:/a': opus, 'local:/b': sonnet }, 'local:/a', sonnet);
    expect(Object.entries(map)).toEqual([
      ['local:/b', sonnet],
      ['local:/a', sonnet],
    ]);
  });

  it('drops the least recently created repos beyond the cap', () => {
    let map = {};
    for (let i = 0; i <= MAX_REMEMBERED_AGENT_REPOS; i++) {
      map = rememberAgentForRepo(map, `local:/repo-${i}`, opus);
    }
    const keys = Object.keys(map);
    expect(keys).toHaveLength(MAX_REMEMBERED_AGENT_REPOS);
    expect(keys).not.toContain('local:/repo-0');
    expect(keys.at(-1)).toBe(`local:/repo-${MAX_REMEMBERED_AGENT_REPOS}`);
  });
});

describe('mergeAgentByRepo', () => {
  it('lets in-session entries win over persisted ones and ranks them newest', () => {
    const merged = mergeAgentByRepo({ 'local:/a': opus, 'local:/b': opus }, { 'local:/a': sonnet });
    expect(Object.entries(merged)).toEqual([
      ['local:/b', opus],
      ['local:/a', sonnet],
    ]);
  });
});

describe('readAgentByRepo', () => {
  it('drops malformed entries and non-object payloads', () => {
    expect(readAgentByRepo(null)).toBeUndefined();
    expect(readAgentByRepo(['local:/a'])).toBeUndefined();
    expect(
      readAgentByRepo({ 'local:/a': opus, 'local:/b': 'opus', 'local:/c': null, '': opus }),
    ).toEqual({ 'local:/a': opus });
  });
});

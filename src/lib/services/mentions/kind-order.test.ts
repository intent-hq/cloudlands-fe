import { describe, expect, it } from 'vitest';
import { capPerKind, MENTION_KIND_ORDER, sortByKindThenScore } from './kind-order';
import type { MentionCandidate, MentionType } from './types';

const candidate = (type: MentionType, id: string, score?: number): MentionCandidate => ({
  id,
  label: id,
  type,
  uri: `${type}:${id}`,
  score,
});

describe('sortByKindThenScore', () => {
  it('orders the chat @ menu as people, notes, agents, files, folders, scripts, terminals, specialists', () => {
    const shuffled = [
      candidate('specialist', 'developer', 0.8),
      candidate('terminal', 'shell'),
      candidate('script', 'build'),
      candidate('folder', 'src'),
      candidate('file', 'README.md', 0.5),
      candidate('agent', 'helper', 0.7),
      candidate('note', 'spec'),
      candidate('member', 'octocat', 0.8),
    ];

    expect(sortByKindThenScore(shuffled, MENTION_KIND_ORDER).map((c) => c.type)).toEqual([
      'member',
      'note',
      'agent',
      'file',
      'folder',
      'script',
      'terminal',
      'specialist',
    ]);
  });

  it('ranks by descending score within a kind and keeps ties in input order', () => {
    const files = [
      candidate('file', 'low', 0.2),
      candidate('file', 'tie-a', 0.5),
      candidate('file', 'high', 0.9),
      candidate('file', 'tie-b', 0.5),
    ];

    expect(sortByKindThenScore(files, MENTION_KIND_ORDER).map((c) => c.id)).toEqual([
      'high',
      'tie-a',
      'tie-b',
      'low',
    ]);
  });

  it('places unlisted kinds after terminals and before specialists', () => {
    const sorted = sortByKindThenScore(
      [
        candidate('specialist', 'developer', 1),
        candidate('rule', 'style', 1),
        candidate('terminal', 'shell', 0),
      ],
      MENTION_KIND_ORDER,
    );

    expect(sorted.map((c) => c.type)).toEqual(['terminal', 'rule', 'specialist']);
  });

  it('sorts by score alone when no kind order is given', () => {
    const sorted = sortByKindThenScore(
      [candidate('note', 'spec', 0.1), candidate('specialist', 'developer', 0.8)],
      [],
    );

    expect(sorted.map((c) => c.type)).toEqual(['specialist', 'note']);
  });
});

describe('capPerKind', () => {
  it('keeps the first N of each kind in order', () => {
    const capped = capPerKind(
      [
        candidate('note', 'n1'),
        candidate('note', 'n2'),
        candidate('note', 'n3'),
        candidate('file', 'f1'),
        candidate('file', 'f2'),
      ],
      2,
    );

    expect(capped.map((c) => c.id)).toEqual(['n1', 'n2', 'f1', 'f2']);
  });
});

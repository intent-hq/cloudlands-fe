import { describe, expect, it } from 'vitest';
import { buildMentionSections } from './sections';
import type { MentionCandidate, MentionGroup, MentionType } from './types';

const candidate = (type: MentionType, id: string, group?: string): MentionCandidate => ({
  id,
  label: id,
  type,
  uri: `${type}:${id}`,
  group,
});

describe('buildMentionSections', () => {
  it('makes one labelled section per kind, in first-appearance order', () => {
    const sections = buildMentionSections([
      candidate('member', 'octocat'),
      candidate('note', 'spec'),
      candidate('agent', 'helper', 'Agents'),
      candidate('file', 'a.ts', 'Recent Files'),
      candidate('folder', 'src'),
      candidate('script', 'build'),
      candidate('terminal', 'shell'),
      candidate('rule', 'style'),
      candidate('specialist', 'developer', 'Specialists'),
    ]);

    expect(sections.map((s) => s.key)).toEqual([
      'member',
      'note',
      'agent',
      'file',
      'folder',
      'script',
      'terminal',
      'other',
      'specialist',
    ]);
    const labels = sections.map((s) => s.label);
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps one Files section with its recent, relevant and other sub-order', () => {
    const sections = buildMentionSections([
      candidate('file', 'recent', 'Recent Files'),
      candidate('file', 'relevant', 'Most Relevant'),
      candidate('file', 'other', 'Other Files'),
      candidate('file', 'recent-2', 'Recent Files'),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].items.map((i) => (i as MentionCandidate).id)).toEqual([
      'recent',
      'recent-2',
      'relevant',
      'other',
    ]);
  });

  it('keeps each kind contiguous even when the input interleaves kinds', () => {
    const sections = buildMentionSections([
      candidate('note', 'n1'),
      candidate('file', 'f1'),
      candidate('note', 'n2'),
    ]);

    expect(sections.map((s) => s.items.map((i) => (i as MentionCandidate).id))).toEqual([
      ['n1', 'n2'],
      ['f1'],
    ]);
  });

  it('places drill-in groups in an Other section', () => {
    const group: MentionGroup = { id: 'files', label: 'Files', items: [] };
    const sections = buildMentionSections([candidate('note', 'n1'), group]);

    expect(sections.map((s) => s.key)).toEqual(['note', 'other']);
    expect(sections[1].items).toEqual([group]);
  });

  it('gives sections stable, distinct keys', () => {
    const sections = buildMentionSections([
      candidate('rule', 'r'),
      candidate('task', 't'),
      candidate('note', 'n'),
    ]);

    expect(new Set(sections.map((s) => s.key)).size).toBe(sections.length);
  });
});

/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import {
  projectStandaloneReasoningTitles,
  extractStandaloneReasoningTitles,
} from '../reasoning-heading';

describe('reasoning row projection', () => {
  it('projects one source fragment per emitted title without creating DOM', () => {
    const create = vi.spyOn(document, 'createElement');
    const source = '## A &amp; `B`\n\n**C \\* D**\n\nLast\n---';
    const fragments = projectStandaloneReasoningTitles(source);
    expect(fragments).toHaveLength(3);
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
    expect(fragments?.flatMap((fragment) => extractStandaloneReasoningTitles(fragment)!)).toEqual(
      extractStandaloneReasoningTitles(source),
    );
  });
  it('keeps body disclosures whole and rejects indented code as titles', () => {
    expect(projectStandaloneReasoningTitles('## A\n\nBody.')).toBeNull();
    expect(projectStandaloneReasoningTitles('    ## code')).toBeNull();
  });
});

import { projectWindowItems } from '../operational-window-items';
import type { ContentBlockGroup } from '$lib/utils/messageParser';

describe('canonical renderer rows', () => {
  it('keeps tools stable through updates and regrouping without heading DOM', () => {
    const create = vi.spyOn(document, 'createElement');
    const tool = { type: 'tool_use' as const, id: 'tool-1', name: 'inspect', input: {} };
    const group: ContentBlockGroup = {
      type: 'content_group',
      name: 'Work',
      children: [tool],
      isStreaming: false,
    };
    const standalone = projectWindowItems([tool], 'message', () => true);
    const grouped = projectWindowItems([tool], 'message', () => true, group, 1);
    expect(grouped[0].key).toBe(standalone[0].key);
    expect(grouped[0].mountPath).not.toBe(standalone[0].mountPath);
    expect(projectWindowItems([{ ...tool, name: 'updated' }], 'message', () => true)[0].key).toBe(
      standalone[0].key,
    );
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });

  it('keeps a tag-first group header stable as its name and children arrive', () => {
    const empty: ContentBlockGroup = {
      type: 'content_group',
      name: '',
      isStreaming: true,
      children: [],
    };
    const filled: ContentBlockGroup = {
      ...empty,
      name: 'Review',
      children: [{ type: 'text', id: 'description', text: 'Description' }],
    };
    expect(projectWindowItems([empty], 'message', () => true)[0].key).toBe(
      projectWindowItems([filled], 'message', () => true)[0].key,
    );
  });

  it('distinguishes idless groups and children and repeated provider identities', () => {
    const groups: ContentBlockGroup[] = ['First', 'Second'].map((name) => ({
      type: 'content_group',
      name,
      isStreaming: false,
      children: [
        { type: 'text', text: 'Description' },
        { type: 'thinking', text: '## Thought' },
      ],
    }));
    const parents = projectWindowItems(groups, 'message', () => true);
    expect(new Set(parents.map((x) => x.key)).size).toBe(2);
    const children = groups.flatMap((group, index) =>
      projectWindowItems(group.children, 'message', () => true, group, index),
    );
    expect(new Set(children.map((x) => x.key)).size).toBe(4);
    expect(new Set([...parents, ...children].map((x) => x.key)).size).toBe(6);
    const repeated = projectWindowItems(
      [
        { type: 'thinking', id: 'same', text: '## One' },
        { type: 'thinking', id: 'same', text: '## Two' },
      ],
      'message',
      () => true,
    );
    expect(new Set(repeated.map((x) => x.key)).size).toBe(2);
  });
});

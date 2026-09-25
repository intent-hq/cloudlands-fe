/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { AgentMessage, ContentBlock } from '$shared/types';
import type { ContentBlockGroup } from '$lib/utils/messageParser';
import {
  getResponseGroupCurrentChildIndex,
  isTerminalResponseGroup,
  normalizeResponseGroups,
} from '../response-group-blocks';
import { findChatSearchMatches } from '../chat-search';
import { requestSearchDisclosure } from '../chat-search-disclosure';
import MessageContent from '../MessageContent.svelte';
import StreamingMessageContent from '../StreamingMessageContent.svelte';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MarkdownViewerStub.svelte')).default,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ theme: { name: 'light' } }),
    dispatch: vi.fn(),
  });
});

const thinking = (text: string): ContentBlock => ({ type: 'thinking', text });
const text = (value: string): ContentBlock => ({ type: 'text', text: value });
const tool: ContentBlock = {
  type: 'tool_use',
  id: 'call-1',
  name: 'view',
  input: { path: 'one.ts' },
};
const group = (children: ContentBlock[], isStreaming = false): ContentBlockGroup => ({
  type: 'content_group',
  name: 'Prepping',
  children,
  isStreaming,
});
const message = (contentBlocks: ContentBlock[], isStreaming = false): AgentMessage =>
  ({ id: 'message', role: 'assistant', contentBlocks, isStreaming }) as AgentMessage;
afterEach(cleanup);

describe('reasoning render model', () => {
  it.each([false, true])(
    'collects contiguous history and preserves descriptions and external titles (live=%s)',
    (live) => {
      const blocks = [
        thinking('Earlier body.'),
        thinking('  '),
        thinking('Prior phase\n\n**External phase**'),
        group([text('Description.'), thinking('Internal phase\n\nInternal body.'), tool], live),
      ];
      const [normalized] = normalizeResponseGroups(blocks, live) as ContentBlockGroup[];
      expect(normalized.name).toBe('External phase');
      expect(normalized.hasDescription).toBe(true);
      expect(normalized.adjacentReasoningHistoryCount).toBe(2);
      expect(normalized.children.map((child) => child.text ?? child.type)).toEqual([
        'Description.',
        'Earlier body.',
        'Prior phase',
        'Internal phase\n\nInternal body.',
        'tool_use',
      ]);
      expect(getResponseGroupCurrentChildIndex(normalized)).toBe(4);
      expect(blocks[0]).toEqual(thinking('Earlier body.'));
    },
  );

  it('does not reach across final prose and supports description-less groups', () => {
    const result = normalizeResponseGroups([
      thinking('Older.'),
      text('Final prose.'),
      thinking('History.'),
      group([tool]),
    ]);
    expect(result.slice(0, 2)).toEqual([thinking('Older.'), text('Final prose.')]);
    expect(result[2]).toMatchObject({
      hasDescription: false,
      adjacentReasoningHistoryCount: 1,
      children: [thinking('History.'), tool],
    });
  });

  it('recomputes split metadata instead of skipping the first later child', () => {
    const proposal = {
      type: 'proposal',
      proposal: {
        kind: 'workspace-create',
        applyToolCallId: 'proposal',
        payload: { operation: 'workspace.create', params: { title: 'new' } },
        preview: { title: 'new' },
      },
    } as ContentBlock;
    const result = normalizeResponseGroups(
      [thinking('History.'), group([text('Description.'), proposal, tool], true)],
      true,
    );
    expect(result[0]).toMatchObject({ hasDescription: true, adjacentReasoningHistoryCount: 1 });
    expect(result[1]).toBe(proposal);
    const tail = result[2] as ContentBlockGroup;
    expect(tail).toMatchObject({
      hasDescription: false,
      hasAdjacentReasoningHistory: false,
      adjacentReasoningHistoryCount: 0,
      children: [tool],
    });
    expect(getResponseGroupCurrentChildIndex(tail)).toBe(0);
  });

  it('does not invent current children for empty or title-only history', () => {
    const empty = normalizeResponseGroups([thinking(' '), group([])])[0] as ContentBlockGroup;
    expect(empty.adjacentReasoningHistoryCount).toBe(0);
    expect(getResponseGroupCurrentChildIndex(empty)).toBe(-1);
    const titles = normalizeResponseGroups([
      thinking('Prior\n\n**Current title**'),
      group([]),
    ])[0] as ContentBlockGroup;
    expect(titles.children).toEqual([thinking('Prior')]);
    expect(getResponseGroupCurrentChildIndex(titles)).toBe(-1);
  });

  it.each([false, true])(
    'keeps compact standalone titles outside headingless prose (live=%s)',
    (live) => {
      const titles = [thinking('## Earlier title'), thinking('## Latest title')];
      const normalized = normalizeResponseGroups([...titles, group([text('Prose.')], live)], live);
      expect(normalized.slice(0, 2)).toEqual(titles);
      expect(normalized[2]).toMatchObject({ name: '', children: [text('Prose.')] });
      expect(getResponseGroupCurrentChildIndex(normalized[2] as ContentBlockGroup)).toBe(0);
    },
  );

  it('classifies terminal groups by semantic trailing content', () => {
    const first = group([tool]);
    expect(
      isTerminalResponseGroup(
        [
          first,
          text(' '),
          text('<!-- suggested-prompts\nTry this\n-->'),
          { type: 'tool_result', tool_use_id: 'call-1', output: 'hidden' },
        ],
        0,
      ),
    ).toBe(true);
    for (const blocker of [
      text('Final answer.'),
      group([]),
      thinking('Later reasoning.'),
      tool,
      { type: 'resource', resource: { uri: 'nav-link', text: 'Destination' } } as ContentBlock,
      { type: 'plan', entries: [] } as ContentBlock,
    ]) {
      expect(isTerminalResponseGroup([first, blocker], 0)).toBe(false);
    }
    expect(
      isTerminalResponseGroup(
        [first, { type: 'tool_result', tool_use_id: 'orphan', output: 'visible' }],
        0,
        () => true,
      ),
    ).toBe(false);
  });
});

describe.each([
  ['static', MessageContent],
  ['streaming', StreamingMessageContent],
] as const)('%s reasoning search and lifecycle', (_name, Component) => {
  const content = [
    thinking('Standalone needle\n\nStandalone needle body.'),
    text('<group:Prepping>Description.'),
    thinking('Group title\n\nFirst needle body.'),
    thinking('Later needle title\n\nLater needle body.'),
    text('</group>Final prose.'),
  ];
  it('indexes summary before body, expands only owners, restores state, and remounts history compact', async () => {
    const matches = findChatSearchMatches([message(content)], 'needle', new Map());
    expect(matches.map((match) => match.blockPath)).toEqual([
      'b:0:c:1:phase:0:summary',
      'b:0:c:1:phase:0:body',
      'b:0:c:2:phase:0:body',
      'b:0:c:3:phase:0:summary',
      'b:0:c:3:phase:0:body',
    ]);
    const view = render(Component, { props: { content, isStreaming: false } });
    const target = matches.at(-1)!;
    for (const id of target.disclosurePath) {
      const owner = view.container.querySelector(`[data-chat-search-disclosure-id="${id}"]`)!;
      expect(owner).not.toBeNull();
      requestSearchDisclosure(owner, true);
      await tick();
    }
    expect(
      view.container.querySelector(`[data-chat-search-block-path="${target.blockPath}"]`)
        ?.textContent,
    ).toContain('Later needle body.');
    expect(view.container.textContent).not.toContain('First needle body.');
    expect(view.container.textContent).toContain('Final prose.');
    for (const id of [...target.disclosurePath].reverse()) {
      requestSearchDisclosure(
        view.container.querySelector(`[data-chat-search-disclosure-id="${id}"]`)!,
        false,
      );
      await tick();
    }
    await waitFor(() =>
      expect(view.container.querySelector('[data-chat-search-expanded="true"]')).toBeNull(),
    );
    view.unmount();
    const restored = render(Component, { props: { content, isStreaming: false } });
    expect(restored.container.querySelector('[data-chat-search-expanded="true"]')).toBeNull();
    expect(restored.container.textContent).toContain('Final prose.');
  });

  it('restores standalone manual state and keeps summary matches closed', async () => {
    const standalone = [thinking('Needle title\n\nNeedle body.')];
    const matches = findChatSearchMatches([message(standalone)], 'Needle', new Map());
    expect(matches.map((match) => [match.blockPath, match.disclosurePath])).toEqual([
      ['b:0:summary', []],
      ['b:0:body', ['reasoning:b:0']],
    ]);
    const view = render(Component, { props: { content: standalone } });
    const owner = view.container.querySelector('[data-chat-search-disclosure-id="reasoning:b:0"]')!;
    requestSearchDisclosure(owner, true);
    await tick();
    requestSearchDisclosure(owner, false);
    await tick();
    expect(owner.getAttribute('data-chat-search-expanded')).toBe('false');
    await fireEvent.click(view.getByRole('button', { name: 'Needle title' }));
    requestSearchDisclosure(owner, true);
    await tick();
    requestSearchDisclosure(owner, false);
    await tick();
    expect(owner.getAttribute('data-chat-search-expanded')).toBe('true');
  });

  it('restores body search without absorbing inline prose across a hidden paired result', async () => {
    const inline = [
      tool,
      thinking('Needle title\n\nNeedle body.'),
      { type: 'tool_result', tool_use_id: 'call-1', output: 'Hidden output.' } as ContentBlock,
      text('<group:Prepping>Inline prose.</group>'),
    ];
    const view = render(Component, { props: { content: inline, isStreaming: false } });
    const matches = findChatSearchMatches([message(inline)], 'Needle', new Map());
    expect(matches.map((match) => [match.blockPath, match.disclosurePath])).toEqual([
      ['b:1:summary', []],
      ['b:1:body', ['reasoning:b:1']],
    ]);
    const owner = view.container.querySelector('[data-chat-search-disclosure-id="reasoning:b:1"]')!;
    requestSearchDisclosure(owner, true);
    await tick();
    expect(view.container.textContent).toContain('Needle body.');
    requestSearchDisclosure(owner, false);
    await tick();
    expect(owner.getAttribute('data-chat-search-expanded')).toBe('false');
    expect(view.container.textContent).not.toContain('Needle body.');
    expect(view.container.textContent).not.toContain('Hidden output.');
    expect(view.queryByTestId('response-group-disclosure')).toBeNull();
    expect(view.container.textContent?.match(/Inline prose\./g)).toHaveLength(1);
  });

  it('targets every compact title without a body disclosure, including after remount', async () => {
    const titles = [
      thinking('## Inspecting needle_file.ts\n\n**Checking needle_flag**'),
      text('Final prose.'),
    ];
    const matches = findChatSearchMatches([message(titles)], 'needle', new Map());
    expect(matches.map((match) => [match.blockPath, match.disclosurePath])).toEqual([
      ['b:0:title:0:summary', []],
      ['b:0:title:1:summary', []],
    ]);
    let view = render(Component, { props: { content: titles, isStreaming: true } });
    const assertTargets = () => {
      expect(
        matches.map((match) =>
          view.container
            .querySelector(`[data-chat-search-block-path="${match.blockPath}"]`)
            ?.textContent?.trim(),
        ),
      ).toEqual(['Inspecting needle_file.ts', 'Checking needle_flag']);
      expect(view.container.querySelector('[data-chat-search-disclosure-id]')).toBeNull();
      expect(view.queryByRole('button')).toBeNull();
    };
    assertTargets();
    await view.rerender({ content: titles, isStreaming: false });
    assertTargets();
    view.unmount();
    view = render(Component, { props: { content: titles, isStreaming: false } });
    assertTargets();
  });

  it('retargets compact titles when a real body arrives and restores the completed disclosure', async () => {
    const initial = [thinking('## Inspecting needle_file.ts\n\n**Checking needle_flag**')];
    const view = render(Component, { props: { content: initial, isStreaming: true } });
    expect(view.queryByRole('button')).toBeNull();
    const grown = [thinking(`${initial[0].text}\n\nNeedle body.`)];
    await view.rerender({ content: grown, isStreaming: false });
    const matches = findChatSearchMatches([message(grown)], 'needle', new Map());
    expect(matches.map((match) => [match.blockPath, match.disclosurePath])).toEqual([
      ['b:0:summary', []],
      ['b:0:body', ['reasoning:b:0']],
      ['b:0:body', ['reasoning:b:0']],
    ]);
    const summary = view.container.querySelector('[data-chat-search-block-path="b:0:summary"]');
    expect(summary?.textContent?.trim()).toBe('Inspecting needle_file.ts');
    const owner = view.container.querySelector('[data-chat-search-disclosure-id="reasoning:b:0"]')!;
    expect(owner.getAttribute('data-chat-search-expanded')).toBe('false');
    requestSearchDisclosure(owner, true);
    await tick();
    expect(
      view.container.querySelector('[data-chat-search-block-path="b:0:body"]')?.textContent,
    ).toContain('Needle body.');
    requestSearchDisclosure(owner, false);
    await tick();
    expect(owner.getAttribute('data-chat-search-expanded')).toBe('false');
    expect(view.container.textContent).not.toContain('Needle body.');
  });

  it('replaces the collapsed live tool instead of retaining old children or hidden results', async () => {
    const live = [text('<group:Working>Old description.'), tool];
    const view = render(Component, { props: { content: live, isStreaming: true } });
    expect(view.container.querySelectorAll('[data-response-group-child]')).toHaveLength(1);
    expect(view.container.querySelector('[data-tool-use-id="call-1"]')).not.toBeNull();
    const next = [
      ...live,
      { type: 'tool_result', tool_use_id: 'call-1', output: 'Old hidden output.' } as ContentBlock,
      { ...tool, id: 'call-2', input: { path: 'two.ts' } },
    ];
    await view.rerender({ content: next, isStreaming: true });
    expect(view.container.querySelector('[data-tool-use-id="call-1"]')).toBeNull();
    expect(view.container.querySelector('[data-tool-use-id="call-2"]')).not.toBeNull();
    expect(view.container.textContent).not.toContain('Old hidden output.');
    await fireEvent.click(view.getByTestId('response-group-disclosure'));
    expect(view.container.querySelector('[data-tool-use-id="call-1"]')).not.toBeNull();
    expect(view.container.querySelector('[data-tool-use-id="call-2"]')).not.toBeNull();
  });
});

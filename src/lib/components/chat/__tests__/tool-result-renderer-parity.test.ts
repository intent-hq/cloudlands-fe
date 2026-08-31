/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentMessageList from '../AgentMessageList.svelte';
import MessageContent from '../MessageContent.svelte';
import { findChatSearchMatches } from '../chat-search';
import {
  groupedObjectEnvelopeOrphanBlocks,
  groupedResultBlocks,
  headinglessGroupedOrphanBlocks,
  liveGroupedOrphanBlocks,
  liveGroupBlocks,
  objectEnvelopeOrphanBlocks,
  orphanResultBlocks,
  pairedResultBlocks,
  reconcileToolResultMessage,
  rehydrateToolResultMessage,
  resilienceBlocks,
} from './tool-result-parity-fixtures';

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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const surfaces = [
  {
    name: 'normal workspace',
    render: (content: ReturnType<typeof liveGroupBlocks>, isStreaming: boolean) => {
      const message = reconcileToolResultMessage(content);
      return render(AgentMessageList, {
        props: {
          messages: [message],
          streamingContent: message.contentBlocks,
          isStreaming,
          enableTransitions: false,
        },
      });
    },
  },
  {
    name: 'dedicated agent',
    render: (content: ReturnType<typeof liveGroupBlocks>, isStreaming: boolean) =>
      render(MessageContent, { props: { content, isStreaming, role: 'assistant' } }),
  },
] as const;

function resultRows(container: HTMLElement) {
  return container.querySelectorAll('[data-message-content-block="tool_result"]');
}

describe('tool-result production renderer parity', () => {
  it.each(surfaces)(
    'renders top-level object-envelope orphan text at its search path in $name chat',
    (surface) => {
      const message = reconcileToolResultMessage(objectEnvelopeOrphanBlocks(), true);
      const view = surface.render(message.contentBlocks ?? [], true);
      const payload = view.container.querySelector('[data-chat-search-block-path="b:0"]');

      expect(view.container.textContent?.match(/object-orphan-marker/g)).toHaveLength(1);
      expect(payload?.textContent?.trim()).toBe('object-orphan-marker');
      expect(payload?.textContent).not.toContain('Tool Result');
      expect(findChatSearchMatches([message], 'object-orphan-marker', new Map())).toEqual([
        expect.objectContaining({ blockPath: 'b:0', disclosurePath: [] }),
      ]);
      expect(
        findChatSearchMatches([message], 'unsupported-object-hidden-marker', new Map()),
      ).toEqual([]);
    },
  );

  it.each(surfaces)(
    'renders grouped object-envelope orphan text once without duplicating paired results in $name chat',
    async (surface) => {
      const message = reconcileToolResultMessage(groupedObjectEnvelopeOrphanBlocks(), true);
      const view = surface.render(message.contentBlocks ?? [], true);
      const disclosure = view.container.querySelector('[data-testid="response-group-disclosure"]');
      if (disclosure) await fireEvent.click(disclosure);
      const payload = view.container.querySelector('[data-chat-search-block-path="b:0:c:3"]');

      expect(view.container.textContent?.match(/grouped-object-orphan-marker/g)).toHaveLength(1);
      expect(payload?.textContent?.trim()).toBe('grouped-object-orphan-marker');
      expect(payload?.textContent).not.toContain('Tool Result');
      expect(resultRows(view.container)).toHaveLength(2);
      expect(findChatSearchMatches([message], 'grouped-object-orphan-marker', new Map())).toEqual([
        expect.objectContaining({ blockPath: 'b:0:c:3', disclosurePath: ['group:b:0'] }),
      ]);
      expect(findChatSearchMatches([message], 'paired-object-marker', new Map())).toEqual([]);
      expect(
        findChatSearchMatches([message], 'grouped-unsupported-hidden-marker', new Map()),
      ).toEqual([]);
    },
  );

  it.each(surfaces)(
    'renders grouped paired and orphan results once in source order in $name chat',
    async (surface) => {
      const message = rehydrateToolResultMessage(groupedResultBlocks());
      const view = surface.render(message.contentBlocks ?? [], false);
      const disclosure = view.container.querySelector('[data-testid="response-group-disclosure"]')!;

      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      await fireEvent.click(disclosure);
      for (const toolDisclosure of view.container.querySelectorAll(
        '[data-testid="tool-call-disclosure"]',
      )) {
        await fireEvent.click(toolDisclosure);
      }

      expect(view.container.textContent?.match(/grouped-first-paired-marker/g)).toHaveLength(1);
      expect(view.container.textContent).toContain('grouped-paired-error-marker');
      expect(resultRows(view.container)).toHaveLength(2);
      expect(
        Array.from(view.container.querySelectorAll('[data-response-group-child]'), (node) =>
          node.getAttribute('data-message-content-block'),
        ),
      ).toEqual(['text', 'tool_use', 'text', 'tool_result', 'tool_use', 'tool_result', 'text']);
      const text = view.container.textContent ?? '';
      expect(text.indexOf('Grouped middle marker.')).toBeLessThan(
        text.indexOf('grouped-orphan-search-marker'),
      );
      expect(text.indexOf('grouped-missing-id-orphan-marker')).toBeLessThan(
        text.indexOf('Grouped end marker.'),
      );
    },
  );

  it.each(surfaces)('renders a headingless grouped orphan inline in $name chat', (surface) => {
    const message = reconcileToolResultMessage(headinglessGroupedOrphanBlocks(), true);
    const view = surface.render(message.contentBlocks ?? [], false);

    expect(view.container.querySelector('[data-testid="response-group-disclosure"]')).toBeNull();
    expect(resultRows(view.container)).toHaveLength(1);
    expect(view.container.textContent?.match(/inline-orphan-marker/g)).toHaveLength(1);
  });

  it.each(surfaces)(
    'keeps a terminal group expanded when its newly visible child is an orphan in $name chat',
    async (surface) => {
      vi.useFakeTimers();
      const live = reconcileToolResultMessage(groupedResultBlocks().slice(0, 4));
      const complete = reconcileToolResultMessage(groupedResultBlocks(), true);
      const view = surface.render(live.contentBlocks ?? [], true);
      const disclosure = view.container.querySelector('[data-testid="response-group-disclosure"]')!;
      await fireEvent.click(disclosure);

      await view.rerender(
        surface.name === 'normal workspace'
          ? {
              messages: [complete],
              streamingContent: complete.contentBlocks,
              isStreaming: false,
              enableTransitions: false,
            }
          : { content: complete.contentBlocks ?? [], isStreaming: false, role: 'assistant' },
      );
      await vi.advanceTimersByTimeAsync(1_600);

      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    },
  );

  it.each(surfaces)(
    'renders a paired result once inside its visible call in $name chat',
    async (surface) => {
      vi.useFakeTimers();
      const live = reconcileToolResultMessage(pairedResultBlocks().slice(0, 3));
      const complete = reconcileToolResultMessage(pairedResultBlocks(), true);
      const view = surface.render(live.contentBlocks ?? [], true);
      const disclosure = view.container.querySelector('[data-testid="response-group-disclosure"]')!;
      await fireEvent.click(disclosure);

      await view.rerender(
        surface.name === 'normal workspace'
          ? {
              messages: [complete],
              streamingContent: complete.contentBlocks,
              isStreaming: true,
              enableTransitions: false,
            }
          : { content: complete.contentBlocks ?? [], isStreaming: true, role: 'assistant' },
      );
      await vi.advanceTimersByTimeAsync(800);

      await fireEvent.click(view.container.querySelector('[data-testid="tool-call-disclosure"]')!);
      expect(view.container.textContent?.match(/paired-result-marker/g)).toHaveLength(1);
      expect(resultRows(view.container)).toHaveLength(0);
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    },
  );

  it.each(surfaces)(
    'uses the 799/800 ms non-terminal transition in $name chat',
    async (surface) => {
      vi.useFakeTimers();
      const live = reconcileToolResultMessage(liveGroupBlocks());
      const complete = reconcileToolResultMessage(orphanResultBlocks(), true);
      const view = surface.render(live.contentBlocks ?? [], true);
      const disclosure = view.container.querySelector('[data-testid="response-group-disclosure"]')!;
      await fireEvent.click(disclosure);
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');

      await view.rerender(
        surface.name === 'normal workspace'
          ? {
              messages: [complete],
              streamingContent: complete.contentBlocks,
              isStreaming: true,
              enableTransitions: false,
            }
          : { content: complete.contentBlocks ?? [], isStreaming: true, role: 'assistant' },
      );
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
      await vi.advanceTimersByTimeAsync(799);
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
      await vi.advanceTimersByTimeAsync(1);
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      await vi.advanceTimersByTimeAsync(800);
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');

      const rows = resultRows(view.container);
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain('orphan-search-marker');
      expect(rows[0].className).toContain('pt-4');
    },
  );

  it.each(surfaces)(
    'rehydrates completed orphan history initially collapsed in $name chat',
    (surface) => {
      const message = reconcileToolResultMessage(orphanResultBlocks(), true);
      const view = surface.render(message.contentBlocks ?? [], false);
      expect(
        view.container
          .querySelector('[data-testid="response-group-disclosure"]')
          ?.getAttribute('aria-expanded'),
      ).toBe('false');
      expect(resultRows(view.container)).toHaveLength(1);
      expect(view.container.textContent?.match(/orphan-search-marker/g)).toHaveLength(1);
    },
  );

  it('keeps complex visible result order and rows equal across both production surfaces', async () => {
    const message = reconcileToolResultMessage(resilienceBlocks(), true);
    const normal = surfaces[0].render(message.contentBlocks ?? [], true);
    await fireEvent.click(
      normal.container.querySelector('[data-testid="response-group-disclosure"]')!,
    );
    for (const disclosure of normal.container.querySelectorAll(
      '[data-testid="tool-call-disclosure"]',
    )) {
      await fireEvent.click(disclosure);
    }
    const normalText = normal.container.textContent ?? '';
    const normalRows = Array.from(
      normal.container.querySelectorAll('[data-message-content-block]'),
      (node) => node.getAttribute('data-message-content-block'),
    );
    cleanup();
    const dedicated = surfaces[1].render(message.contentBlocks ?? [], true);
    await fireEvent.click(
      dedicated.container.querySelector('[data-testid="response-group-disclosure"]')!,
    );
    for (const disclosure of dedicated.container.querySelectorAll(
      '[data-testid="tool-call-disclosure"]',
    )) {
      await fireEvent.click(disclosure);
    }
    const dedicatedText = dedicated.container.textContent ?? '';
    const dedicatedRows = Array.from(
      dedicated.container.querySelectorAll('[data-message-content-block]'),
      (node) => node.getAttribute('data-message-content-block'),
    );

    expect(dedicatedRows).toEqual(normalRows);
    for (const marker of ['first-paired-marker', 'second-paired-marker']) {
      const normalCount = normalText.match(new RegExp(marker, 'g'))?.length ?? 0;
      const dedicatedCount = dedicatedText.match(new RegExp(marker, 'g'))?.length ?? 0;
      expect(normalCount).toBeGreaterThan(0);
      expect(dedicatedCount).toBe(normalCount);
    }
    expect(normalText.indexOf('Trailing prose stays visible.')).toBeLessThan(
      normalText.indexOf('missing-id-orphan-marker'),
    );
    expect(dedicatedText.indexOf('missing-id-orphan-marker')).toBeLessThan(
      dedicatedText.indexOf('later-orphan-marker'),
    );
    expect(resultRows(dedicated.container)).toHaveLength(2);
  });

  it('indexes only the standalone orphan result for chat search', () => {
    const orphan = reconcileToolResultMessage(orphanResultBlocks(), true);
    const paired = reconcileToolResultMessage(pairedResultBlocks(), true);
    expect(findChatSearchMatches([orphan], 'orphan-search-marker', new Map())).toEqual([
      expect.objectContaining({ messageId: orphan.id, blockPath: 'b:1', disclosurePath: [] }),
    ]);
    expect(findChatSearchMatches([paired], 'paired-result-marker', new Map())).toHaveLength(0);

    const normal = render(AgentMessageList, {
      props: {
        messages: [orphan],
        streamingContent: orphan.contentBlocks,
        isStreaming: true,
        searchQuery: 'orphan-search-marker',
        enableTransitions: false,
      },
    });
    expect(resultRows(normal.container)).toHaveLength(1);
  });

  it('indexes grouped orphans at their child paths without indexing paired results twice', () => {
    const titled = reconcileToolResultMessage(groupedResultBlocks(), true);
    const inline = reconcileToolResultMessage(headinglessGroupedOrphanBlocks(), true);

    expect(findChatSearchMatches([titled], 'grouped-orphan-search-marker', new Map())).toEqual([
      expect.objectContaining({ blockPath: 'b:0:c:4', disclosurePath: ['group:b:0'] }),
    ]);
    expect(findChatSearchMatches([titled], 'grouped-missing-id-orphan-marker', new Map())).toEqual([
      expect.objectContaining({ blockPath: 'b:0:c:7', disclosurePath: ['group:b:0'] }),
    ]);
    expect(findChatSearchMatches([titled], 'grouped-first-paired-marker', new Map())).toHaveLength(
      0,
    );
    expect(findChatSearchMatches([inline], 'inline-orphan-marker', new Map())).toEqual([
      expect.objectContaining({ blockPath: 'b:0:c:1', disclosurePath: [] }),
    ]);
  });

  it('indexes a live grouped orphan through its disclosure without replacing preview search', () => {
    const message = reconcileToolResultMessage(liveGroupedOrphanBlocks());

    expect(findChatSearchMatches([message], 'Current visible live child', new Map())).toEqual([
      expect.objectContaining({ blockPath: 'b:0:c:1', disclosurePath: [] }),
    ]);
    expect(findChatSearchMatches([message], 'live-grouped-orphan', new Map())).toEqual([
      expect.objectContaining({ blockPath: 'b:0:c:2', disclosurePath: ['group:b:0'] }),
    ]);
  });
});

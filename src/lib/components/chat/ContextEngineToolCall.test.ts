import { fireEvent, render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import type { ContentBlock, ToolUseBlock } from '$shared/types';
import ContextEngineToolCall from './ContextEngineToolCall.svelte';
import MessageContent from './MessageContent.svelte';

vi.mock(
  '$store/renderer/slices/user-preferences/user-preferences-selectors',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('$store/renderer/slices/user-preferences/user-preferences-selectors')
    >()),
    selectShowReasoningBlocks: () => readable(true),
  }),
);

const toolUse = {
  type: 'tool_use',
  id: 'tool-context-engine',
  name: 'codebase-retrieval',
  input: { information_request: 'Where is panel drag-and-drop visual feedback implemented?' },
} as ToolUseBlock;

describe('ContextEngineToolCall', () => {
  it('renders a standard compact tool row while running', () => {
    render(ContextEngineToolCall, { props: { toolUse, toolState: 'running' } });

    expect(screen.getByText('Search codebase')).toBeTruthy();
    const query = screen.getByTestId('context-engine-query');
    expect(query.textContent).toContain(
      'Where is panel drag-and-drop visual feedback implemented?',
    );

    const card = screen.getByTestId('context-engine-tool-call');
    expect(card.classList.contains('tool-call-container')).toBe(true);
    expect(card.classList.contains('border-l')).toBe(false);
    expect(card.classList.contains('bg-primary/5')).toBe(false);
    expect(card.classList.contains('text-primary')).toBe(false);
    expect(screen.queryByTestId('context-engine-brand')).toBeNull();
    expect(query.classList.contains('truncate')).toBe(true);
  });

  it('keeps results and branding hidden while collapsed', () => {
    render(ContextEngineToolCall, {
      props: {
        toolUse,
        result: {
          output: [
            'The following code sections were retrieved:',
            'Path: src/lib/components/chat/ChatPanel.svelte',
            '  1520 | function groupIntoTurns() {',
            'Path: src/lib/components/chat/ChatMessage.svelte',
            '  88 | const message = selectMessage();',
          ].join('\n'),
        },
      },
    });

    expect(screen.queryByTestId('context-engine-result-icons')).toBeNull();
    expect(screen.queryByTestId('context-engine-brand')).toBeNull();
    expect(screen.queryByText('ChatPanel.svelte')).toBeNull();
    expect(screen.queryByText('ChatMessage.svelte')).toBeNull();
    expect(screen.queryByText('1520 | function groupIntoTurns() {')).toBeNull();
    expect(screen.queryByText(/Search: Where is panel drag-and-drop/)).toBeNull();
  });

  it('retains Context Engine branding in expanded details', async () => {
    render(ContextEngineToolCall, {
      props: {
        toolUse,
        toolState: 'error',
        result: 'Search failed',
      },
    });

    await fireEvent.click(screen.getByRole('button'));

    expect(screen.getByTestId('context-engine-brand').textContent).toContain(
      'Augment Context Engine',
    );
    expect(screen.getByText('Search failed')).toBeTruthy();
  });

  it('renders a paired daemon-shaped Context Engine result', () => {
    const content: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'msg-1:0',
        toolCallId: 'call-context-1',
        name: 'codebase-retrieval',
        input: { information_request: 'Find groupIntoTurns' },
        metadata: { toolKind: 'read', status: 'completed' },
      },
      {
        type: 'tool_result',
        id: 'msg-1:1',
        tool_use_id: 'call-context-1',
        output: {
          output:
            'The following code sections were retrieved:\nPath: src/lib/components/chat/ChatPanel.svelte\n  1520 | function groupIntoTurns() {',
        },
        is_error: false,
      },
    ];

    render(MessageContent, { props: { content } });

    expect(screen.getByTestId('context-engine-tool-call')).toBeTruthy();
    expect(screen.queryByText('ChatPanel.svelte')).toBeNull();
    expect(screen.queryByText('1520 | function groupIntoTurns() {')).toBeNull();
  });
});

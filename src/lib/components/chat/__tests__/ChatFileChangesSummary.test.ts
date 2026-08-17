/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '$shared/types';

const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: dispatchMock },
}));

import ChatFileChangesSummary from '../ChatFileChangesSummary.svelte';
import {
  CHAT_OPERATIONAL_CONTAINER_CLASS,
  CHAT_OPERATIONAL_ICON_CLASS,
  CHAT_OPERATIONAL_LEADING_CLASS,
  CHAT_OPERATIONAL_ROW_CLASS,
  CHAT_OPERATIONAL_SUMMARY_CLASS,
  CHAT_OPERATIONAL_TRAILING_CLASS,
} from '../operational-disclosure-row';

function expectClasses(element: Element, contract: string) {
  const className = element.getAttribute('class') ?? '';
  for (const token of contract.split(' ')) expect(className).toContain(token);
}

afterEach(() => {
  cleanup();
  dispatchMock.mockReset();
});

describe('ChatFileChangesSummary', () => {
  it('separates file changes from response prose with a quiet follow-up surface', () => {
    const message = {
      id: 'message-surface',
      role: 'assistant',
      contentBlocks: [
        {
          type: 'tool_use',
          id: 'tool-surface',
          name: 'save_file',
          input: { path: 'src/surface.ts', content: 'export const surface = true;' },
        },
      ],
    } as AgentMessage;

    render(ChatFileChangesSummary, {
      props: { workspaceId: 'owning-workspace', message },
    });

    const surface = screen.getByTestId('file-changes-surface');
    expect(surface.className).toContain('mt-4');
    expect(surface.className).not.toContain('bg-');
    expect(surface.className).not.toContain('rounded');
    expect(surface.className).not.toContain('border');
    expectClasses(surface, CHAT_OPERATIONAL_CONTAINER_CLASS);
    const button = screen.getByRole('button', { name: /1 file changed/i });
    expectClasses(button, CHAT_OPERATIONAL_ROW_CLASS);
    expect(button.className).not.toContain('hover:bg-');
    expect(button.className).toContain('focus-visible:ring-1');
    expectClasses(
      button.querySelector('[data-operational-leading]')!,
      CHAT_OPERATIONAL_LEADING_CLASS,
    );
    expectClasses(
      button.querySelector('[data-operational-summary]')!,
      CHAT_OPERATIONAL_SUMMARY_CLASS,
    );
    expectClasses(
      button.querySelector('[data-operational-trailing]')!,
      CHAT_OPERATIONAL_TRAILING_CLASS,
    );
    const icons = button.querySelectorAll('svg');
    expectClasses(icons[0]!, CHAT_OPERATIONAL_ICON_CLASS);
    expect(icons[1]?.getAttribute('class')).toContain('h-3.5!');
  });

  it('localizes and formats plural file counts', () => {
    const message = {
      id: 'message-plural',
      role: 'assistant',
      contentBlocks: Array.from({ length: 1_234 }, (_, index) => ({
        type: 'tool_use',
        id: `tool-${index}`,
        name: 'save_file',
        input: { path: `src/file-${index}.ts`, content: `export const value${index} = true;` },
      })),
    } as AgentMessage;

    render(ChatFileChangesSummary, {
      props: { workspaceId: 'owning-workspace', message, suffix: 'in conversation so far' },
    });

    expect(
      screen.getByRole('button', { name: '1,234 files changed in conversation so far' }),
    ).toBeTruthy();
  });

  it('opens changes in the workspace that owns the conversation', async () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      contentBlocks: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'save_file',
          input: { path: 'src/example.ts', content: 'export const value = 1;' },
        },
      ],
    } as AgentMessage;

    render(ChatFileChangesSummary, {
      props: {
        workspaceId: 'owning-workspace',
        message,
        agentId: 'agent-1',
        turnNumber: 3,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: /1 file changed/i }));

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'workspaceNavigation/openWorkspaceChatChanges',
      payload: [
        'owning-workspace',
        [expect.objectContaining({ filePath: 'src/example.ts', action: 'create' })],
        '1 file changed',
        {
          messageId: 'message-1',
          isAggregate: false,
          agentId: 'agent-1',
          turnNumber: 3,
        },
      ],
    });
  });

  it('includes the source panel when opening aggregate conversation changes', async () => {
    const message = {
      id: 'message-aggregate',
      role: 'assistant',
      contentBlocks: [
        {
          type: 'tool_use',
          id: 'tool-aggregate',
          name: 'save_file',
          input: { path: 'src/aggregate.ts', content: 'export const aggregate = true;' },
        },
      ],
    } as AgentMessage;

    render(ChatFileChangesSummary, {
      props: {
        workspaceId: 'owning-workspace',
        messages: [message],
        isAggregate: true,
        agentId: 'agent-aggregate',
      },
    });

    const button = screen.getByRole('button', { name: /1 file changed/i });
    button.parentElement?.setAttribute('data-panel-id', 'conversation-panel');
    await fireEvent.click(button);

    expect(dispatchMock).toHaveBeenCalledWith({
      type: 'workspaceNavigation/openWorkspaceChatChanges',
      payload: [
        'owning-workspace',
        [expect.objectContaining({ filePath: 'src/aggregate.ts', action: 'create' })],
        '1 file changed',
        {
          messageId: undefined,
          isAggregate: true,
          agentId: 'agent-aggregate',
          turnNumber: undefined,
          sourcePanelId: 'conversation-panel',
        },
      ],
    });
  });
});

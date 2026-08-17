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
    const button = screen.getByRole('button', { name: /1 file changed/i });
    expect(button.className).toContain('gap-2');
    expect(button.className).toContain('px-1.5');
    expect(button.className).not.toContain('hover:bg-');
    expect(button.className).toContain('focus-visible:ring-1');
    const icons = button.querySelectorAll('svg');
    expect(icons[0]?.getAttribute('class')).toContain('h-4!');
    expect(icons[1]?.getAttribute('class')).toContain('h-3.5!');
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

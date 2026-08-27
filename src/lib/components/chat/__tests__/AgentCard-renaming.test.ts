/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import AgentCard from '../AgentCard.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { renameAgentSessionRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

const workspaceId = 'workspace-agent-card-rename';
let sequence = 0;
let agentId = '';

function session(): AgentSession {
  return {
    id: AgentId(agentId),
    backendSessionId: null,
    workspaceId: WorkspaceId(workspaceId),
    name: 'Original Agent',
    nameExplicitlySet: false,
    status: AgentStatus.Idle,
    messages: [],
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  } as AgentSession;
}

async function beginRename(props: Record<string, unknown> = {}) {
  const onActivate = vi.fn();
  const view = render(AgentCard, {
    props: { agentId, agentName: 'Original Agent', onclick: onActivate, ...props },
  });
  const row = view.container.querySelector<HTMLElement>('[data-agent-panel-row], button');
  expect(row).not.toBeNull();
  await fireEvent.contextMenu(row!);
  await fireEvent.click(await screen.findByText('Rename'));
  const input = await screen.findByRole('textbox', { name: 'Rename' });
  return { ...view, input: input as HTMLInputElement, onActivate };
}

describe('AgentCard rename editing', () => {
  beforeEach(() => {
    appStore.init();
    agentId = `agent-card-rename-${++sequence}`;
    appStore.dispatch(bulkUpsertSessions([session()]));
  });

  afterEach(() => {
    cleanup();
    appStore.dispatch(removeSession(agentId));
    vi.restoreAllMocks();
  });

  it.each([
    ['expanded', {}],
    ['inline', { inline: true }],
    ['panel row', { panelRow: true, hidePreview: true }],
  ])('replaces the activation button with a labelled input in %s mode', async (_, props) => {
    const { input, onActivate } = await beginRename(props);
    const editRow = input.closest('[data-agent-panel-row], [data-testid="agent-list-item"] > div');

    expect(input.closest('button')).toBeNull();
    expect(editRow?.tagName).toBe('DIV');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('isolates normal editing keys and pointer events without cancelling browser defaults', async () => {
    const { container, input, onActivate } = await beginRename({ panelRow: true });
    const escaped = vi.fn();
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'contextmenu']) {
      container.addEventListener(type, escaped);
    }

    const keys = [' ', 'a', '7', '.', 'ArrowLeft', 'Home', 'End', 'Backspace', 'Delete'];
    for (const key of keys) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    for (const [key, modifier] of [
      ['c', { metaKey: true }],
      ['x', { ctrlKey: true }],
      ['v', { metaKey: true }],
      ['z', { metaKey: true }],
      ['z', { metaKey: true, shiftKey: true }],
    ] as const) {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...modifier,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    await fireEvent.pointerDown(input);
    await fireEvent.pointerUp(input);
    await fireEvent.click(input);
    await fireEvent.contextMenu(input);

    expect(escaped).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('trims only outer whitespace and commits the exact internal-space name once', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    const { input, onActivate } = await beginRename({ panelRow: true });
    await fireEvent.input(input, { target: { value: '  Alpha  Beta  42!  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    const renameActions = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === renameAgentSessionRequested.type);
    expect(renameActions).toHaveLength(1);
    expect(renameActions[0].payload).toEqual([workspaceId, agentId, 'Alpha  Beta  42!']);
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Rename' })).toBeNull();
  });

  it('cancels on Escape and does not commit composing Enter', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    const first = await beginRename({ panelRow: true });
    await fireEvent.input(first.input, { target: { value: 'Composing name' } });
    await fireEvent.keyDown(first.input, { key: 'Enter', isComposing: true });
    expect(screen.getByRole('textbox', { name: 'Rename' })).toBe(first.input);

    await fireEvent.keyDown(first.input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Rename' })).toBeNull();
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === renameAgentSessionRequested.type),
    ).toHaveLength(0);
  });

  it('commits blur once and reverts the optimistic name when rename fails', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    const { input } = await beginRename();
    await fireEvent.input(input, { target: { value: 'Temporary Name' } });
    await fireEvent.blur(input);
    const renameAction = dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === renameAgentSessionRequested.type);
    expect(renameAction).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('agent-card-name').textContent).toBe('Temporary Name'),
    );

    appStore.dispatch(renameAction.failure(new Error('rename failed')));
    await waitFor(() =>
      expect(screen.getByTestId('agent-card-name').textContent).toBe('Original Agent'),
    );
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === renameAgentSessionRequested.type),
    ).toHaveLength(1);
  });
});

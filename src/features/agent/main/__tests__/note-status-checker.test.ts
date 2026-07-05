import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the daemon JSON-RPC seam so `agent.get` / `agent.getConversation` are
// observable without a real socket.
const request = vi.fn();
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request }),
}));

// The status checker also invokes an LLM classifier and notes-service update;
// neither is exercised by these wire-contract tests (we short-circuit on
// non-taskNoteId / cooldown paths where possible), so mock them out.
vi.mock('../background-request.service', () => ({
  makeBackgroundRequest: vi.fn(async () => ({ success: false, error: 'unused' })),
}));

// The notes-service is imported lazily inside the module.
const getNote = vi.fn();
const updateTaskStatus = vi.fn(async () => ({ ok: true }));
vi.mock('../../../notes/main/notes.service', () => ({
  notesService: { getNote, updateTaskStatus },
}));

vi.mock('../../../workspace/main/provenance/provenance-context-manager', () => ({
  getProvenanceContextManager: () => ({
    createAgentContext: vi.fn(),
    popContext: vi.fn(),
  }),
}));

import { checkAndUpdateNoteStatus } from '../note-status-checker';

// P3-1: note-status-checker reads agent metadata / conversation via the daemon
// (PROTOCOL.md §5.5 `agent.get` + `agent.getConversation`) rather than
// the retired agent-{uuid}.json store.
describe('note-status-checker wire contract', () => {
  beforeEach(() => {
    request.mockReset();
    getNote.mockReset();
    updateTaskStatus.mockReset();
  });

  it('calls agent.get with { agentId, workspaceId } and short-circuits when no taskNoteId', async () => {
    // Unique ids so the module-level cooldown map does not bleed across tests.
    const agentId = `agent-wire-${Math.random().toString(36).slice(2)}`;
    request.mockResolvedValueOnce({ agent: { name: 'A', metadata: {} } });

    await checkAndUpdateNoteStatus(agentId, 'ws-1', undefined, {
      finishReason: 'end_turn',
      lastMessageText: 'done!',
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('agent.get', {
      agentId,
      workspaceId: 'ws-1',
    });
    // No taskNoteId => notesService is never consulted.
    expect(getNote).not.toHaveBeenCalled();
  });

  it('falls back to agent.getConversation when lastMessageText is missing', async () => {
    const agentId = `agent-wire-${Math.random().toString(36).slice(2)}`;
    // 1: agent.get returns metadata with a linked task note.
    request.mockResolvedValueOnce({
      agent: {
        name: 'A',
        metadata: { taskNoteId: 'note-1' },
      },
    });
    // 2: getNote resolves an in-progress task so we do not short-circuit.
    getNote.mockResolvedValueOnce({
      ok: true,
      data: {
        content: 'task body',
        title: 'the task',
        metadata: { task: { status: 'in_progress' } },
      },
    });
    // 3: fallback message load via agent.getConversation.
    request.mockResolvedValueOnce({
      messages: [
        { role: 'user', content: 'do stuff' },
        {
          role: 'assistant',
          contentBlocks: [
            { type: 'text', text: 'I finished the stuff you asked me to do.' },
          ],
        },
      ],
    });

    await checkAndUpdateNoteStatus(agentId, 'ws-1', undefined, {
      finishReason: 'end_turn',
      // NOTE: lastMessageText intentionally omitted so we hit the fallback.
    });

    // First wire call: agent.get. Second wire call: agent.getConversation.
    expect(request.mock.calls[0]).toEqual([
      'agent.get',
      { agentId, workspaceId: 'ws-1' },
    ]);
    expect(request.mock.calls[1]).toEqual([
      'agent.getConversation',
      { agentId, workspaceId: 'ws-1' },
    ]);
  });
});

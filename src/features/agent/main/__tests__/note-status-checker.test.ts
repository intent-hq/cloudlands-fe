import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the daemon JSON-RPC seam so `agent.get` / `agent.getConversation` /
// `note.get` / `task.updateNoteStatus` are observable without a real socket.
const request = vi.fn();
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request }),
}));

// The status checker also invokes an LLM classifier; not exercised by these
// wire-contract tests (we short-circuit on non-taskNoteId / cooldown paths
// where possible), so mock it out.
vi.mock('../background-request.service', () => ({
  makeBackgroundRequest: vi.fn(async () => ({ success: false, error: 'unused' })),
}));

vi.mock('../../../workspace/main/provenance/provenance-context-manager', () => ({
  getProvenanceContextManager: () => ({
    createAgentContext: vi.fn(),
    popContext: vi.fn(),
  }),
}));

import { checkAndUpdateNoteStatus } from '../note-status-checker';

// P3-1: note-status-checker reads agent metadata / conversation via the daemon
// (PROTOCOL.md §5.5 `agent.get` + `agent.getConversation`) and now also fetches
// the linked task note via `note.get` (PROTOCOL.md §5.4) rather than the
// retired FE notes service.
describe('note-status-checker wire contract', () => {
  beforeEach(() => {
    request.mockReset();
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
    // 2: note.get resolves an in-progress task so we do not short-circuit.
    request.mockResolvedValueOnce({
      note: {
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

    // Wire calls: agent.get, note.get, agent.getConversation.
    expect(request.mock.calls[0]).toEqual([
      'agent.get',
      { agentId, workspaceId: 'ws-1' },
    ]);
    expect(request.mock.calls[1]).toEqual([
      'note.get',
      { workspaceId: 'ws-1', noteId: 'note-1' },
    ]);
    expect(request.mock.calls[2]).toEqual([
      'agent.getConversation',
      { agentId, workspaceId: 'ws-1' },
    ]);
  });
});

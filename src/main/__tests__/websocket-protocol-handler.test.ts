/**
 * WebSocket Protocol Handler Tests
 *
 * Tests JSON-RPC 2.0 message parsing, validation, and method routing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockStore,
  mockProtocolAdapter,
  mockAgentHandler,
  mockNotePeers,
  mockBuildNoteApi,
  mockAgentPeer,
  mockBuildAgentApi,
  mockGitPeer,
  mockBuildWsGitApi,
  mockPrPeer,
  mockBuildWsPrApi,
  mockScriptPeer,
  mockBuildScriptApi,
  mockBrowserPeer,
  mockBuildBrowserApi,
  mockTerminalPeer,
  mockBuildTerminalApi,
  mockEventPeer,
  mockBuildWsEventApi,
  mockCrossWorkspacePeer,
  mockBuildCrossWorkspaceApi,
  mockFilePeer,
  mockBuildFileApi,
} = vi.hoisted(() => {
  const mockStore: Record<string, any> = {};
  const mockProtocolAdapter = {
    listAllWorkspaces: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'ws-1', title: 'Test' }] }),
    getWorkspace: vi.fn().mockResolvedValue({ id: 'ws-1', title: 'Test Workspace' }),
    createWorkspace: vi.fn().mockResolvedValue({ ok: true, data: { id: 'ws-new' } }),
    updateWorkspace: vi.fn().mockResolvedValue({ ok: true, data: { id: 'ws-1' } }),
    deleteWorkspace: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
    archiveWorkspace: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
    unarchiveWorkspace: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
    listNotes: vi.fn().mockResolvedValue([{ id: 'note-1', title: 'Note 1' }]),
    getNote: vi.fn().mockResolvedValue({ id: 'note-1', title: 'Note 1', content: 'hello' }),
    createNote: vi.fn().mockResolvedValue({ id: 'note-new', title: 'New Note' }),
    updateNote: vi.fn().mockResolvedValue({ id: 'note-1', title: 'Updated' }),
  };
  // Track R, wave 2b — buildNoteApi peers (ws.note/comment/task.*) used by
  // the new JSON-RPC adapter shims. Behaviour is covered by the
  // ws-note-api / ws-task-api / ws-comment-api suites; here we only
  // assert the adapter forwards params positionally and serialises
  // the response unchanged.
  const mockNotePeers = {
    note: {
      add: vi.fn().mockResolvedValue({ ok: true, noteId: 'note-1', content: 'added' }),
      edit: vi.fn().mockResolvedValue({ ok: true, noteId: 'note-1', content: 'edited' }),
      editLines: vi.fn().mockResolvedValue({ ok: true, noteId: 'note-1', content: 'edited-lines' }),
      setContent: vi.fn().mockResolvedValue({ ok: true, noteId: 'note-1' }),
      updateMetadata: vi.fn().mockResolvedValue({ ok: true, noteId: 'note-1', title: 'New Title' }),
      delete: vi.fn().mockResolvedValue({ ok: true, noteId: 'note-1', deleted: true }),
      listTasks: vi.fn().mockResolvedValue([{ text: 'task one', status: 'todo', lineNumber: 1 }]),
      readAsset: vi.fn().mockResolvedValue({ assetId: 'asset-1', mimeType: 'image/png', data: 'BASE64', sizeKb: 12 }),
    },
    comment: {
      add: vi.fn().mockResolvedValue({ ok: true, commentId: 'c-1', threadId: 't-1' }),
      list: vi.fn().mockResolvedValue([{ threadId: 't-1', latestCommentAt: '2026-05-19T00:00:00.000Z' }]),
      getThread: vi.fn().mockResolvedValue({ threadId: 't-1', comments: [] }),
      respond: vi.fn().mockResolvedValue({ ok: true, commentId: 'c-2' }),
      delete: vi.fn().mockResolvedValue({ ok: true, commentId: 'c-1', deleted: true }),
    },
    task: {
      updateStatus: vi.fn().mockResolvedValue({ ok: true, noteId: 'note-1', status: 'done' }),
      updateNoteStatus: vi.fn().mockResolvedValue({ ok: true, noteId: 'note-1', status: 'in_progress' }),
      update: vi.fn().mockResolvedValue({ ok: true, lineNumber: 5 }),
      getMyTask: vi.fn().mockResolvedValue({ noteId: 'task-1', title: 'Sample Task' }),
      markAsTask: vi.fn().mockResolvedValue({ ok: true, noteId: 'note-1' }),
      convertBlocks: vi.fn().mockResolvedValue({ convertedCount: 2, createdNoteIds: ['n-a', 'n-b'] }),
      createPrerequisite: vi.fn().mockResolvedValue({ ok: true, prerequisiteNoteId: 'pre-1' }),
      assignAgent: vi.fn().mockResolvedValue({ ok: true, noteId: 'note-1', agentId: 'agent-1' }),
    },
    // Track R, wave 2d — primitive.* peers live inside buildNoteApi().
    primitive: {
      addReference: vi.fn().mockResolvedValue({ ok: true, primitiveId: 'prim-1', noteId: 'note-1' }),
      addCli: vi.fn().mockResolvedValue({ ok: true, primitiveId: 'prim-2', noteId: 'note-1' }),
      addPatch: vi.fn().mockResolvedValue({ ok: true, primitiveId: 'prim-3', noteId: 'note-1' }),
      addAgentAction: vi.fn().mockResolvedValue({ ok: true, primitiveId: 'prim-4', noteId: 'note-1' }),
    },
  };
  const mockBuildNoteApi = vi.fn().mockReturnValue(mockNotePeers);

  // Track R, wave 2c — peers for ws.agent.* (new), ws.git.*, ws.pr.*.
  // Behaviour is covered by the ws-agent-api / ws-git-api suites;
  // ws-pr-api behaviour coverage is deferred (no behaviour suite exists
  // yet — flagged in the PR description). Here we only assert the
  // adapter forwards params positionally and serialises the response.
  const mockAgentPeer = {
    delegate: vi.fn().mockResolvedValue({ ok: true, agentId: 'agent-d1', text: 'delegated' }),
    sendToTask: vi.fn().mockResolvedValue({ ok: true, taskNoteId: 'task-1' }),
    subscribe: vi.fn().mockResolvedValue({ ok: true, subscriptionId: 'sub-1' }),
    unsubscribe: vi.fn().mockResolvedValue({ ok: true, subscriptionId: 'sub-1' }),
    wakeOrCreate: vi.fn().mockResolvedValue({ ok: true, taskNoteId: 'task-1', agentId: 'agent-w1' }),
    summary: vi.fn().mockResolvedValue({ agentId: 'agent-1', agentName: 'Test', messageCount: 5 }),
    reportToParent: vi.fn().mockResolvedValue({ ok: true, text: 'Report saved' }),
  };
  const mockBuildAgentApi = vi.fn().mockReturnValue(mockAgentPeer);

  const mockGitPeer = {
    status: vi.fn().mockResolvedValue({ modified: ['a.ts'], staged: [], untracked: [], deleted: [] }),
    stage: vi.fn().mockResolvedValue({ ok: true, paths: ['a.ts'] }),
    commit: vi.fn().mockResolvedValue({ ok: true, hash: 'abc1234', files: ['a.ts'] }),
    agentCommit: vi.fn().mockResolvedValue({ ok: true, hash: 'def5678', files: ['a.ts'], fileCount: 1 }),
    checkMergeConflicts: vi.fn().mockResolvedValue({
      hasConflicts: false,
      conflictedFiles: [],
      targetBranch: 'main',
      currentBranch: 'feature',
    }),
  };
  const mockBuildWsGitApi = vi.fn().mockReturnValue(mockGitPeer);

  const mockPrPeer = {
    merge: vi.fn().mockResolvedValue({ merged: true, sha: 'merge-sha', mergeMethod: 'merge', message: 'merged', prNumber: 42 }),
    status: vi.fn().mockResolvedValue({
      prNumber: 42,
      title: 'Test PR',
      url: 'https://example/pr/42',
      state: 'open',
      mergeable: true,
      mergeableState: 'clean',
      hasConflicts: false,
      isDraft: false,
      isMerged: false,
      isClosed: false,
      summary: 'Mergeable',
    }),
    updateBranch: vi.fn().mockResolvedValue({ method: 'merge', alreadyUpToDate: false, message: 'updated', url: null }),
    waitForChanges: vi.fn().mockResolvedValue({ changed: true, changes: ['x'], elapsedSeconds: 1, iterations: 1, snapshot: {}, summary: 'done' }),
    listReviewComments: vi.fn().mockResolvedValue({
      threads: [],
      threadCount: 0,
      usingFallback: false,
      pagination: null,
      filter: { path: null, status: 'unresolved' },
      note: null,
    }),
    replyToReviewComment: vi.fn().mockResolvedValue({ id: 999, htmlUrl: 'https://example/reply' }),
    resolveThread: vi.fn().mockResolvedValue({ ok: true, threadId: 't-1', action: 'resolve' }),
    listComments: vi.fn().mockResolvedValue({ count: 0, comments: [] }),
    postComment: vi.fn().mockResolvedValue({ id: 1001, htmlUrl: 'https://example/comment' }),
  };
  const mockBuildWsPrApi = vi.fn().mockReturnValue(mockPrPeer);

  // Track R, wave 2d — peers for ws.script.*, ws.browser.*, ws.terminal.*,
  // ws.file.*, ws.event.*, ws.crossWorkspace.*. Behaviour is covered by
  // the ws-script-api / ws-event-api / ws-misc-api suites; here we only
  // assert the adapter forwards params positionally and serialises the
  // response unchanged.
  const mockScriptPeer = {
    list: vi.fn().mockResolvedValue([{ id: 's-1', name: 'dev' }]),
    create: vi.fn().mockResolvedValue({ id: 's-new' }),
    remove: vi.fn().mockResolvedValue({ ok: true, scriptId: 's-1' }),
    start: vi.fn().mockResolvedValue({ ok: true, scriptId: 's-1' }),
    stop: vi.fn().mockResolvedValue({ ok: true, scriptId: 's-1' }),
    restart: vi.fn().mockResolvedValue({ ok: true, scriptId: 's-1' }),
    output: vi.fn().mockResolvedValue('script output'),
    status: vi.fn().mockResolvedValue({ id: 's-1', running: true }),
    run: vi.fn().mockResolvedValue({ exitCode: 0, output: 'done' }),
  };
  const mockBuildScriptApi = vi.fn().mockReturnValue(mockScriptPeer);

  const mockBrowserPeer = {
    exec: vi.fn().mockResolvedValue({ ok: true, results: [] }),
    docs: vi.fn().mockResolvedValue('browser docs body'),
  };
  const mockBuildBrowserApi = vi.fn().mockReturnValue(mockBrowserPeer);

  const mockTerminalPeer = {
    list: vi.fn().mockResolvedValue([{ id: 't-1', title: 'bash' }]),
    readOutput: vi.fn().mockResolvedValue('terminal output'),
  };
  const mockBuildTerminalApi = vi.fn().mockReturnValue(mockTerminalPeer);

  const mockEventPeer = {
    recentFiles: vi.fn().mockResolvedValue([{ path: 'a.ts' }]),
    agentActivity: vi.fn().mockResolvedValue([{ agentId: 'a-1', activity: 'idle' }]),
    workspaceSummary: vi.fn().mockResolvedValue({ events: 0 }),
    directoryChanges: vi.fn().mockResolvedValue([{ path: 'a.ts', type: 'modified' }]),
    query: vi.fn().mockResolvedValue([{ id: 'evt-1' }]),
    subscribe: vi.fn().mockResolvedValue({ subscriptionId: 'sub-1', eventTypes: ['agent:*'] }),
    unsubscribe: vi.fn().mockResolvedValue({ ok: true, subscriptionId: 'sub-1' }),
  };
  const mockBuildWsEventApi = vi.fn().mockReturnValue(mockEventPeer);

  const mockCrossWorkspacePeer = {
    listSiblings: vi.fn().mockResolvedValue([{ id: 'ws-2', title: 'Sibling' }]),
    readNote: vi.fn().mockResolvedValue({ id: 'note-x', title: 'Cross Note', content: '' }),
    listNotes: vi.fn().mockResolvedValue([{ id: 'note-x', title: 'Cross Note' }]),
  };
  const mockBuildCrossWorkspaceApi = vi.fn().mockReturnValue(mockCrossWorkspacePeer);

  const mockFilePeer = {
    read: vi.fn().mockResolvedValue('file body'),
    write: vi.fn().mockResolvedValue({ ok: true, path: 'a.ts', size: 9 }),
    list: vi.fn().mockResolvedValue([{ name: 'a.ts', type: 'file' }]),
    delete: vi.fn().mockResolvedValue({ ok: true, path: 'a.ts', deleted: true }),
    mkdir: vi.fn().mockResolvedValue({ ok: true, path: 'dir', created: true }),
    rename: vi.fn().mockResolvedValue({ ok: true, oldPath: 'a.ts', newPath: 'b.ts' }),
  };
  const mockBuildFileApi = vi.fn().mockReturnValue(mockFilePeer);

  const mockAgentHandler = {
    listAllAgents: vi.fn().mockResolvedValue([]),
    getAgent: vi.fn().mockResolvedValue(null),
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    handleQueueMessage: vi.fn().mockResolvedValue({ success: true, queuedMessage: { id: 'q-1' } }),
    handleEditQueuedMessage: vi.fn().mockResolvedValue({ success: true }),
    handleRemoveQueuedMessage: vi.fn().mockResolvedValue({ success: true }),
    handleGetQueue: vi.fn().mockResolvedValue({ messages: [] }),
    stopAgent: vi.fn().mockResolvedValue(undefined),
    handleSetModel: vi.fn().mockResolvedValue({ success: true }),
    deleteAgent: vi.fn().mockResolvedValue(undefined),
    getActiveStreams: vi.fn().mockReturnValue([]),
    createAgent: vi.fn().mockResolvedValue({ id: 'agent-new', name: 'Test Agent' }),
  };
  return {
    mockStore,
    mockProtocolAdapter,
    mockAgentHandler,
    mockNotePeers,
    mockBuildNoteApi,
    mockAgentPeer,
    mockBuildAgentApi,
    mockGitPeer,
    mockBuildWsGitApi,
    mockPrPeer,
    mockBuildWsPrApi,
    mockScriptPeer,
    mockBuildScriptApi,
    mockBrowserPeer,
    mockBuildBrowserApi,
    mockTerminalPeer,
    mockBuildTerminalApi,
    mockEventPeer,
    mockBuildWsEventApi,
    mockCrossWorkspacePeer,
    mockBuildCrossWorkspaceApi,
    mockFilePeer,
    mockBuildFileApi,
  };
});

// Mock electron-store
vi.mock('electron-store', () => {
  return {
    __esModule: true,
    default: function MockElectronStore() {
      return {
        set: (key: string, value: any) => { mockStore[key] = value; },
        get: (key: string, defaultValue?: any) => key in mockStore ? mockStore[key] : defaultValue,
        store: mockStore,
      };
    },
  };
});

// Mock electron app
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp'), isPackaged: false },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

// Mock protocol adapter
vi.mock('../../features/protocol/main/protocol-adapter', () => ({
  protocolAdapter: mockProtocolAdapter,
}));

// Mock buildNoteApi (Track R, wave 2b — note.*/task.*/comment.* shim peers)
vi.mock('../../features/mcp/main/mcp/ws-note-api', () => ({
  buildNoteApi: mockBuildNoteApi,
}));

// Mock buildAgentApi / buildWsGitApi / buildWsPrApi (Track R, wave 2c —
// agent.* (new) + git.* + pr.* shim peers).
vi.mock('../../features/mcp/main/mcp/ws-agent-api', () => ({
  buildAgentApi: mockBuildAgentApi,
}));
vi.mock('../../features/mcp/main/mcp/ws-git-api', () => ({
  buildWsGitApi: mockBuildWsGitApi,
}));
vi.mock('../../features/mcp/main/mcp/ws-pr-api', () => ({
  buildWsPrApi: mockBuildWsPrApi,
}));

// Track R, wave 2d — script.*/browser.*/terminal.*/file.*/event.*/
// crossWorkspace.* shim peers. (primitive.* lives inside buildNoteApi.)
vi.mock('../../features/mcp/main/mcp/ws-script-api', () => ({
  buildScriptApi: mockBuildScriptApi,
}));
vi.mock('../../features/mcp/main/mcp/ws-event-api', () => ({
  buildWsEventApi: mockBuildWsEventApi,
}));
vi.mock('../../features/mcp/main/mcp/ws-misc-api', () => ({
  buildBrowserApi: mockBuildBrowserApi,
  buildTerminalApi: mockBuildTerminalApi,
  buildCrossWorkspaceApi: mockBuildCrossWorkspaceApi,
  buildFileApi: mockBuildFileApi,
}));

// Mock AgentBackendHandler
vi.mock('../../features/agent/main/agent-backend-handler.service', () => ({
  AgentBackendHandler: {
    getInstance: vi.fn().mockReturnValue(mockAgentHandler),
  },
}));

// Mock auggie.ipc for agent.getModels
vi.mock('../../features/auggie/main/auggie.ipc', () => ({
  executeAuggieCommand: vi.fn().mockResolvedValue({ stdout: 'model1 - Model One\nmodel2 - Model Two', stderr: '' }),
  parseModelListOutput: vi.fn().mockReturnValue([
    { value: 'model1', label: 'Model One' },
    { value: 'model2', label: 'Model Two' },
  ]),
}));

// Initialize real redux-store-bridge with a mock store for emitUserMessageEvent
// (vi.mock does not reliably intercept fire-and-forget dynamic imports in vitest)
import { initMainStoreBridge, _resetMainStoreBridge } from '../../store/main/redux-store-bridge';

// Mock agent-subscriptions-selectors for agent.getSubscriptions
const mockSelectAgentSubscriptions = { select: vi.fn().mockReturnValue([]) };
const mockSelectDelegationGroupsForParent = { select: vi.fn().mockReturnValue([]) };
const mockSelectWorkspaceSubscriptionState = {
  select: vi.fn().mockReturnValue({
    subscriptions: {},
    agentQueues: {},
    agentStatuses: {},
    delegationGroups: {},
    firedOneShotSubscriptions: [],
    deletedAgents: {},
    deliveryStats: {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      timeoutDeliveries: 0,
      droppedEvents: 0,
      lastDeliveryTime: null,
      lastFailureTime: null,
    },
  }),
};
vi.mock('../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors', () => ({
  selectAgentSubscriptions: mockSelectAgentSubscriptions,
  selectDelegationGroupsForParent: mockSelectDelegationGroupsForParent,
  selectWorkspaceSubscriptionState: mockSelectWorkspaceSubscriptionState,
}));

// Mock agent-subscription-ops for agent.cancelSubscriptions
const mockAgentUnsubscribeAll = vi.fn();
vi.mock('../../features/events/main/agent-subscription-ops', () => ({
  agentUnsubscribeAll: mockAgentUnsubscribeAll,
}));

// Mock specialist-file-loader for specialist.list
vi.mock('../../features/specialists/main/specialist-file-loader', () => ({
  loadBundledSpecialistFiles: vi.fn().mockResolvedValue({
    specialists: [{ id: 'bundled-1', frontmatter: { name: 'Bundled', description: 'A bundled specialist', modelTier: 'fast' } }],
  }),
  loadSpecialistFiles: vi.fn().mockResolvedValue({
    specialists: [{ id: 'user-1', frontmatter: { name: 'User', description: 'A user specialist', modelTier: 'smart' } }],
  }),
}));

// Mock repo-registry for repo.list
vi.mock('../../features/workspace/main/repo-registry', () => ({
  getAllRepos: vi.fn().mockReturnValue([{ path: '/repo', name: 'test-repo' }]),
  syncRepos: vi.fn(),
}));

// Mock git-env for git.getBranches
vi.mock('../../shared/git/git-env', () => ({
  execAsync: vi.fn().mockResolvedValue({ stdout: 'main', stderr: '' }),
}));

// Mock workspace-events-slice for emitUserMessageEvent
vi.mock('../../store/main/slices/workspace-events/workspace-events-slice', () => ({
  emitWorkspaceEvent: vi.fn().mockReturnValue({ type: 'workspaceEvents/emitWorkspaceEvent', payload: [] }),
}));

// Mock events/types for createWorkspaceEvent
vi.mock('../../features/events/types', () => ({
  createWorkspaceEvent: vi.fn().mockReturnValue({
    id: 'evt-mock',
    type: 'agent:user-message:sent',
    workspaceId: 'ws-1',
    timestamp: new Date().toISOString(),
    actor: { type: 'user', id: 'user' },
    data: {},
  }),
  WorkspaceEventType: {
    AgentRenamed: 'agent:renamed',
    AgentUserMessageSent: 'agent:user-message:sent',
  },
}));

// Mock config and constants for agent.rename
vi.mock('../../shared/main/config', () => ({
  WorkspaceConfig: {
    resolveWorkspaceRoot: vi.fn().mockReturnValue('/tmp/workspaces'),
    paths: { workspace: vi.fn().mockReturnValue('/tmp/workspaces/ws-1') },
  },
}));

vi.mock('../../shared/constants', () => ({
  getSessionPath: vi.fn().mockReturnValue('/tmp/session.json'),
  LIMITS: { MAX_WEBSOCKET_CONVERSATION_MESSAGES: 100 },
}));

// Mock fs/promises for agent.rename
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(JSON.stringify({ version: 1, data: { name: 'Old Name' } })),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock the shared rename helper — agent.rename now delegates to it.
vi.mock('../../features/agent/main/agent-rename', () => ({
  renameAgentOnDisk: vi.fn(async (opts: { name: string }) => ({ ok: true, name: opts.name })),
}));

// Mock system.ipc for agent.rename
vi.mock('../../features/system/main/system.ipc', () => ({
  sendToWorkspaceWindows: vi.fn(),
}));

// Mock specialists.service for agent.create
vi.mock('../../features/agent/main/specialists.service', () => ({
  resolveSpecialistForAgent: vi.fn().mockReturnValue(null),
}));

// Mock agent-name-generator for agent.create
vi.mock('../../shared/utils/agent-name-generator', () => ({
  generateRandomAgentName: vi.fn().mockReturnValue('Random Agent'),
}));

// Mock agent-persistence for agent.getConversation
vi.mock('../../features/agent/main/agent-persistence', () => ({
  agentPersistence: {
    loadAgent: vi.fn().mockResolvedValue({ success: false }),
  },
}));

import { handleWebSocketMessage, getSupportedMethods } from '../websocket-protocol-handler';

function makeRequest(method: string, params?: any, id?: string | number | null): string {
  const msg: any = { jsonrpc: '2.0', method };
  if (params !== undefined) msg.params = params;
  if (id !== undefined) msg.id = id;
  return JSON.stringify(msg);
}

describe('WebSocket Protocol Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStore).forEach((key) => delete mockStore[key]);

    // Initialize the real redux-store-bridge with a mock store so that fire-and-forget
    // dynamic imports in emitUserMessageEvent() find an initialized bridge instead of throwing.
    _resetMainStoreBridge();
    initMainStoreBridge({ getState: () => ({}) as any, dispatch: vi.fn(), subscribe: vi.fn(), replaceReducer: vi.fn() } as any);
  });

  describe('getSupportedMethods()', () => {
    it('returns expected method list', () => {
      const methods = getSupportedMethods();
      expect(methods).toContain('workspace.list');
      expect(methods).toContain('workspace.get');
      expect(methods).toContain('note.list');
      expect(methods).toContain('note.get');
      expect(methods).toContain('note.create');
      expect(methods).toContain('note.update');
      expect(methods).toContain('agent.list');
      expect(methods).toContain('agent.get');
    });
  });

  describe('Parse errors', () => {
    it('returns -32700 for invalid JSON', async () => {
      const result = await handleWebSocketMessage('not valid json');
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32700);
      expect(parsed.id).toBeNull();
    });
  });

  describe('Invalid requests', () => {
    it('returns -32600 when jsonrpc is not "2.0"', async () => {
      const result = await handleWebSocketMessage(JSON.stringify({ jsonrpc: '1.0', method: 'test', id: 1 }));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32600);
    });

    it('returns -32600 when method is missing', async () => {
      const result = await handleWebSocketMessage(JSON.stringify({ jsonrpc: '2.0', id: 1 }));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32600);
    });
  });

  describe('Method not found', () => {
    it('returns -32601 for unknown method', async () => {
      const result = await handleWebSocketMessage(makeRequest('unknown.method', {}, 1));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32601);
      expect(parsed.error.message).toContain('unknown.method');
    });
  });

  describe('Notifications (no id)', () => {
    it('returns null for notification (no id field)', async () => {
      const result = await handleWebSocketMessage(makeRequest('workspace.list'));
      expect(result).toBeNull();
    });

    it('returns null for unknown notification method', async () => {
      const result = await handleWebSocketMessage(makeRequest('unknown.method'));
      expect(result).toBeNull();
    });
  });

  describe('workspace.list', () => {
    it('routes to protocolAdapter.listAllWorkspaces with includeArchived false by default', async () => {
      const result = await handleWebSocketMessage(makeRequest('workspace.list', {}, 1));
      const parsed = JSON.parse(result!);
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(1);
      expect(parsed.result.workspaces).toEqual([{ id: 'ws-1', title: 'Test' }]);
      expect(mockProtocolAdapter.listAllWorkspaces).toHaveBeenCalledWith({ includeArchived: false, lite: false });
    });

    it('passes includeArchived true when requested', async () => {
      const result = await handleWebSocketMessage(makeRequest('workspace.list', { includeArchived: true }, 2));
      const parsed = JSON.parse(result!);
      expect(parsed.result.workspaces).toEqual([{ id: 'ws-1', title: 'Test' }]);
      expect(mockProtocolAdapter.listAllWorkspaces).toHaveBeenCalledWith({ includeArchived: true, lite: false });
    });
  });

  describe('workspace.get', () => {
    it('routes to protocolAdapter.getWorkspace with params', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('workspace.get', { workspaceId: 'ws-1' }, 2),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.workspace).toEqual({ id: 'ws-1', title: 'Test Workspace' });
      expect(mockProtocolAdapter.getWorkspace).toHaveBeenCalledWith('ws-1');
    });
  });

  describe('note.get', () => {
    it('routes to protocolAdapter.getNote', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.get', { workspaceId: 'ws-1', noteId: 'note-1' }, 4),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.note).toEqual({ id: 'note-1', title: 'Note 1', content: 'hello' });
    });
  });

  describe('note.create', () => {
    it('routes to protocolAdapter.createNote', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.create', { workspaceId: 'ws-1', title: 'New Note', content: 'body' }, 5),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.note).toEqual({ id: 'note-new', title: 'New Note' });
    });
  });

  describe('note.update', () => {
    it('routes to protocolAdapter.updateNote', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.update', { workspaceId: 'ws-1', noteId: 'note-1', title: 'Updated' }, 6),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.note).toBeDefined();
    });
  });

  describe('Error in handler', () => {
    it('returns -32603 internal error when handler throws', async () => {
      mockProtocolAdapter.listAllWorkspaces.mockRejectedValueOnce(new Error('boom'));
      const result = await handleWebSocketMessage(makeRequest('workspace.list', {}, 7));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32603);
    });
  });

  describe('Request with id: null', () => {
    it('returns a response (not treated as notification)', async () => {
      const msg = JSON.stringify({ jsonrpc: '2.0', method: 'workspace.list', id: null });
      const result = await handleWebSocketMessage(msg);
      expect(result).not.toBeNull();
      const parsed = JSON.parse(result!);
      expect(parsed.id).toBeNull();
      expect(parsed.result).toBeDefined();
    });
  });

  describe('note.list', () => {
    it('routes to protocolAdapter.listNotes', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.list', { workspaceId: 'ws-1' }, 3),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.notes).toEqual([{ id: 'note-1', title: 'Note 1' }]);
    });
  });

  // =========================================================================
  // workspace.create – initial agent activation (fire-and-forget)
  // =========================================================================
  describe('workspace.create – initialAgent activation', () => {
    it('returns workspace immediately without waiting for agent activation', async () => {
      mockProtocolAdapter.createWorkspace.mockResolvedValueOnce({
        ok: true,
        data: { id: 'ws-new', worktreePath: '/tmp/ws' },
      });
      mockAgentHandler.createAgent = vi.fn().mockResolvedValue({ id: 'agent-new', name: 'Coordinator' });
      mockAgentHandler.sendMessage = vi.fn().mockResolvedValue(undefined);

      const result = await handleWebSocketMessage(
        makeRequest(
          'workspace.create',
          { initialAgent: { prompt: 'do stuff', agentId: 'agent-1' } },
          10,
        ),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.workspace.id).toBe('ws-new');
    });

    it('does NOT trigger agent activation when initialAgent.prompt is missing', async () => {
      mockProtocolAdapter.createWorkspace.mockResolvedValueOnce({
        ok: true,
        data: { id: 'ws-new2' },
      });
      mockAgentHandler.createAgent = vi.fn();
      mockAgentHandler.sendMessage = vi.fn();

      await handleWebSocketMessage(
        makeRequest('workspace.create', { initialAgent: { agentId: 'agent-1' } }, 11),
      );

      // Allow any microtask / fire-and-forget to settle
      await new Promise((r) => setTimeout(r, 50));

      expect(mockAgentHandler.createAgent).not.toHaveBeenCalled();
    });

    it('does NOT trigger agent activation when initialAgent.agentId is missing', async () => {
      mockProtocolAdapter.createWorkspace.mockResolvedValueOnce({
        ok: true,
        data: { id: 'ws-new3' },
      });
      mockAgentHandler.createAgent = vi.fn();
      mockAgentHandler.sendMessage = vi.fn();

      await handleWebSocketMessage(
        makeRequest('workspace.create', { initialAgent: { prompt: 'hello' } }, 12),
      );

      await new Promise((r) => setTimeout(r, 50));
      expect(mockAgentHandler.createAgent).not.toHaveBeenCalled();
    });

    it('does NOT trigger agent activation when initialAgent is absent', async () => {
      mockProtocolAdapter.createWorkspace.mockResolvedValueOnce({
        ok: true,
        data: { id: 'ws-new4' },
      });
      mockAgentHandler.createAgent = vi.fn();

      await handleWebSocketMessage(makeRequest('workspace.create', {}, 13));

      await new Promise((r) => setTimeout(r, 50));
      expect(mockAgentHandler.createAgent).not.toHaveBeenCalled();
    });

    it('workspace creation succeeds even when agent activation fails', async () => {
      mockProtocolAdapter.createWorkspace.mockResolvedValueOnce({
        ok: true,
        data: { id: 'ws-new5', worktreePath: '/tmp/ws5' },
      });
      mockAgentHandler.createAgent = vi.fn().mockRejectedValue(new Error('agent boom'));
      mockAgentHandler.sendMessage = vi.fn();

      const result = await handleWebSocketMessage(
        makeRequest(
          'workspace.create',
          { initialAgent: { prompt: 'go', agentId: 'a-1' } },
          14,
        ),
      );
      const parsed = JSON.parse(result!);
      // Workspace creation still succeeds
      expect(parsed.result.workspace.id).toBe('ws-new5');
      expect(parsed.error).toBeUndefined();

      // Wait for the fire-and-forget to settle
      await new Promise((r) => setTimeout(r, 50));
    });

    it('triggers createAgent and sendMessage when prompt and agentId are present', async () => {
      mockProtocolAdapter.createWorkspace.mockResolvedValueOnce({
        ok: true,
        data: { id: 'ws-act', worktreePath: '/tmp/act' },
      });
      mockAgentHandler.createAgent = vi.fn().mockResolvedValue({ id: 'agent-act', name: 'Bot' });
      mockAgentHandler.sendMessage = vi.fn().mockResolvedValue(undefined);

      await handleWebSocketMessage(
        makeRequest(
          'workspace.create',
          {
            initialAgent: {
              prompt: 'build it',
              agentId: 'a-2',
              name: 'Builder',
            },
          },
          15,
        ),
      );

      // Wait for fire-and-forget async to complete
      await new Promise((r) => setTimeout(r, 100));

      expect(mockAgentHandler.createAgent).toHaveBeenCalledWith(
        'ws-act',
        'Builder',
        expect.objectContaining({
          workspacePath: '/tmp/act',
          metadata: expect.objectContaining({
            isInitialAgent: true,
            isFirstWorkspaceAgent: true,
            initialMessage: 'build it',
          }),
        }),
        'a-2',
      );
      expect(mockAgentHandler.sendMessage).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          sessionId: 'agent-act',
          message: 'build it',
          workspaceId: 'ws-act',
        }),
      );
    });

    // Regression: https://github.com/augmentcode/intent/issues/duplicate-coordinator
    // Bug: workspace.create with initialAgent.agentId was NOT passing the agentId
    // to handler.createAgent(), causing workspace.service.ts to save a pending agent
    // with the iOS-provided ID, while a SECOND agent was created with a new auto-generated ID.
    it('passes initialAgent.agentId as 4th argument to createAgent (no duplicate coordinator)', async () => {
      mockProtocolAdapter.createWorkspace.mockResolvedValueOnce({
        ok: true,
        data: { id: 'ws-dup', worktreePath: '/tmp/dup' },
      });
      mockAgentHandler.createAgent = vi.fn().mockResolvedValue({ id: 'ios-agent-id', name: 'Coordinator' });
      mockAgentHandler.sendMessage = vi.fn().mockResolvedValue(undefined);

      const iosAgentId = 'ios-agent-id';

      await handleWebSocketMessage(
        makeRequest(
          'workspace.create',
          {
            initialAgent: {
              prompt: 'hello from iOS',
              agentId: iosAgentId,
            },
          },
          99,
        ),
      );

      // Wait for fire-and-forget async to complete
      await new Promise((r) => setTimeout(r, 100));

      // The critical assertion: createAgent must receive the iOS-provided agentId
      // as the 4th positional argument so it reuses the pending agent instead of
      // creating a second one.
      expect(mockAgentHandler.createAgent).toHaveBeenCalledTimes(1);
      const callArgs = mockAgentHandler.createAgent.mock.calls[0];
      expect(callArgs[0]).toBe('ws-dup');        // workspaceId
      expect(callArgs[1]).toBe('Coordinator');    // default name
      expect(callArgs[2]).toEqual(expect.objectContaining({ workspacePath: '/tmp/dup' }));
      expect(callArgs[3]).toBe(iosAgentId);      // agentId — the fix
    });
  });

  // =========================================================================
  // workspace.update
  // =========================================================================
  describe('workspace.update', () => {
    it('routes to protocolAdapter.updateWorkspace', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('workspace.update', { workspaceId: 'ws-1', title: 'New Title' }, 20),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.workspace).toEqual({ id: 'ws-1' });
      expect(mockProtocolAdapter.updateWorkspace).toHaveBeenCalledWith({ id: 'ws-1', title: 'New Title' });
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('workspace.update', {}, 21),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // workspace.delete
  // =========================================================================
  describe('workspace.delete', () => {
    it('routes to protocolAdapter.deleteWorkspace', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('workspace.delete', { workspaceId: 'ws-1' }, 22),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(mockProtocolAdapter.deleteWorkspace).toHaveBeenCalledWith('ws-1');
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('workspace.delete', {}, 23),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // workspace.archive
  // =========================================================================
  describe('workspace.archive', () => {
    it('routes to protocolAdapter.archiveWorkspace', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('workspace.archive', { workspaceId: 'ws-1' }, 24),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(mockProtocolAdapter.archiveWorkspace).toHaveBeenCalledWith('ws-1');
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('workspace.archive', {}, 25),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // workspace.unarchive
  // =========================================================================
  describe('workspace.unarchive', () => {
    it('routes to protocolAdapter.unarchiveWorkspace', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('workspace.unarchive', { workspaceId: 'ws-1' }, 26),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(mockProtocolAdapter.unarchiveWorkspace).toHaveBeenCalledWith('ws-1');
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('workspace.unarchive', {}, 27),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.getConversation
  // =========================================================================
  describe('agent.getConversation', () => {
    it('returns messages for an agent', async () => {
      mockAgentHandler.getAgent.mockResolvedValueOnce({
        id: 'agent-1',
        messages: [{ role: 'user', content: 'hello' }],
      });
      const result = await handleWebSocketMessage(
        makeRequest('agent.getConversation', { agentId: 'agent-1' }, 30),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.agentId).toBe('agent-1');
      expect(parsed.result.messages).toHaveLength(1);
      expect(parsed.result.truncated).toBe(false);
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.getConversation', {}, 31),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.stop
  // =========================================================================
  describe('agent.stop', () => {
    it('calls handler.stopAgent', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.stop', { agentId: 'agent-1' }, 32),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(mockAgentHandler.stopAgent).toHaveBeenCalledWith('agent-1', 'websocket_api');
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.stop', {}, 33),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.delete
  // =========================================================================
  describe('agent.delete', () => {
    it('calls handler.deleteAgent', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.delete', { agentId: 'agent-1', workspaceId: 'ws-1' }, 34),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(mockAgentHandler.deleteAgent).toHaveBeenCalledWith('agent-1', 'ws-1');
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.delete', {}, 35),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.sendMessage
  // =========================================================================
  describe('agent.sendMessage', () => {
    // ---------------------------------------------------------------------
    // Single-emit invariant (Audit 4 / Track F Bundle 3 — Task 4)
    //
    // The protocol handler MUST NOT dispatch `agent:user-message:sent` itself
    // — the canonical emit lives inside AgentBackendHandler.handleSendMessage
    // (non-queued path) and AgentBackendHandler.handleQueueMessage (queued
    // path). To verify the regression we configure the mocked handler methods
    // to emit ONCE (simulating the canonical site) and assert the total
    // workspace-event dispatch count is exactly one per send.
    // ---------------------------------------------------------------------
    const simulateCanonicalEmitOnce = async () => {
      const { emitWorkspaceEvent } = await import('../../store/main/slices/workspace-events/workspace-events-slice');
      const { createWorkspaceEvent } = await import('../../features/events/types');
      const { mainDispatch } = await import('../../store/main/redux-store-bridge');
      mainDispatch(emitWorkspaceEvent(createWorkspaceEvent(
        'agent:user-message:sent' as any,
        'ws-1',
        { type: 'user', id: 'user' },
        { agentId: 'agent-1', messageId: 'canonical-msg', content: 'hello' },
      )));
    };

    it('sends directly and emits exactly one user-message workspace event (non-queued path)', async () => {
      const { emitWorkspaceEvent } = await import('../../store/main/slices/workspace-events/workspace-events-slice');
      vi.mocked(emitWorkspaceEvent).mockClear();

      mockAgentHandler.getActiveStreams.mockReturnValue([]);
      mockAgentHandler.sendMessage.mockImplementationOnce(async () => {
        await simulateCanonicalEmitOnce();
        return { success: true };
      });
      const result = await handleWebSocketMessage(
        makeRequest('agent.sendMessage', { agentId: 'agent-1', content: 'hello', workspaceId: 'ws-1' }, 40),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.queued).toBe(false);
      // The protocol handler itself must NOT emit — the canonical handler did it once.
      expect(emitWorkspaceEvent).toHaveBeenCalledTimes(1);
    });

    it('queues when streaming and emits exactly one user-message workspace event (queued path)', async () => {
      const { emitWorkspaceEvent } = await import('../../store/main/slices/workspace-events/workspace-events-slice');
      vi.mocked(emitWorkspaceEvent).mockClear();

      mockAgentHandler.getActiveStreams.mockReturnValue([{ agentId: 'agent-1' }]);
      mockAgentHandler.handleQueueMessage.mockImplementationOnce(async () => {
        await simulateCanonicalEmitOnce();
        return { success: true, queuedMessage: { id: 'q-1' } };
      });
      const result = await handleWebSocketMessage(
        makeRequest('agent.sendMessage', { agentId: 'agent-1', content: 'hello', workspaceId: 'ws-1' }, 41),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.queued).toBe(true);
      expect(mockAgentHandler.handleQueueMessage).toHaveBeenCalled();
      // handleQueueMessage emits once; protocol handler must not double-emit.
      expect(emitWorkspaceEvent).toHaveBeenCalledTimes(1);
      // The handler must propagate workspaceId so the canonical emit can fire.
      expect(mockAgentHandler.handleQueueMessage).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ workspaceId: 'ws-1' }),
      );
    });

    it('falls back to queue on sendMessage failure with exactly one emit total (fallback path)', async () => {
      const { emitWorkspaceEvent } = await import('../../store/main/slices/workspace-events/workspace-events-slice');
      vi.mocked(emitWorkspaceEvent).mockClear();

      mockAgentHandler.getActiveStreams.mockReturnValue([]);
      mockAgentHandler.sendMessage.mockResolvedValueOnce({ success: false });
      mockAgentHandler.handleQueueMessage.mockImplementationOnce(async () => {
        await simulateCanonicalEmitOnce();
        return { success: true, queuedMessage: { id: 'q-fallback' } };
      });
      const result = await handleWebSocketMessage(
        makeRequest('agent.sendMessage', { agentId: 'agent-1', content: 'hello', workspaceId: 'ws-1' }, 42),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.queued).toBe(true);
      // Only the fallback handleQueueMessage emits — sendMessage failed (so canonical
      // emit was skipped) and the protocol handler must not emit on its own.
      expect(emitWorkspaceEvent).toHaveBeenCalledTimes(1);
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.sendMessage', { content: 'hello', workspaceId: 'ws-1' }, 43),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });

    it('returns INVALID_PARAMS when content is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.sendMessage', { agentId: 'agent-1', workspaceId: 'ws-1' }, 44),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.queueMessage
  // =========================================================================
  describe('agent.queueMessage', () => {
    it('calls handler.handleQueueMessage', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.queueMessage', { agentId: 'agent-1', content: 'queued msg' }, 50),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(mockAgentHandler.handleQueueMessage).toHaveBeenCalled();
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.queueMessage', { content: 'msg' }, 51),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.editQueuedMessage
  // =========================================================================
  describe('agent.editQueuedMessage', () => {
    it('calls handler.handleEditQueuedMessage', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.editQueuedMessage', { agentId: 'agent-1', messageId: 'msg-1', content: 'edited' }, 52),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.editQueuedMessage', { messageId: 'msg-1', content: 'edited' }, 53),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.removeQueuedMessage
  // =========================================================================
  describe('agent.removeQueuedMessage', () => {
    it('calls handler.handleRemoveQueuedMessage', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.removeQueuedMessage', { agentId: 'agent-1', messageId: 'msg-1' }, 54),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.removeQueuedMessage', { messageId: 'msg-1' }, 55),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.getQueue
  // =========================================================================
  describe('agent.getQueue', () => {
    it('calls handler.handleGetQueue', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.getQueue', { agentId: 'agent-1' }, 56),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.messages).toEqual([]);
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.getQueue', {}, 57),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.forceMessage
  // =========================================================================
  describe('agent.forceMessage', () => {
    it('stops the agent and emits exactly one user-message workspace event on success (single-emit invariant)', async () => {
      const { emitWorkspaceEvent } = await import('../../store/main/slices/workspace-events/workspace-events-slice');
      const { createWorkspaceEvent } = await import('../../features/events/types');
      const { mainDispatch } = await import('../../store/main/redux-store-bridge');
      vi.mocked(emitWorkspaceEvent).mockClear();

      mockAgentHandler.sendMessage.mockImplementationOnce(async () => {
        // Simulate the canonical emit inside AgentBackendHandler.handleSendMessage.
        mainDispatch(emitWorkspaceEvent(createWorkspaceEvent(
          'agent:user-message:sent' as any,
          'ws-1',
          { type: 'user', id: 'user' },
          { agentId: 'agent-1', messageId: 'msg-1', content: 'forced' },
        )));
        return { success: true };
      });
      const result = await handleWebSocketMessage(
        makeRequest('agent.forceMessage', { agentId: 'agent-1', messageId: 'msg-1', content: 'forced', workspaceId: 'ws-1' }, 58),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(mockAgentHandler.stopAgent).toHaveBeenCalledWith('agent-1', 'force_message');
      expect(mockAgentHandler.sendMessage).toHaveBeenCalled();
      // The protocol handler must NOT emit its own user-message event — only the
      // canonical handler emits, exactly once.
      expect(emitWorkspaceEvent).toHaveBeenCalledTimes(1);
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.forceMessage', { messageId: 'msg-1', content: 'forced', workspaceId: 'ws-1' }, 59),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.setModel
  // =========================================================================
  describe('agent.setModel', () => {
    it('calls handler.handleSetModel', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.setModel', { agentId: 'agent-1', modelId: 'model-1', workspaceId: 'ws-1' }, 60),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(mockAgentHandler.handleSetModel).toHaveBeenCalled();
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.setModel', { modelId: 'model-1', workspaceId: 'ws-1' }, 61),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.getModels
  // =========================================================================
  describe('agent.getModels', () => {
    it('returns models from auggie CLI', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.getModels', {}, 70),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.models).toBeDefined();
      expect(parsed.result.models.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // agent.getSubscriptions
  // =========================================================================
  describe('agent.getSubscriptions', () => {
    it('returns subscriptions, delegationGroups, and agentStatuses for an agent (additive shape)', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.getSubscriptions', { agentId: 'agent-1', workspaceId: 'ws-1' }, 72),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.subscriptions).toEqual([]);
      expect(parsed.result.delegationGroups).toEqual([]);
      // Audit 4 / Track F Bundle 3 — Task 2: agentStatuses is part of the additive
      // response shape and must be present even when no subscriptions exist.
      expect(parsed.result.agentStatuses).toEqual({});
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.getSubscriptions', { workspaceId: 'ws-1' }, 73),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });

    it('enriches each subscription with derived description and flattened filter fields (additive)', async () => {
      mockSelectAgentSubscriptions.select.mockReturnValueOnce([
        {
          id: 'sub-1',
          agentId: 'agent-1',
          agentName: 'Researcher',
          workspaceId: 'ws-1',
          createdAt: '2026-05-19T00:00:00.000Z',
          filter: {
            eventTypes: ['agent:idle', 'agent:failed'],
            actorTypes: ['agent'],
            actorIds: ['agent-2'],
            priority: 'high',
            oneShot: true,
          },
        },
      ]);
      const result = await handleWebSocketMessage(
        makeRequest('agent.getSubscriptions', { agentId: 'agent-1', workspaceId: 'ws-1' }, 74),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.subscriptions).toHaveLength(1);
      const sub = parsed.result.subscriptions[0];
      // Existing fields preserved (additive only).
      expect(sub.id).toBe('sub-1');
      expect(sub.filter).toEqual({
        eventTypes: ['agent:idle', 'agent:failed'],
        actorTypes: ['agent'],
        actorIds: ['agent-2'],
        priority: 'high',
        oneShot: true,
      });
      // New fields: derived description + flattened filter.* properties.
      expect(typeof sub.description).toBe('string');
      expect(sub.description).toContain('Researcher');
      expect(sub.eventTypes).toEqual(['agent:idle', 'agent:failed']);
      expect(sub.actorTypes).toEqual(['agent']);
      expect(sub.actorIds).toEqual(['agent-2']);
      expect(sub.priority).toBe('high');
      expect(sub.oneShot).toBe(true);
    });

    it('returns live agentStatuses including the responding (streaming) status', async () => {
      mockSelectWorkspaceSubscriptionState.select.mockReturnValueOnce({
        subscriptions: {},
        agentQueues: {},
        agentStatuses: { 'agent-1': 'responding', 'agent-2': 'idle' },
        delegationGroups: {},
        firedOneShotSubscriptions: [],
        deletedAgents: {},
        deliveryStats: {
          totalDeliveries: 0,
          successfulDeliveries: 0,
          failedDeliveries: 0,
          timeoutDeliveries: 0,
          droppedEvents: 0,
          lastDeliveryTime: null,
          lastFailureTime: null,
        },
      });
      const result = await handleWebSocketMessage(
        makeRequest('agent.getSubscriptions', { agentId: 'agent-1', workspaceId: 'ws-1' }, 75),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.agentStatuses).toEqual({
        'agent-1': 'responding',
        'agent-2': 'idle',
      });
    });
  });

  // =========================================================================
  // agent.cancelSubscriptions
  // =========================================================================
  describe('agent.cancelSubscriptions', () => {
    it('cancels subscriptions for an agent', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.cancelSubscriptions', { agentId: 'agent-1', workspaceId: 'ws-1' }, 74),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.cancelSubscriptions', { workspaceId: 'ws-1' }, 75),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // specialist.list
  // =========================================================================
  describe('specialist.list', () => {
    it('returns merged specialist list', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('specialist.list', {}, 76),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.specialists).toBeDefined();
      expect(parsed.result.specialists.length).toBe(2);
      // User specialist first
      expect(parsed.result.specialists[0].id).toBe('user-1');
      expect(parsed.result.specialists[1].id).toBe('bundled-1');
    });
  });

  // =========================================================================
  // agent.create
  // =========================================================================
  describe('agent.create', () => {
    it('creates an agent in a workspace', async () => {
      mockProtocolAdapter.getWorkspace.mockResolvedValueOnce({
        id: 'ws-1',
        worktreePath: '/tmp/ws',
      });
      mockAgentHandler.createAgent.mockResolvedValueOnce({ id: 'agent-created', name: 'My Agent' });
      const result = await handleWebSocketMessage(
        makeRequest('agent.create', { workspaceId: 'ws-1', name: 'My Agent' }, 78),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.agent.id).toBe('agent-created');
      expect(parsed.result.agent.name).toBe('My Agent');
      expect(mockAgentHandler.createAgent).toHaveBeenCalled();
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.create', {}, 79),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // agent.rename
  // =========================================================================
  describe('agent.rename', () => {
    it('renames an agent', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.rename', { agentId: 'agent-1', name: 'New Name', workspaceId: 'ws-1' }, 80),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.success).toBe(true);
      expect(parsed.result.name).toBe('New Name');
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.rename', { name: 'New Name' }, 81),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });

    it('returns INVALID_PARAMS when name is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.rename', { agentId: 'agent-1' }, 82),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });

    it('routes through renameAgentOnDisk helper with correct args', async () => {
      const { renameAgentOnDisk } = await import('../../features/agent/main/agent-rename');
      vi.mocked(renameAgentOnDisk).mockClear();

      await handleWebSocketMessage(
        makeRequest('agent.rename', { agentId: 'agent-ws-event', name: 'Event Test', workspaceId: 'ws-event' }, 83),
      );

      expect(renameAgentOnDisk).toHaveBeenCalledWith({
        workspaceId: 'ws-event',
        agentId: 'agent-ws-event',
        name: 'Event Test',
      });
    });

    it('does NOT call sendToWorkspaceWindows directly (uses workspace event system)', async () => {
      const { sendToWorkspaceWindows } = await import('../../features/system/main/system.ipc');
      vi.mocked(sendToWorkspaceWindows).mockClear();

      await handleWebSocketMessage(
        makeRequest('agent.rename', { agentId: 'agent-no-ipc', name: 'No IPC', workspaceId: 'ws-no-ipc' }, 84),
      );

      // Wait for fire-and-forget async to complete
      await new Promise((r) => setTimeout(r, 50));

      // sendToWorkspaceWindows should NOT be called directly from agent.rename
      // It will be called by the broadcast saga when processing the workspace event
      expect(sendToWorkspaceWindows).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // repo.list
  // =========================================================================
  describe('repo.list', () => {
    it('returns repos from registry', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('repo.list', {}, 90),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.repos).toEqual([{ path: '/repo', name: 'test-repo' }]);
    });
  });

  // =========================================================================
  // git.getBranches
  // =========================================================================
  describe('git.getBranches', () => {
    it('returns branches for a repo', async () => {
      const { execAsync } = await import('../../shared/git/git-env');
      const mockExecAsync = vi.mocked(execAsync);
      // First call: git branch --show-current
      mockExecAsync.mockResolvedValueOnce({ stdout: 'main', stderr: '' } as any);
      // Second call: git branch (local branches)
      mockExecAsync.mockResolvedValueOnce({ stdout: '* main\n  feature-1\n', stderr: '' } as any);
      // Third call: git symbolic-ref (default branch)
      mockExecAsync.mockResolvedValueOnce({ stdout: 'refs/remotes/origin/main', stderr: '' } as any);

      const result = await handleWebSocketMessage(
        makeRequest('git.getBranches', { repoPath: '/repo' }, 92),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.currentBranch).toBe('main');
      expect(parsed.result.branches).toBeDefined();
    });

    it('returns INVALID_PARAMS when repoPath is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('git.getBranches', {}, 93),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // Wire-compat additions for Track R, wave 2a
  // (adapter scaffold + 9 existing-method shims)
  // =========================================================================
  describe('workspace.create (basic wire shape)', () => {
    it('returns { workspace } when no initialAgent is provided', async () => {
      mockProtocolAdapter.createWorkspace.mockResolvedValueOnce({
        ok: true,
        data: { id: 'ws-basic', title: 'Basic' },
      });
      const result = await handleWebSocketMessage(
        makeRequest('workspace.create', { title: 'Basic' }, 200),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(200);
      expect(parsed.result.workspace).toEqual({ id: 'ws-basic', title: 'Basic' });
      expect(parsed.error).toBeUndefined();
    });
  });

  describe('note.get (null/not-found wire shape)', () => {
    it('returns INVALID_PARAMS when the note does not exist', async () => {
      mockProtocolAdapter.getNote.mockResolvedValueOnce(null);
      const result = await handleWebSocketMessage(
        makeRequest('note.get', { workspaceId: 'ws-1', noteId: 'missing' }, 201),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe(-32602);
      expect(parsed.error.message).toContain('Note not found');
    });
  });

  describe('note.update (content branch routes via ws.note.setContent)', () => {
    it('returns { note } when content is present (setContent semantics)', async () => {
      mockProtocolAdapter.updateNote.mockResolvedValueOnce({
        id: 'note-1',
        title: 'Note 1',
        content: 'new body',
      });
      const result = await handleWebSocketMessage(
        makeRequest(
          'note.update',
          { workspaceId: 'ws-1', noteId: 'note-1', content: 'new body' },
          202,
        ),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(202);
      expect(parsed.result.note).toBeDefined();
      expect(parsed.result.note.content).toBe('new body');
      expect(parsed.error).toBeUndefined();
    });
  });

  // =========================================================================
  // Track R, wave 2b — note.*/task.*/comment.* adapter shims
  //
  // 21 new JSON-RPC methods that 1:1 forward to ws.note.*, ws.task.*,
  // and ws.comment.* peers (buildNoteApi). Tests are shape-only:
  // assert positional forwarding to the peer and that the peer's
  // return value is serialised through unchanged. INVALID_PARAMS
  // tests cover the required-param validation at the adapter layer.
  // =========================================================================
  describe('note.add (wave 2b)', () => {
    it('forwards params to ws.note.add and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.add', { workspaceId: 'ws-1', noteId: 'note-1', content: 'body', heading: '## H', position: 'end' }, 2001),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2001, result: { ok: true, noteId: 'note-1', content: 'added' } });
      expect(mockNotePeers.note.add).toHaveBeenCalledWith('note-1', { content: 'body', heading: '## H', position: 'end' });
    });

    it('returns INVALID_PARAMS when noteId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.add', { workspaceId: 'ws-1', content: 'body' }, 2002),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('note.edit (wave 2b)', () => {
    it('forwards params to ws.note.edit and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.edit', { workspaceId: 'ws-1', noteId: 'note-1', old: 'A', new: 'B' }, 2003),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2003, result: { ok: true, noteId: 'note-1', content: 'edited' } });
      expect(mockNotePeers.note.edit).toHaveBeenCalledWith('note-1', { old: 'A', new: 'B' });
    });

    it('returns INVALID_PARAMS when old is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.edit', { workspaceId: 'ws-1', noteId: 'note-1', new: 'B' }, 2004),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('note.editLines (wave 2b)', () => {
    it('forwards params to ws.note.editLines and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.editLines', { workspaceId: 'ws-1', noteId: 'note-1', start: 1, end: 3, content: 'X' }, 2005),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2005, result: { ok: true, noteId: 'note-1', content: 'edited-lines' } });
      expect(mockNotePeers.note.editLines).toHaveBeenCalledWith('note-1', { start: 1, end: 3, content: 'X' });
    });

    it('returns INVALID_PARAMS when end is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.editLines', { workspaceId: 'ws-1', noteId: 'note-1', start: 1, content: 'X' }, 2006),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('note.setContent (wave 2b)', () => {
    it('forwards params to ws.note.setContent and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.setContent', { workspaceId: 'ws-1', noteId: 'note-1', content: 'full body', confirmReplacement: true }, 2007),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2007, result: { ok: true, noteId: 'note-1' } });
      expect(mockNotePeers.note.setContent).toHaveBeenCalledWith('note-1', 'full body', true);
    });

    it('returns INVALID_PARAMS when content is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.setContent', { workspaceId: 'ws-1', noteId: 'note-1' }, 2008),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('note.updateMetadata (wave 2b)', () => {
    it('forwards params to ws.note.updateMetadata and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.updateMetadata', { workspaceId: 'ws-1', noteId: 'note-1', title: 'T', tags: ['a'] }, 2009),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2009, result: { ok: true, noteId: 'note-1', title: 'New Title' } });
      expect(mockNotePeers.note.updateMetadata).toHaveBeenCalledWith('note-1', { title: 'T', tags: ['a'] });
    });

    it('returns INVALID_PARAMS when noteId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.updateMetadata', { workspaceId: 'ws-1', title: 'T' }, 2010),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('note.delete (wave 2b)', () => {
    it('forwards params to ws.note.delete and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.delete', { workspaceId: 'ws-1', noteId: 'note-1' }, 2011),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2011, result: { ok: true, noteId: 'note-1', deleted: true } });
      expect(mockNotePeers.note.delete).toHaveBeenCalledWith('note-1');
    });

    it('returns INVALID_PARAMS when noteId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.delete', { workspaceId: 'ws-1' }, 2012),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('note.listTasks (wave 2b)', () => {
    it('forwards params to ws.note.listTasks and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.listTasks', { workspaceId: 'ws-1', noteId: 'note-1' }, 2013),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2013, result: [{ text: 'task one', status: 'todo', lineNumber: 1 }] });
      expect(mockNotePeers.note.listTasks).toHaveBeenCalledWith('note-1');
    });

    it('returns INVALID_PARAMS when noteId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.listTasks', { workspaceId: 'ws-1' }, 2014),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('note.readAsset (wave 2b)', () => {
    it('forwards params to ws.note.readAsset and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.readAsset', { workspaceId: 'ws-1', asset: 'workspace-asset://ws-1/a1' }, 2015),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2015, result: { assetId: 'asset-1', mimeType: 'image/png', data: 'BASE64', sizeKb: 12 } });
      expect(mockNotePeers.note.readAsset).toHaveBeenCalledWith('workspace-asset://ws-1/a1');
    });

    it('returns INVALID_PARAMS when asset is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('note.readAsset', { workspaceId: 'ws-1' }, 2016),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('comment.add (wave 2b)', () => {
    it('forwards params to ws.comment.add and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('comment.add', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          searchContext: 'ctx',
          commentTarget: 'tgt',
          comment: 'hello',
          type: 'comment',
          author: 'agent',
        }, 2101),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2101, result: { ok: true, commentId: 'c-1', threadId: 't-1' } });
      expect(mockNotePeers.comment.add).toHaveBeenCalledWith('note-1', {
        searchContext: 'ctx',
        commentTarget: 'tgt',
        comment: 'hello',
        type: 'comment',
        author: 'agent',
      });
    });

    it('returns INVALID_PARAMS when commentTarget is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('comment.add', { workspaceId: 'ws-1', noteId: 'note-1', searchContext: 'ctx', comment: 'hi' }, 2102),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('comment.list (wave 2b)', () => {
    it('forwards params to ws.comment.list and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('comment.list', { workspaceId: 'ws-1', noteId: 'note-1', status: 'open', includeComments: true }, 2103),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2103, result: [{ threadId: 't-1', latestCommentAt: '2026-05-19T00:00:00.000Z' }] });
      expect(mockNotePeers.comment.list).toHaveBeenCalledWith('note-1', {
        since: undefined,
        authorType: undefined,
        status: 'open',
        includeComments: true,
      });
    });

    it('returns INVALID_PARAMS when noteId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('comment.list', { workspaceId: 'ws-1' }, 2104),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('comment.getThread (wave 2b)', () => {
    it('forwards params to ws.comment.getThread and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('comment.getThread', { workspaceId: 'ws-1', noteId: 'note-1', threadId: 't-1' }, 2105),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2105, result: { threadId: 't-1', comments: [] } });
      expect(mockNotePeers.comment.getThread).toHaveBeenCalledWith('note-1', { threadId: 't-1', commentId: undefined });
    });

    it('returns INVALID_PARAMS when noteId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('comment.getThread', { workspaceId: 'ws-1', threadId: 't-1' }, 2106),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('comment.respond (wave 2b)', () => {
    it('forwards params to ws.comment.respond and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('comment.respond', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          threadId: 't-1',
          comment: 'reply',
          type: 'suggestion',
          suggestionOriginal: 'foo',
          suggestionProposed: 'bar',
        }, 2107),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2107, result: { ok: true, commentId: 'c-2' } });
      expect(mockNotePeers.comment.respond).toHaveBeenCalledWith('note-1', {
        threadId: 't-1',
        commentId: undefined,
        comment: 'reply',
        type: 'suggestion',
        author: undefined,
        suggestionOriginal: 'foo',
        suggestionProposed: 'bar',
      });
    });

    it('returns INVALID_PARAMS when comment is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('comment.respond', { workspaceId: 'ws-1', noteId: 'note-1', threadId: 't-1' }, 2108),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('comment.delete (wave 2b)', () => {
    it('forwards params to ws.comment.delete and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('comment.delete', { workspaceId: 'ws-1', noteId: 'note-1', commentId: 'c-1' }, 2109),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2109, result: { ok: true, commentId: 'c-1', deleted: true } });
      expect(mockNotePeers.comment.delete).toHaveBeenCalledWith('note-1', 'c-1');
    });

    it('returns INVALID_PARAMS when commentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('comment.delete', { workspaceId: 'ws-1', noteId: 'note-1' }, 2110),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('task.updateStatus (wave 2b)', () => {
    it('forwards params to ws.task.updateStatus and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.updateStatus', { workspaceId: 'ws-1', noteId: 'note-1', taskText: 'do thing', status: 'done' }, 2201),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2201, result: { ok: true, noteId: 'note-1', status: 'done' } });
      expect(mockNotePeers.task.updateStatus).toHaveBeenCalledWith('note-1', 'do thing', 'done');
    });

    it('returns INVALID_PARAMS when taskText is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.updateStatus', { workspaceId: 'ws-1', noteId: 'note-1', status: 'done' }, 2202),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('task.updateNoteStatus (wave 2b)', () => {
    it('forwards params to ws.task.updateNoteStatus and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.updateNoteStatus', { workspaceId: 'ws-1', noteId: 'note-1', status: 'in_progress' }, 2203),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2203, result: { ok: true, noteId: 'note-1', status: 'in_progress' } });
      expect(mockNotePeers.task.updateNoteStatus).toHaveBeenCalledWith('note-1', 'in_progress');
    });

    it('returns INVALID_PARAMS when status is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.updateNoteStatus', { workspaceId: 'ws-1', noteId: 'note-1' }, 2204),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('task.update (wave 2b)', () => {
    it('forwards params to ws.task.update and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.update', { workspaceId: 'ws-1', noteId: 'note-1', line: 5, status: 'done', text: 'new text' }, 2205),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2205, result: { ok: true, lineNumber: 5 } });
      expect(mockNotePeers.task.update).toHaveBeenCalledWith('note-1', 5, {
        text: 'new text',
        status: 'done',
        expected: undefined,
      });
    });

    it('returns INVALID_PARAMS when line is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.update', { workspaceId: 'ws-1', noteId: 'note-1', status: 'done' }, 2206),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('task.getMyTask (wave 2b)', () => {
    it('forwards params to ws.task.getMyTask and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.getMyTask', { workspaceId: 'ws-1', taskNoteId: 'task-1' }, 2207),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2207, result: { noteId: 'task-1', title: 'Sample Task' } });
      expect(mockNotePeers.task.getMyTask).toHaveBeenCalledWith('task-1');
    });

    it('returns INVALID_PARAMS when taskNoteId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.getMyTask', { workspaceId: 'ws-1' }, 2208),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('task.markAsTask (wave 2b)', () => {
    it('forwards params to ws.task.markAsTask and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.markAsTask', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          status: 'in_progress',
          acceptanceCriteria: ['a', 'b'],
          effort: 'M',
        }, 2209),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2209, result: { ok: true, noteId: 'note-1' } });
      expect(mockNotePeers.task.markAsTask).toHaveBeenCalledWith('note-1', 'in_progress', {
        acceptanceCriteria: ['a', 'b'],
        effort: 'M',
      });
    });

    it('returns INVALID_PARAMS when status is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.markAsTask', { workspaceId: 'ws-1', noteId: 'note-1' }, 2210),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('task.convertBlocks (wave 2b)', () => {
    it('forwards params to ws.task.convertBlocks and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.convertBlocks', { workspaceId: 'ws-1', noteId: 'note-1' }, 2211),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2211, result: { convertedCount: 2, createdNoteIds: ['n-a', 'n-b'] } });
      expect(mockNotePeers.task.convertBlocks).toHaveBeenCalledWith('note-1');
    });

    it('returns INVALID_PARAMS when noteId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.convertBlocks', { workspaceId: 'ws-1' }, 2212),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('task.createPrerequisite (wave 2b)', () => {
    it('forwards params to ws.task.createPrerequisite and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.createPrerequisite', {
          workspaceId: 'ws-1',
          dependentNoteId: 'task-1',
          title: 'Pre Task',
          content: 'body',
          status: 'not_started',
        }, 2213),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2213, result: { ok: true, prerequisiteNoteId: 'pre-1' } });
      expect(mockNotePeers.task.createPrerequisite).toHaveBeenCalledWith('task-1', 'Pre Task', {
        content: 'body',
        status: 'not_started',
      });
    });

    it('returns INVALID_PARAMS when title is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.createPrerequisite', { workspaceId: 'ws-1', dependentNoteId: 'task-1' }, 2214),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('task.assignAgent (wave 2b)', () => {
    it('forwards params to ws.task.assignAgent and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.assignAgent', { workspaceId: 'ws-1', noteId: 'note-1', agentId: 'agent-1' }, 2215),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2215, result: { ok: true, noteId: 'note-1', agentId: 'agent-1' } });
      expect(mockNotePeers.task.assignAgent).toHaveBeenCalledWith('note-1', 'agent-1');
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('task.assignAgent', { workspaceId: 'ws-1', noteId: 'note-1' }, 2216),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // Track R, wave 2c — agent.* (new) + git.* + pr.* adapter shims
  //
  // 21 new JSON-RPC methods that 1:1 forward to ws.agent.*, ws.git.*,
  // and ws.pr.* peers (buildAgentApi/buildWsGitApi/buildWsPrApi).
  // Tests are shape-only: assert positional forwarding to the peer
  // and that the peer's return value is serialised through unchanged.
  // INVALID_PARAMS tests cover required-param validation at the
  // adapter layer. Negative-path cases for `git.stage` (`.`/`*`/`--all`
  // rejection) and `agent.reportToParent` (delegated-agents-only) are
  // covered separately by simulating the underlying builder error.
  // =========================================================================

  describe('agent.delegate (wave 2c)', () => {
    it('forwards params to ws.agent.delegate and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.delegate', {
          workspaceId: 'ws-1',
          taskNoteId: 'task-1',
          agentInstructions: 'do thing',
          specialist: 'implementor',
        }, 2301),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2301, result: { ok: true, agentId: 'agent-d1', text: 'delegated' } });
      expect(mockAgentPeer.delegate).toHaveBeenCalledWith({
        taskNoteId: 'task-1',
        agentInstructions: 'do thing',
        specialist: 'implementor',
      });
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.delegate', { taskNoteId: 'task-1' }, 2302),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('agent.sendToTask (wave 2c)', () => {
    it('forwards params to ws.agent.sendToTask and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.sendToTask', {
          workspaceId: 'ws-1',
          taskNoteId: 'task-1',
          message: 'hello',
          priority: 'interrupt',
        }, 2303),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2303, result: { ok: true, taskNoteId: 'task-1' } });
      expect(mockAgentPeer.sendToTask).toHaveBeenCalledWith('task-1', 'hello', 'interrupt');
    });

    it('returns INVALID_PARAMS when message is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.sendToTask', { workspaceId: 'ws-1', taskNoteId: 'task-1' }, 2304),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('agent.subscribe (wave 2c)', () => {
    it('forwards params to ws.agent.subscribe and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.subscribe', {
          workspaceId: 'ws-1',
          eventTypes: ['agent:*'],
          excludeSelf: true,
          batchWindow: 500,
        }, 2305),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2305, result: { ok: true, subscriptionId: 'sub-1' } });
      expect(mockAgentPeer.subscribe).toHaveBeenCalledWith(['agent:*'], {
        excludeSelf: true,
        batchWindow: 500,
      });
    });

    it('returns INVALID_PARAMS when eventTypes is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.subscribe', { workspaceId: 'ws-1' }, 2306),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });

    it('returns INVALID_PARAMS when eventTypes is not an array', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.subscribe', { workspaceId: 'ws-1', eventTypes: 'agent:*' }, 2307),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
      expect(parsed.error.message).toContain('eventTypes must be an array');
    });
  });

  describe('agent.unsubscribe (wave 2c)', () => {
    it('forwards params to ws.agent.unsubscribe and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.unsubscribe', { workspaceId: 'ws-1', subscriptionId: 'sub-1' }, 2308),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2308, result: { ok: true, subscriptionId: 'sub-1' } });
      expect(mockAgentPeer.unsubscribe).toHaveBeenCalledWith('sub-1');
    });

    it('returns INVALID_PARAMS when subscriptionId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.unsubscribe', { workspaceId: 'ws-1' }, 2309),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('agent.wakeOrCreate (wave 2c)', () => {
    it('forwards params to ws.agent.wakeOrCreate and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.wakeOrCreate', {
          workspaceId: 'ws-1',
          taskNoteId: 'task-1',
          contextMessage: 'continue please',
          model: 'opus4.7',
        }, 2310),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2310, result: { ok: true, taskNoteId: 'task-1', agentId: 'agent-w1' } });
      expect(mockAgentPeer.wakeOrCreate).toHaveBeenCalledWith('task-1', 'continue please', 'opus4.7');
    });

    it('returns INVALID_PARAMS when contextMessage is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.wakeOrCreate', { workspaceId: 'ws-1', taskNoteId: 'task-1' }, 2311),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('agent.summary (wave 2c)', () => {
    it('forwards params to ws.agent.summary and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.summary', { workspaceId: 'ws-1', agentId: 'agent-1' }, 2312),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2312, result: { agentId: 'agent-1', agentName: 'Test', messageCount: 5 } });
      expect(mockAgentPeer.summary).toHaveBeenCalledWith('agent-1');
    });

    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.summary', { workspaceId: 'ws-1' }, 2313),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('agent.reportToParent (wave 2c)', () => {
    it('forwards params to ws.agent.reportToParent and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.reportToParent', { workspaceId: 'ws-1', report: 'all done' }, 2314),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2314, result: { ok: true, text: 'Report saved' } });
      expect(mockAgentPeer.reportToParent).toHaveBeenCalledWith('all done');
    });

    it('returns INVALID_PARAMS when report is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('agent.reportToParent', { workspaceId: 'ws-1' }, 2315),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });

    it('surfaces INTERNAL_ERROR when caller is not a delegated agent', async () => {
      mockAgentPeer.reportToParent.mockRejectedValueOnce(
        new Error('This tool is only available for delegated agents (agents created by another agent). You appear to have been created directly by a user, not by another agent.'),
      );
      const result = await handleWebSocketMessage(
        makeRequest('agent.reportToParent', { workspaceId: 'ws-1', report: 'hi' }, 2316),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32603);
      expect(parsed.error.message).toContain('only available for delegated agents');
    });
  });

  // =========================================================================
  // Track R, wave 2c — git.* shims
  // =========================================================================

  describe('git.status (wave 2c)', () => {
    it('forwards to ws.git.status and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('git.status', { workspaceId: 'ws-1' }, 2401),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0',
        id: 2401,
        result: { modified: ['a.ts'], staged: [], untracked: [], deleted: [] },
      });
      expect(mockGitPeer.status).toHaveBeenCalledWith();
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('git.status', {}, 2402),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('git.stage (wave 2c)', () => {
    it('forwards params to ws.git.stage and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('git.stage', { workspaceId: 'ws-1', paths: ['a.ts', 'b.ts'] }, 2403),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2403, result: { ok: true, paths: ['a.ts'] } });
      expect(mockGitPeer.stage).toHaveBeenCalledWith(['a.ts', 'b.ts']);
    });

    it('returns INVALID_PARAMS when paths is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('git.stage', { workspaceId: 'ws-1' }, 2404),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });

    it('rejects "." path (surfaces builder policy error as INTERNAL_ERROR)', async () => {
      mockGitPeer.stage.mockRejectedValueOnce(
        new Error('Staging all files is not allowed. Please specify individual file paths to stage. Use git_status to see which files you have modified, then stage only those specific files.'),
      );
      const result = await handleWebSocketMessage(
        makeRequest('git.stage', { workspaceId: 'ws-1', paths: '.' }, 2405),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32603);
      expect(parsed.error.message).toContain('Staging all files is not allowed');
      expect(mockGitPeer.stage).toHaveBeenCalledWith('.');
    });

    it('rejects "*" path (surfaces builder policy error)', async () => {
      mockGitPeer.stage.mockRejectedValueOnce(new Error('Staging all files is not allowed.'));
      const result = await handleWebSocketMessage(
        makeRequest('git.stage', { workspaceId: 'ws-1', paths: '*' }, 2406),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32603);
      expect(mockGitPeer.stage).toHaveBeenCalledWith('*');
    });

    it('rejects "--all" path (surfaces builder policy error)', async () => {
      mockGitPeer.stage.mockRejectedValueOnce(new Error('Staging all files is not allowed.'));
      const result = await handleWebSocketMessage(
        makeRequest('git.stage', { workspaceId: 'ws-1', paths: 'foo --all' }, 2407),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32603);
      expect(mockGitPeer.stage).toHaveBeenCalledWith('foo --all');
    });
  });

  describe('git.commit (wave 2c)', () => {
    it('forwards params to ws.git.commit and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('git.commit', { workspaceId: 'ws-1', message: 'feat: x' }, 2408),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0',
        id: 2408,
        result: { ok: true, hash: 'abc1234', files: ['a.ts'] },
      });
      expect(mockGitPeer.commit).toHaveBeenCalledWith('feat: x');
    });

    it('returns INVALID_PARAMS when message is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('git.commit', { workspaceId: 'ws-1' }, 2409),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('git.agentCommit (wave 2c)', () => {
    it('forwards params to ws.git.agentCommit and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('git.agentCommit', {
          workspaceId: 'ws-1',
          message: 'feat: y',
          files: ['a.ts'],
          userRequested: true,
        }, 2410),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0',
        id: 2410,
        result: { ok: true, hash: 'def5678', files: ['a.ts'], fileCount: 1 },
      });
      expect(mockGitPeer.agentCommit).toHaveBeenCalledWith('feat: y', {
        files: ['a.ts'],
        userRequested: true,
      });
    });

    it('returns INVALID_PARAMS when message is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('git.agentCommit', { workspaceId: 'ws-1' }, 2411),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('git.checkMergeConflicts (wave 2c)', () => {
    it('forwards params to ws.git.checkMergeConflicts and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('git.checkMergeConflicts', { workspaceId: 'ws-1', targetBranch: 'main' }, 2412),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0',
        id: 2412,
        result: {
          hasConflicts: false,
          conflictedFiles: [],
          targetBranch: 'main',
          currentBranch: 'feature',
        },
      });
      expect(mockGitPeer.checkMergeConflicts).toHaveBeenCalledWith('main');
    });

    it('forwards undefined when targetBranch is omitted', async () => {
      await handleWebSocketMessage(
        makeRequest('git.checkMergeConflicts', { workspaceId: 'ws-1' }, 2413),
      );
      expect(mockGitPeer.checkMergeConflicts).toHaveBeenCalledWith(undefined);
    });
  });

  // =========================================================================
  // Track R, wave 2c — pr.* shims (active-PR scenarios use mockPrPeer)
  // =========================================================================

  describe('pr.merge (wave 2c)', () => {
    it('forwards params to ws.pr.merge and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.merge', {
          workspaceId: 'ws-1',
          mergeMethod: 'squash',
          commitTitle: 'T',
          commitMessage: 'M',
        }, 2501),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0',
        id: 2501,
        result: { merged: true, sha: 'merge-sha', mergeMethod: 'merge', message: 'merged', prNumber: 42 },
      });
      expect(mockPrPeer.merge).toHaveBeenCalledWith({
        mergeMethod: 'squash',
        commitTitle: 'T',
        commitMessage: 'M',
      });
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.merge', {}, 2502),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('pr.status (wave 2c)', () => {
    it('forwards to ws.pr.status and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.status', { workspaceId: 'ws-1' }, 2503),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.id).toBe(2503);
      expect(parsed.result.prNumber).toBe(42);
      expect(parsed.result.state).toBe('open');
      expect(mockPrPeer.status).toHaveBeenCalledWith();
    });

    it('surfaces "No active PR" as INTERNAL_ERROR when no PR is active', async () => {
      mockPrPeer.status.mockRejectedValueOnce(new Error('No active PR'));
      const result = await handleWebSocketMessage(
        makeRequest('pr.status', { workspaceId: 'ws-1' }, 2504),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32603);
      expect(parsed.error.message).toBe('No active PR');
    });
  });

  describe('pr.updateBranch (wave 2c)', () => {
    it('forwards to ws.pr.updateBranch and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.updateBranch', { workspaceId: 'ws-1' }, 2505),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0',
        id: 2505,
        result: { method: 'merge', alreadyUpToDate: false, message: 'updated', url: null },
      });
      expect(mockPrPeer.updateBranch).toHaveBeenCalledWith();
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.updateBranch', {}, 2506),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('pr.waitForChanges (wave 2c)', () => {
    it('forwards params to ws.pr.waitForChanges and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.waitForChanges', {
          workspaceId: 'ws-1',
          timeoutSeconds: 60,
          pollIntervalSeconds: 15,
          watch: 'checks',
        }, 2507),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.changed).toBe(true);
      expect(mockPrPeer.waitForChanges).toHaveBeenCalledWith({
        timeoutSeconds: 60,
        pollIntervalSeconds: 15,
        watch: 'checks',
      });
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.waitForChanges', {}, 2508),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('pr.listReviewComments (wave 2c)', () => {
    it('forwards params to ws.pr.listReviewComments and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.listReviewComments', {
          workspaceId: 'ws-1',
          path: 'src/a.ts',
          status: 'unresolved',
        }, 2509),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.result.threadCount).toBe(0);
      expect(mockPrPeer.listReviewComments).toHaveBeenCalledWith({
        path: 'src/a.ts',
        status: 'unresolved',
      });
    });

    it('forwards default options when none provided', async () => {
      await handleWebSocketMessage(
        makeRequest('pr.listReviewComments', { workspaceId: 'ws-1' }, 2510),
      );
      expect(mockPrPeer.listReviewComments).toHaveBeenCalledWith({
        path: undefined,
        status: undefined,
      });
    });
  });

  describe('pr.replyToReviewComment (wave 2c)', () => {
    it('forwards params to ws.pr.replyToReviewComment and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.replyToReviewComment', {
          workspaceId: 'ws-1',
          commentId: 123,
          body: 'reply text',
        }, 2511),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0',
        id: 2511,
        result: { id: 999, htmlUrl: 'https://example/reply' },
      });
      expect(mockPrPeer.replyToReviewComment).toHaveBeenCalledWith(123, 'reply text');
    });

    it('returns INVALID_PARAMS when body is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.replyToReviewComment', { workspaceId: 'ws-1', commentId: 123 }, 2512),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('pr.resolveThread (wave 2c)', () => {
    it('forwards params to ws.pr.resolveThread and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.resolveThread', {
          workspaceId: 'ws-1',
          threadId: 't-1',
          action: 'resolve',
        }, 2513),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0',
        id: 2513,
        result: { ok: true, threadId: 't-1', action: 'resolve' },
      });
      expect(mockPrPeer.resolveThread).toHaveBeenCalledWith('t-1', 'resolve');
    });

    it('returns INVALID_PARAMS when threadId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.resolveThread', { workspaceId: 'ws-1' }, 2514),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('pr.listComments (wave 2c)', () => {
    it('forwards params to ws.pr.listComments and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.listComments', { workspaceId: 'ws-1', count: 50 }, 2515),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2515, result: { count: 0, comments: [] } });
      expect(mockPrPeer.listComments).toHaveBeenCalledWith({ count: 50 });
    });

    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.listComments', {}, 2516),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('pr.postComment (wave 2c)', () => {
    it('forwards params to ws.pr.postComment and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.postComment', { workspaceId: 'ws-1', body: 'hello PR' }, 2517),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0',
        id: 2517,
        result: { id: 1001, htmlUrl: 'https://example/comment' },
      });
      expect(mockPrPeer.postComment).toHaveBeenCalledWith('hello PR');
    });

    it('returns INVALID_PARAMS when body is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('pr.postComment', { workspaceId: 'ws-1' }, 2518),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // Track R, wave 2d — script.*, browser.*, terminal.*, file.*, event.*,
  // crossWorkspace.*, primitive.* shim tests. Behaviour is covered by the
  // ws-script-api / ws-event-api / ws-misc-api / ws-note-api suites; here
  // we assert wire shape (1 happy-path + 1 INVALID_PARAMS per method).
  // =========================================================================

  describe('script.list (wave 2d)', () => {
    it('forwards to ws.script.list and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.list', { workspaceId: 'ws-1' }, 2700),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2700, result: [{ id: 's-1', name: 'dev' }] });
      expect(mockScriptPeer.list).toHaveBeenCalledWith();
    });
    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(makeRequest('script.list', {}, 2701));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('script.create (wave 2d)', () => {
    it('forwards params to ws.script.create and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.create', {
          workspaceId: 'ws-1',
          name: 'dev',
          command: 'pnpm dev',
          mode: 'service',
          cwd: '/app',
          env: { NODE_ENV: 'dev' },
          category: 'core',
          autoStart: true,
          scriptId: 's-1',
        }, 2702),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2702, result: { id: 's-new' } });
      expect(mockScriptPeer.create).toHaveBeenCalledWith('dev', 'pnpm dev', 'service', {
        cwd: '/app',
        env: { NODE_ENV: 'dev' },
        category: 'core',
        autoStart: true,
        scriptId: 's-1',
      });
    });
    it('returns INVALID_PARAMS when name is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.create', { workspaceId: 'ws-1', command: 'x', mode: 'command' }, 2703),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('script.remove (wave 2d)', () => {
    it('forwards params to ws.script.remove and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.remove', { workspaceId: 'ws-1', scriptId: 's-1' }, 2704),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2704, result: { ok: true, scriptId: 's-1' } });
      expect(mockScriptPeer.remove).toHaveBeenCalledWith('s-1');
    });
    it('returns INVALID_PARAMS when scriptId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.remove', { workspaceId: 'ws-1' }, 2705),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('script.start (wave 2d)', () => {
    it('forwards params to ws.script.start and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.start', { workspaceId: 'ws-1', scriptId: 's-1' }, 2706),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2706, result: { ok: true, scriptId: 's-1' } });
      expect(mockScriptPeer.start).toHaveBeenCalledWith('s-1');
    });
    it('returns INVALID_PARAMS when scriptId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.start', { workspaceId: 'ws-1' }, 2707),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('script.stop (wave 2d)', () => {
    it('forwards params to ws.script.stop and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.stop', { workspaceId: 'ws-1', scriptId: 's-1' }, 2708),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2708, result: { ok: true, scriptId: 's-1' } });
      expect(mockScriptPeer.stop).toHaveBeenCalledWith('s-1');
    });
    it('returns INVALID_PARAMS when scriptId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.stop', { workspaceId: 'ws-1' }, 2709),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('script.restart (wave 2d)', () => {
    it('forwards params to ws.script.restart and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.restart', { workspaceId: 'ws-1', scriptId: 's-1' }, 2710),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2710, result: { ok: true, scriptId: 's-1' } });
      expect(mockScriptPeer.restart).toHaveBeenCalledWith('s-1');
    });
    it('returns INVALID_PARAMS when scriptId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.restart', { workspaceId: 'ws-1' }, 2711),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('script.output (wave 2d)', () => {
    it('forwards params to ws.script.output and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.output', { workspaceId: 'ws-1', scriptId: 's-1', maxLines: 50 }, 2712),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2712, result: 'script output' });
      expect(mockScriptPeer.output).toHaveBeenCalledWith('s-1', 50);
    });
    it('returns INVALID_PARAMS when scriptId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.output', { workspaceId: 'ws-1' }, 2713),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('script.status (wave 2d)', () => {
    it('forwards params to ws.script.status and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.status', { workspaceId: 'ws-1', scriptId: 's-1' }, 2714),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2714, result: { id: 's-1', running: true } });
      expect(mockScriptPeer.status).toHaveBeenCalledWith('s-1');
    });
    it('returns INVALID_PARAMS when scriptId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.status', { workspaceId: 'ws-1' }, 2715),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('script.run (wave 2d)', () => {
    it('forwards params to ws.script.run and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.run', {
          workspaceId: 'ws-1',
          scriptId: 's-1',
          maxLines: 100,
          timeoutSeconds: 30,
        }, 2716),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2716, result: { exitCode: 0, output: 'done' } });
      expect(mockScriptPeer.run).toHaveBeenCalledWith('s-1', {
        maxLines: 100,
        timeout: undefined,
        timeoutSeconds: 30,
      });
    });
    it('returns INVALID_PARAMS when scriptId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('script.run', { workspaceId: 'ws-1' }, 2717),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('browser.exec (wave 2d)', () => {
    it('forwards params to ws.browser.exec and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('browser.exec', {
          workspaceId: 'ws-1',
          actions: [{ action: 'listTabs' }],
          tabId: 'tab-1',
        }, 2718),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2718, result: { ok: true, results: [] } });
      expect(mockBrowserPeer.exec).toHaveBeenCalledWith([{ action: 'listTabs' }], 'tab-1');
    });
    it('returns INVALID_PARAMS when actions is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('browser.exec', { workspaceId: 'ws-1' }, 2719),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('browser.docs (wave 2d)', () => {
    it('forwards params to ws.browser.docs and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('browser.docs', { workspaceId: 'ws-1', topic: 'overview' }, 2720),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2720, result: 'browser docs body' });
      expect(mockBrowserPeer.docs).toHaveBeenCalledWith('overview');
    });
    it('returns INVALID_PARAMS when topic is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('browser.docs', { workspaceId: 'ws-1' }, 2721),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('terminal.list (wave 2d)', () => {
    it('forwards to ws.terminal.list and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('terminal.list', { workspaceId: 'ws-1' }, 2722),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2722, result: [{ id: 't-1', title: 'bash' }] });
      expect(mockTerminalPeer.list).toHaveBeenCalledWith();
    });
    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(makeRequest('terminal.list', {}, 2723));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('terminal.readOutput (wave 2d)', () => {
    it('forwards params to ws.terminal.readOutput and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('terminal.readOutput', { workspaceId: 'ws-1', terminalId: 't-1', maxLines: 25 }, 2724),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2724, result: 'terminal output' });
      expect(mockTerminalPeer.readOutput).toHaveBeenCalledWith('t-1', 25);
    });
    it('returns INVALID_PARAMS when terminalId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('terminal.readOutput', { workspaceId: 'ws-1' }, 2725),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('file.read (wave 2d)', () => {
    it('forwards params to ws.file.read and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.read', { workspaceId: 'ws-1', path: 'a.ts' }, 2726),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2726, result: 'file body' });
      expect(mockFilePeer.read).toHaveBeenCalledWith('a.ts');
    });
    it('returns INVALID_PARAMS when path is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.read', { workspaceId: 'ws-1' }, 2727),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('file.write (wave 2d)', () => {
    it('forwards params to ws.file.write and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.write', { workspaceId: 'ws-1', path: 'a.ts', content: 'body' }, 2728),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2728, result: { ok: true, path: 'a.ts', size: 9 } });
      expect(mockFilePeer.write).toHaveBeenCalledWith('a.ts', 'body');
    });
    it('returns INVALID_PARAMS when content is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.write', { workspaceId: 'ws-1', path: 'a.ts' }, 2729),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('file.list (wave 2d)', () => {
    it('forwards params to ws.file.list and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.list', { workspaceId: 'ws-1', path: 'src' }, 2730),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2730, result: [{ name: 'a.ts', type: 'file' }] });
      expect(mockFilePeer.list).toHaveBeenCalledWith('src');
    });
    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(makeRequest('file.list', {}, 2731));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('file.delete (wave 2d)', () => {
    it('forwards params to ws.file.delete and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.delete', { workspaceId: 'ws-1', path: 'a.ts' }, 2732),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2732, result: { ok: true, path: 'a.ts', deleted: true } });
      expect(mockFilePeer.delete).toHaveBeenCalledWith('a.ts');
    });
    it('returns INVALID_PARAMS when path is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.delete', { workspaceId: 'ws-1' }, 2733),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('file.mkdir (wave 2d)', () => {
    it('forwards params to ws.file.mkdir and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.mkdir', { workspaceId: 'ws-1', path: 'dir' }, 2734),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2734, result: { ok: true, path: 'dir', created: true } });
      expect(mockFilePeer.mkdir).toHaveBeenCalledWith('dir');
    });
    it('returns INVALID_PARAMS when path is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.mkdir', { workspaceId: 'ws-1' }, 2735),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('file.rename (wave 2d)', () => {
    it('forwards params to ws.file.rename and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.rename', { workspaceId: 'ws-1', oldPath: 'a.ts', newPath: 'b.ts' }, 2736),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2736,
        result: { ok: true, oldPath: 'a.ts', newPath: 'b.ts' },
      });
      expect(mockFilePeer.rename).toHaveBeenCalledWith('a.ts', 'b.ts');
    });
    it('returns INVALID_PARAMS when newPath is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('file.rename', { workspaceId: 'ws-1', oldPath: 'a.ts' }, 2737),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('event.recentFiles (wave 2d)', () => {
    it('forwards params to ws.event.recentFiles and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('event.recentFiles', { workspaceId: 'ws-1', limit: 10 }, 2738),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2738, result: [{ path: 'a.ts' }] });
      expect(mockEventPeer.recentFiles).toHaveBeenCalledWith(10);
    });
    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(makeRequest('event.recentFiles', {}, 2739));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('event.agentActivity (wave 2d)', () => {
    it('forwards params to ws.event.agentActivity and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('event.agentActivity', { workspaceId: 'ws-1', agentId: 'a-1', minutesAgo: 5 }, 2740),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2740, result: [{ agentId: 'a-1', activity: 'idle' }],
      });
      expect(mockEventPeer.agentActivity).toHaveBeenCalledWith('a-1', 5);
    });
    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(makeRequest('event.agentActivity', {}, 2741));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('event.workspaceSummary (wave 2d)', () => {
    it('forwards params to ws.event.workspaceSummary and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('event.workspaceSummary', { workspaceId: 'ws-1', minutesAgo: 60 }, 2742),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2742, result: { events: 0 } });
      expect(mockEventPeer.workspaceSummary).toHaveBeenCalledWith(60);
    });
    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(makeRequest('event.workspaceSummary', {}, 2743));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('event.directoryChanges (wave 2d)', () => {
    it('forwards params to ws.event.directoryChanges and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('event.directoryChanges', { workspaceId: 'ws-1', dir: 'src', limit: 5 }, 2744),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2744, result: [{ path: 'a.ts', type: 'modified' }],
      });
      expect(mockEventPeer.directoryChanges).toHaveBeenCalledWith('src', 5);
    });
    it('returns INVALID_PARAMS when dir is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('event.directoryChanges', { workspaceId: 'ws-1' }, 2745),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('event.query (wave 2d)', () => {
    it('forwards params to ws.event.query and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('event.query', {
          workspaceId: 'ws-1',
          eventType: 'agent:*',
          minutesAgo: 30,
          limit: 50,
        }, 2746),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2746, result: [{ id: 'evt-1' }] });
      expect(mockEventPeer.query).toHaveBeenCalledWith({
        eventType: 'agent:*',
        minutesAgo: 30,
        limit: 50,
      });
    });
    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(makeRequest('event.query', {}, 2747));
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('event.subscribe (wave 2d)', () => {
    it('forwards params to ws.event.subscribe and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('event.subscribe', {
          workspaceId: 'ws-1',
          eventTypes: ['agent:*'],
          excludeSelf: true,
          batchWindow: 250,
        }, 2748),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2748,
        result: { subscriptionId: 'sub-1', eventTypes: ['agent:*'] },
      });
      expect(mockEventPeer.subscribe).toHaveBeenCalledWith(['agent:*'], {
        excludeSelf: true,
        batchWindow: 250,
      });
    });
    it('returns INVALID_PARAMS when eventTypes is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('event.subscribe', { workspaceId: 'ws-1' }, 2749),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('event.unsubscribe (wave 2d)', () => {
    it('forwards params to ws.event.unsubscribe and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('event.unsubscribe', { workspaceId: 'ws-1', subscriptionId: 'sub-1' }, 2750),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ jsonrpc: '2.0', id: 2750, result: { ok: true, subscriptionId: 'sub-1' } });
      expect(mockEventPeer.unsubscribe).toHaveBeenCalledWith('sub-1');
    });
    it('returns INVALID_PARAMS when subscriptionId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('event.unsubscribe', { workspaceId: 'ws-1' }, 2751),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('crossWorkspace.listSiblings (wave 2d)', () => {
    it('forwards to ws.crossWorkspace.listSiblings and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('crossWorkspace.listSiblings', { workspaceId: 'ws-1' }, 2752),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2752, result: [{ id: 'ws-2', title: 'Sibling' }],
      });
      expect(mockCrossWorkspacePeer.listSiblings).toHaveBeenCalledWith();
    });
    it('returns INVALID_PARAMS when workspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('crossWorkspace.listSiblings', {}, 2753),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('crossWorkspace.readNote (wave 2d)', () => {
    it('forwards params to ws.crossWorkspace.readNote and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('crossWorkspace.readNote', {
          workspaceId: 'ws-1',
          targetWorkspaceId: 'ws-2',
          noteId: 'note-x',
        }, 2754),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2754,
        result: { id: 'note-x', title: 'Cross Note', content: '' },
      });
      expect(mockCrossWorkspacePeer.readNote).toHaveBeenCalledWith('ws-2', 'note-x');
    });
    it('returns INVALID_PARAMS when noteId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('crossWorkspace.readNote', { workspaceId: 'ws-1', targetWorkspaceId: 'ws-2' }, 2755),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('crossWorkspace.listNotes (wave 2d)', () => {
    it('forwards params to ws.crossWorkspace.listNotes and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('crossWorkspace.listNotes', {
          workspaceId: 'ws-1',
          targetWorkspaceId: 'ws-2',
        }, 2756),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2756, result: [{ id: 'note-x', title: 'Cross Note' }],
      });
      expect(mockCrossWorkspacePeer.listNotes).toHaveBeenCalledWith('ws-2');
    });
    it('returns INVALID_PARAMS when targetWorkspaceId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('crossWorkspace.listNotes', { workspaceId: 'ws-1' }, 2757),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('primitive.addReference (wave 2d)', () => {
    it('forwards params to ws.primitive.addReference and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('primitive.addReference', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          semanticId: 'src/a.ts#L1-10',
          description: 'reference',
          snapshot: 'console.log()',
        }, 2758),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2758,
        result: { ok: true, primitiveId: 'prim-1', noteId: 'note-1' },
      });
      expect(mockNotePeers.primitive.addReference).toHaveBeenCalledWith(
        'note-1',
        'src/a.ts#L1-10',
        'reference',
        'console.log()',
      );
    });
    it('returns INVALID_PARAMS when semanticId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('primitive.addReference', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          description: 'reference',
        }, 2759),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('primitive.addCli (wave 2d)', () => {
    it('forwards params to ws.primitive.addCli and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('primitive.addCli', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          command: 'pnpm test',
          description: 'run tests',
          workingDirectory: '/app',
        }, 2760),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2760,
        result: { ok: true, primitiveId: 'prim-2', noteId: 'note-1' },
      });
      expect(mockNotePeers.primitive.addCli).toHaveBeenCalledWith(
        'note-1',
        'pnpm test',
        'run tests',
        '/app',
      );
    });
    it('returns INVALID_PARAMS when command is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('primitive.addCli', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          description: 'run tests',
        }, 2761),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('primitive.addPatch (wave 2d)', () => {
    it('forwards params to ws.primitive.addPatch and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('primitive.addPatch', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          filePath: 'src/a.ts',
          diff: '--- a\n+++ b',
          description: 'patch',
        }, 2762),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2762,
        result: { ok: true, primitiveId: 'prim-3', noteId: 'note-1' },
      });
      expect(mockNotePeers.primitive.addPatch).toHaveBeenCalledWith(
        'note-1',
        'src/a.ts',
        '--- a\n+++ b',
        'patch',
      );
    });
    it('returns INVALID_PARAMS when diff is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('primitive.addPatch', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          filePath: 'src/a.ts',
          description: 'patch',
        }, 2763),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  describe('primitive.addAgentAction (wave 2d)', () => {
    it('forwards params to ws.primitive.addAgentAction and returns peer result', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('primitive.addAgentAction', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          agentId: 'agent-1',
          goal: 'Run task',
          description: 'Action button',
        }, 2764),
      );
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({
        jsonrpc: '2.0', id: 2764,
        result: { ok: true, primitiveId: 'prim-4', noteId: 'note-1' },
      });
      expect(mockNotePeers.primitive.addAgentAction).toHaveBeenCalledWith(
        'note-1',
        'agent-1',
        'Run task',
        'Action button',
      );
    });
    it('returns INVALID_PARAMS when agentId is missing', async () => {
      const result = await handleWebSocketMessage(
        makeRequest('primitive.addAgentAction', {
          workspaceId: 'ws-1',
          noteId: 'note-1',
          goal: 'Run task',
          description: 'Action button',
        }, 2765),
      );
      const parsed = JSON.parse(result!);
      expect(parsed.error.code).toBe(-32602);
    });
  });

  // =========================================================================
  // JSON-RPC golden-snapshot — wire-format watchdog
  //
  // Captures request/response byte pairs for every method touched by the
  // Track R, wave 2a adapter scaffold. Any change to wire shape (method
  // names, params, response fields, error codes) will trip this suite and
  // surface the regression before clients break.
  // =========================================================================
  describe('Wire-format golden snapshots (Track R, wave 2a)', () => {
    interface Snapshot {
      name: string;
      request: { method: string; params?: any; id: number };
      // The full JSON-RPC response object — exact byte-for-byte expectation.
      expected: Record<string, any>;
      // Optional setup applied before the request is sent.
      setup?: () => void;
    }

    const snapshots: Snapshot[] = [
      {
        name: 'workspace.list (defaults)',
        request: { method: 'workspace.list', params: {}, id: 1001 },
        expected: { jsonrpc: '2.0', id: 1001, result: { workspaces: [{ id: 'ws-1', title: 'Test' }] } },
      },
      {
        name: 'workspace.list (includeArchived)',
        request: { method: 'workspace.list', params: { includeArchived: true }, id: 1002 },
        expected: { jsonrpc: '2.0', id: 1002, result: { workspaces: [{ id: 'ws-1', title: 'Test' }] } },
      },
      {
        name: 'workspace.get',
        request: { method: 'workspace.get', params: { workspaceId: 'ws-1' }, id: 1003 },
        expected: { jsonrpc: '2.0', id: 1003, result: { workspace: { id: 'ws-1', title: 'Test Workspace' } } },
      },
      {
        name: 'workspace.update',
        request: { method: 'workspace.update', params: { workspaceId: 'ws-1', title: 'X' }, id: 1004 },
        expected: { jsonrpc: '2.0', id: 1004, result: { workspace: { id: 'ws-1' } } },
      },
      {
        name: 'workspace.delete',
        request: { method: 'workspace.delete', params: { workspaceId: 'ws-1' }, id: 1005 },
        expected: { jsonrpc: '2.0', id: 1005, result: { success: true } },
      },
      {
        name: 'workspace.archive',
        request: { method: 'workspace.archive', params: { workspaceId: 'ws-1' }, id: 1006 },
        expected: { jsonrpc: '2.0', id: 1006, result: { success: true } },
      },
      {
        name: 'workspace.unarchive',
        request: { method: 'workspace.unarchive', params: { workspaceId: 'ws-1' }, id: 1007 },
        expected: { jsonrpc: '2.0', id: 1007, result: { success: true } },
      },
      {
        name: 'note.list',
        request: { method: 'note.list', params: { workspaceId: 'ws-1' }, id: 1008 },
        expected: { jsonrpc: '2.0', id: 1008, result: { notes: [{ id: 'note-1', title: 'Note 1' }] } },
      },
      {
        name: 'note.get',
        request: { method: 'note.get', params: { workspaceId: 'ws-1', noteId: 'note-1' }, id: 1009 },
        expected: { jsonrpc: '2.0', id: 1009, result: { note: { id: 'note-1', title: 'Note 1', content: 'hello' } } },
      },
      {
        name: 'note.create',
        request: { method: 'note.create', params: { workspaceId: 'ws-1', title: 'New Note', content: 'body' }, id: 1010 },
        expected: { jsonrpc: '2.0', id: 1010, result: { note: { id: 'note-new', title: 'New Note' } } },
      },
      {
        name: 'note.update (metadata branch)',
        request: { method: 'note.update', params: { workspaceId: 'ws-1', noteId: 'note-1', title: 'Updated' }, id: 1011 },
        expected: { jsonrpc: '2.0', id: 1011, result: { note: { id: 'note-1', title: 'Updated' } } },
      },
    ];

    for (const snap of snapshots) {
      it(`wire bytes match — ${snap.name}`, async () => {
        if (snap.setup) snap.setup();
        const result = await handleWebSocketMessage(makeRequest(snap.request.method, snap.request.params, snap.request.id));
        expect(result).not.toBeNull();
        const parsed = JSON.parse(result!);
        expect(parsed).toEqual(snap.expected);
      });
    }
  });
});

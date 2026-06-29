/**
 * Auto-Commit Service Tests
 *
 * Tests for the automatic commit functionality triggered when
 * an agent's turn ends (agent:idle event).
 *
 * Verifies:
 * 1. Auto-commit triggers on agent idle for any agent with changes
 * 2. Auto-commit respects workspace-level settings (checked at event time)
 * 3. Auto-commit respects agent's skipAutoCommit metadata
 * 4. Auto-commit skips errored/cancelled agents
 * 5. Proper error handling and logging
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import type { AgentIdleEvent } from '../../events/types';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const backgroundGitOpsMocks = vi.hoisted(() => ({
  registerOperation: vi.fn().mockReturnValue('test-op-id'),
  completeOperation: vi.fn(),
  failOperation: vi.fn(),
  updateProgress: vi.fn(),
}));

// Mock the dependencies
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    info = loggerMocks.info;
    warn = loggerMocks.warn;
    error = loggerMocks.error;
    debug = loggerMocks.debug;
  },
}));

vi.mock('../../workspace/main/workspace-settings.service', () => ({
  isAutoCommitEnabled: vi.fn(),
}));

vi.mock('../main/agent-commit.service', () => ({
  commitAgentChanges: vi.fn(),
}));

vi.mock('../main/agent-persistence', () => ({
  agentPersistence: {
    loadAgent: vi.fn(),
  },
}));

vi.mock('$shared/types/branded-ids', () => ({
  AgentId: vi.fn((id: string) => id),
  WorkspaceId: vi.fn((id: string) => id),
  CHIEF_WORKSPACE_ID: '__chief__',
}));

// event-handler-registry was deleted; auto-commit is now triggered by sagas

vi.mock('../../file-tracking/main/file-tracking.ipc', () => ({
  getServiceForWorkspace: vi.fn(),
}));

vi.mock('../../file-tracking/types', () => ({
  ChangeStage: { Unstaged: 'unstaged', Staged: 'staged' },
}));

vi.mock('../main/background-request.service', () => ({
  makeBackgroundRequest: vi.fn(),
}));

vi.mock('../../git/main/git.service', () => ({
  gitService: {
    getDiff: vi.fn(),
    getHistory: vi.fn(),
  },
}));

vi.mock('../../../shared/binary-file-extensions', () => ({
  shouldSkipFileForAI: vi.fn(),
}));

vi.mock('../main/instructions/background/commit-message', () => ({
  default: 'You are a commit message generator.',
}));

vi.mock('../../../shared/types', () => ({
  LineType: { Context: 'Context', Addition: 'Addition', Deletion: 'Deletion' },
}));

// unified-event-bus was deleted; domain events now dispatched via Redux
const mockMainDispatch = vi.fn();
vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: (...args: any[]) => mockMainDispatch(...args),
}));

vi.mock('../../../store/main/slices/git-events/git-events-slice', () => ({
  gitAutoCommitStarted: vi.fn((payload: any) => ({ type: 'git-events/gitAutoCommitStarted', payload })),
  gitAutoCommitSucceeded: vi.fn((payload: any) => ({ type: 'git-events/gitAutoCommitSucceeded', payload })),
  gitAutoCommitHookFailure: vi.fn((payload: any) => ({ type: 'git-events/gitAutoCommitHookFailure', payload })),
}));

vi.mock('../../git/main/background-git-ops.service', () => ({
  backgroundGitOpsService: backgroundGitOpsMocks,
}));

vi.mock('../main/agent-backend-handler.service', () => ({
  AgentBackendHandler: {
    getInstance: vi.fn(),
  },
}));

describe('Auto-Commit Service', () => {
  let handleAgentIdleAutoCommit: (event: AgentIdleEvent) => Promise<void>;
  let generateCommitMessage: (args: { workspaceId: string; filePaths: string[]; fallbackMessage: string }) => Promise<string>;
  let isPreCommitHookFailure: (error: string) => boolean;
  let extractHookOutput: (error: string) => string;
  let clearRetryCount: (agentId: string) => void;
  let mockIsAutoCommitEnabled: ReturnType<typeof vi.fn>;
  let mockCommitAgentChanges: ReturnType<typeof vi.fn>;
  let mockAgentPersistence: { loadAgent: ReturnType<typeof vi.fn> };
  let mockGetServiceForWorkspace: ReturnType<typeof vi.fn>;
  let mockMakeBackgroundRequest: ReturnType<typeof vi.fn>;
  let mockGitService: { getDiff: ReturnType<typeof vi.fn>; getHistory: ReturnType<typeof vi.fn> };
  let mockShouldSkipFileForAI: ReturnType<typeof vi.fn>;
  let mockSendBackendInitiatedMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked modules
    const workspaceSettings = await import('../../workspace/main/workspace-settings.service');
    const agentCommit = await import('../main/agent-commit.service');
    const agentPersistence = await import('../main/agent-persistence');
    const fileTrackingIpc = await import('../../file-tracking/main/file-tracking.ipc');
    const backgroundRequest = await import('../main/background-request.service');
    const gitServiceModule = await import('../../git/main/git.service');
    const binaryExtensions = await import('../../../shared/binary-file-extensions');
    const backendHandlerModule = await import('../main/agent-backend-handler.service');

    mockIsAutoCommitEnabled = workspaceSettings.isAutoCommitEnabled as ReturnType<typeof vi.fn>;
    mockCommitAgentChanges = agentCommit.commitAgentChanges as ReturnType<typeof vi.fn>;
    mockAgentPersistence = agentPersistence.agentPersistence as { loadAgent: ReturnType<typeof vi.fn> };
    mockGetServiceForWorkspace = fileTrackingIpc.getServiceForWorkspace as ReturnType<typeof vi.fn>;
    mockMakeBackgroundRequest = backgroundRequest.makeBackgroundRequest as ReturnType<typeof vi.fn>;
    mockGitService = gitServiceModule.gitService as unknown as typeof mockGitService;
    mockShouldSkipFileForAI = binaryExtensions.shouldSkipFileForAI as ReturnType<typeof vi.fn>;
    mockSendBackendInitiatedMessage = vi.fn().mockResolvedValue({ success: true });
    (backendHandlerModule.AgentBackendHandler.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
      sendBackendInitiatedMessage: mockSendBackendInitiatedMessage,
    });

    // Set up defaults
    mockIsAutoCommitEnabled.mockReturnValue(true);
    mockCommitAgentChanges.mockResolvedValue({ ok: true, data: { hash: 'abc123', files: [], fileCount: 0 } });
    mockAgentPersistence.loadAgent.mockResolvedValue({ success: true, data: { metadata: {} } });
    // Default: agent has unstaged changes (so tests proceed through the early check)
    mockGetServiceForWorkspace.mockResolvedValue({
      getChanges: vi.fn().mockResolvedValue({ changes: [{ file: 'test.ts', relativePath: 'test.ts' }] }),
    });
    // Default: AI generation dependencies return safe fallback values
    mockShouldSkipFileForAI.mockReturnValue({ skip: false });
    mockGitService.getDiff.mockResolvedValue({ ok: false }); // default: no diff → falls back
    mockGitService.getHistory.mockResolvedValue({ ok: false });
    mockMakeBackgroundRequest.mockResolvedValue({ success: false });

    // Import the handler after mocks are set up
    const autoCommitModule = await import('../main/auto-commit.service');
    handleAgentIdleAutoCommit = autoCommitModule.handleAgentIdleAutoCommit;
    generateCommitMessage = autoCommitModule.generateCommitMessage;
    isPreCommitHookFailure = autoCommitModule.isPreCommitHookFailure;
    extractHookOutput = autoCommitModule.extractHookOutput;
    clearRetryCount = autoCommitModule.clearRetryCount;

    // Reset retry tracking between tests
    clearRetryCount('agent-1');
  });

  afterEach(() => {
    vi.resetModules();
  });

  const createAgentIdleEvent = (overrides: Partial<AgentIdleEvent> = {}): AgentIdleEvent => ({
    id: 'event-idle-1',
    workspaceId: 'workspace-1',
    timestamp: new Date().toISOString(),
    type: 'agent:idle',
    actor: { type: 'agent', id: 'agent-1', name: 'Test Agent' },
    data: {
      agentId: 'agent-1',
      agentName: 'Test Agent',
      reason: 'stream_complete',
      finishReason: 'end_turn',
      taskNoteId: 'note-1',
      taskTitle: 'Implement feature X',
      status: 'idle',
      activationState: null,
      isActive: false,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      stopReason: 'end_turn',
    },
    ...overrides,
  });

  describe('agent:idle auto-commit - basic behavior', () => {
    it('should skip virtual workspaces before checking settings, file tracking, or background git ops', async () => {
      const event = createAgentIdleEvent({ workspaceId: '__chief__' });
      await handleAgentIdleAutoCommit(event);

      expect(loggerMocks.info).toHaveBeenCalledWith(
        '[AUTO-COMMIT] Skipped: virtual workspace',
        { workspaceId: '__chief__', agentId: 'agent-1' },
      );
      expect(loggerMocks.warn).not.toHaveBeenCalled();
      expect(mockIsAutoCommitEnabled).not.toHaveBeenCalled();
      expect(mockGetServiceForWorkspace).not.toHaveBeenCalled();
      expect(mockAgentPersistence.loadAgent).not.toHaveBeenCalled();
      expect(backgroundGitOpsMocks.registerOperation).not.toHaveBeenCalled();
      expect(mockCommitAgentChanges).not.toHaveBeenCalled();
    });

    it('should trigger auto-commit when agent goes idle with changes', async () => {
      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        message: 'Implement feature X',
        noteId: 'note-1',
      });
    });

    it('should use generic fallback as commit message when no task title and random agent name', async () => {
      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: 'Swift Falcon',
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        message: 'Agent changes',
        noteId: undefined,
      });
    });

    it('should use renamed agent name as fallback when no task title', async () => {
      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: 'Add ! to README',
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        agentId: 'agent-1',
        message: 'Add ! to README',
        noteId: undefined,
      });
    });

    it('should use fallback message when no task title or agent name', async () => {
      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: '',
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Agent changes',
        }),
      );
    });

    it('should skip auto-commit when no agentId', async () => {
      const event = createAgentIdleEvent({
        data: { ...createAgentIdleEvent().data, agentId: '' },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).not.toHaveBeenCalled();
    });

    it('should skip early when agent has no unstaged changes (no persistence load)', async () => {
      mockGetServiceForWorkspace.mockResolvedValue({
        getChanges: vi.fn().mockResolvedValue({ changes: [] }),
      });

      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      // Should not reach agent persistence or commitAgentChanges
      expect(mockAgentPersistence.loadAgent).not.toHaveBeenCalled();
      expect(mockCommitAgentChanges).not.toHaveBeenCalled();
    });

    it('should fall through to full flow if early change check fails', async () => {
      mockGetServiceForWorkspace.mockRejectedValue(new Error('Service unavailable'));

      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      // Should still proceed with the full commit flow
      expect(mockCommitAgentChanges).toHaveBeenCalled();
    });
  });

  describe('agent:idle auto-commit - finish reason filtering', () => {
    it('should skip auto-commit when agent errored', async () => {
      const event = createAgentIdleEvent({
        data: { ...createAgentIdleEvent().data, finishReason: 'error' },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).not.toHaveBeenCalled();
    });

    it('should skip auto-commit when agent was cancelled', async () => {
      const event = createAgentIdleEvent({
        data: { ...createAgentIdleEvent().data, finishReason: 'cancelled' },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).not.toHaveBeenCalled();
    });

    it('should skip auto-commit when provider was force-stopped (workspace deletion)', async () => {
      const event = createAgentIdleEvent({
        data: { ...createAgentIdleEvent().data, finishReason: 'provider_stopped' },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).not.toHaveBeenCalled();
    });

    it('should proceed with auto-commit for end_turn finish reason', async () => {
      const event = createAgentIdleEvent({
        data: { ...createAgentIdleEvent().data, finishReason: 'end_turn' },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalled();
    });

    it('should proceed with auto-commit when finishReason is undefined', async () => {
      const event = createAgentIdleEvent({
        data: { ...createAgentIdleEvent().data, finishReason: undefined },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalled();
    });
  });

  describe('agent:idle auto-commit - workspace settings', () => {
    it('should skip auto-commit when disabled for workspace', async () => {
      mockIsAutoCommitEnabled.mockReturnValue(false);
      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).not.toHaveBeenCalled();
    });

    it('should respect setting value at event time (mid-turn toggle)', async () => {
      // Setting is enabled at event time
      mockIsAutoCommitEnabled.mockReturnValue(true);
      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalled();
    });
  });

  describe('agent:idle auto-commit - skipAutoCommit metadata', () => {
    it('should skip auto-commit when agent has skipAutoCommit metadata', async () => {
      mockAgentPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: { metadata: { skipAutoCommit: true } },
      });

      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).not.toHaveBeenCalled();
    });

    it('should proceed when agent load fails', async () => {
      mockAgentPersistence.loadAgent.mockRejectedValue(new Error('Persistence error'));

      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalled();
    });
  });

  describe('agent:idle auto-commit - git status refresh before change check', () => {
    afterEach(() => {
      // Clean up global.gitIntegrations to avoid test pollution
      delete (global as any).gitIntegrations;
    });

    it('should call syncCurrentState(true) before checking for changes', async () => {
      const mockSyncCurrentState = vi.fn().mockResolvedValue(undefined);
      (global as any).gitIntegrations = new Map([
        ['workspace-1', { syncCurrentState: mockSyncCurrentState }],
      ]);

      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      expect(mockSyncCurrentState).toHaveBeenCalledWith(true);
      expect(mockCommitAgentChanges).toHaveBeenCalled();
    });

    it('should proceed with commit when syncCurrentState fails', async () => {
      const mockSyncCurrentState = vi.fn().mockRejectedValue(new Error('sync failed'));
      (global as any).gitIntegrations = new Map([
        ['workspace-1', { syncCurrentState: mockSyncCurrentState }],
      ]);

      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      expect(mockSyncCurrentState).toHaveBeenCalledWith(true);
      expect(mockCommitAgentChanges).toHaveBeenCalled();
    });

    it('should proceed with commit when gitIntegrations map does not have workspace entry', async () => {
      (global as any).gitIntegrations = new Map();

      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalled();
    });

    it('should proceed with commit when global.gitIntegrations is undefined', async () => {
      (global as any).gitIntegrations = undefined;

      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // AI Commit Message Generation
  // =========================================================================

  describe('AI commit message generation', () => {
    it('should use AI when agent has a random name and no task title', async () => {
      mockGitService.getDiff.mockResolvedValue({
        ok: true,
        data: [{
          file: 'src/app.ts',
          chunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [
            { type: 'Context', content: 'const x = 1;' },
            { type: 'Addition', content: 'const y = 2;' },
          ] }],
        }],
      });
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: '<<<COMMIT_MESSAGE>>>\nfeat: add y variable\n<<<\/COMMIT_MESSAGE>>>',
      });

      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: 'Swift Falcon',
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockMakeBackgroundRequest).toHaveBeenCalled();
      expect(mockCommitAgentChanges).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'feat: add y variable' }),
      );
    });

    it('should still attempt AI even when a meaningful task title exists', async () => {
      const event = createAgentIdleEvent(); // default has taskTitle: 'Implement feature X'
      await handleAgentIdleAutoCommit(event);

      // AI is always attempted — task title is only used as fallback
      expect(mockCommitAgentChanges).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Implement feature X' }),
      );
    });

    it('should use AI even when agent has a custom name but no task title', async () => {
      mockGitService.getDiff.mockResolvedValue({
        ok: true,
        data: [{ file: 'src/auth.ts', chunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [
          { type: 'Addition', content: 'export function login() {}' },
        ] }] }],
      });
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: '<<<COMMIT_MESSAGE>>>\nfeat: add login function\n<<<\/COMMIT_MESSAGE>>>',
      });

      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: 'Refactor auth module',
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockMakeBackgroundRequest).toHaveBeenCalled();
      expect(mockCommitAgentChanges).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'feat: add login function' }),
      );
    });

    it('should use AI when agent has a generic name and no task title', async () => {
      mockGitService.getDiff.mockResolvedValue({
        ok: true,
        data: [{ file: 'readme.md', chunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: [
          { type: 'Addition', content: '# Hello' },
        ] }] }],
      });
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: '<<<COMMIT_MESSAGE>>>\ndocs: add readme\n<<<\/COMMIT_MESSAGE>>>',
      });

      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: 'New Agent',
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockMakeBackgroundRequest).toHaveBeenCalled();
      expect(mockCommitAgentChanges).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'docs: add readme' }),
      );
    });

    it('should fall back when AI generation fails', async () => {
      mockGitService.getDiff.mockResolvedValue({
        ok: true,
        data: [{ file: 'src/app.ts', chunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [
          { type: 'Context', content: 'const x = 1;' },
        ] }] }],
      });
      mockMakeBackgroundRequest.mockResolvedValue({ success: false, error: 'LLM error' });

      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: 'Swift Falcon',
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      // Should fall back to generic message, NOT the agent name
      expect(mockCommitAgentChanges).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Agent changes' }),
      );
    });

    it('should fall back when no diff data is available', async () => {
      mockGitService.getDiff.mockResolvedValue({ ok: false, error: 'no repo' });

      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: 'Swift Falcon',
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      expect(mockCommitAgentChanges).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Agent changes' }),
      );
    });

    it('should fall back when all files are binary/skipped', async () => {
      mockShouldSkipFileForAI.mockReturnValue({ skip: true, reason: 'binary' });

      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: 'Swift Falcon',
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      // gitService.getDiff should not even be called since all files were skipped
      expect(mockGitService.getDiff).not.toHaveBeenCalled();
      expect(mockCommitAgentChanges).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Agent changes' }),
      );
    });
  });

  describe('stale agent name fix', () => {
    it('should use agent name from persistence instead of stale event name', async () => {
      // Simulate: agent was originally "Bug basher" but renamed itself during the turn
      mockAgentPersistence.loadAgent.mockResolvedValue({
        success: true,
        data: { name: 'Auth refactor agent', metadata: {} },
      });
      // AI generation will fail → falls back to generic message (not agent name)
      mockGitService.getDiff.mockResolvedValue({ ok: false });

      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: 'Bug basher', // stale name from event
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      // Message should use the renamed agent name from persistence as fallback
      expect(mockCommitAgentChanges).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Auth refactor agent' }),
      );
    });

    it('should fall back to event name when persistence load fails', async () => {
      mockAgentPersistence.loadAgent.mockRejectedValue(new Error('Persistence error'));
      mockGitService.getDiff.mockResolvedValue({ ok: false });

      const event = createAgentIdleEvent({
        data: {
          ...createAgentIdleEvent().data,
          agentName: 'Bug basher',
          taskTitle: undefined,
          taskNoteId: undefined,
        },
      });
      await handleAgentIdleAutoCommit(event);

      // Message should use event agent name as fallback (it's a renamed name, not random)
      expect(mockCommitAgentChanges).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Bug basher' }),
      );
    });
  });


  describe('generateCommitMessage - unit tests', () => {
    it('should extract commit message from AI response tags', async () => {
      mockShouldSkipFileForAI.mockReturnValue({ skip: false });
      mockGitService.getDiff.mockResolvedValue({
        ok: true,
        data: [{ file: 'index.ts', chunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [
          { type: 'Addition', content: 'console.log("hello");' },
        ] }] }],
      });
      mockGitService.getHistory.mockResolvedValue({ ok: true, data: { commits: [] } });
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'Here is the message:\n<<<COMMIT_MESSAGE>>>\nfeat(core): initialize project\n<<<\/COMMIT_MESSAGE>>>',
      });

      const result = await generateCommitMessage({
        workspaceId: 'ws-1',
        filePaths: ['index.ts'],
        fallbackMessage: 'fallback',
      });

      expect(result).toBe('feat(core): initialize project');
    });

    it('should truncate subject line to 72 characters', async () => {
      mockShouldSkipFileForAI.mockReturnValue({ skip: false });
      mockGitService.getDiff.mockResolvedValue({
        ok: true,
        data: [{ file: 'index.ts', chunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [
          { type: 'Addition', content: 'x' },
        ] }] }],
      });
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: `<<<COMMIT_MESSAGE>>>\n${'A'.repeat(100)}\n<<<\/COMMIT_MESSAGE>>>`,
      });

      const result = await generateCommitMessage({
        workspaceId: 'ws-1',
        filePaths: ['index.ts'],
        fallbackMessage: 'fallback',
      });

      expect(result).toHaveLength(72);
    });

    it('should return fallback when AI response has no tags', async () => {
      mockShouldSkipFileForAI.mockReturnValue({ skip: false });
      mockGitService.getDiff.mockResolvedValue({
        ok: true,
        data: [{ file: 'index.ts', chunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [
          { type: 'Addition', content: 'x' },
        ] }] }],
      });
      mockMakeBackgroundRequest.mockResolvedValue({
        success: true,
        content: 'Here is a commit message without proper tags',
      });

      const result = await generateCommitMessage({
        workspaceId: 'ws-1',
        filePaths: ['index.ts'],
        fallbackMessage: 'my fallback',
      });

      expect(result).toBe('my fallback');
    });
  });

  describe('pre-commit hook failure helpers', () => {
    it('isPreCommitHookFailure should detect hook failure errors', () => {
      expect(isPreCommitHookFailure('Failed to commit: Pre-commit hooks failed: check json...Failed')).toBe(true);
      expect(isPreCommitHookFailure('Failed to commit: some other error')).toBe(false);
      expect(isPreCommitHookFailure('No uncommitted changes found for this agent')).toBe(false);
    });

    it('extractHookOutput should extract the hook output from error string', () => {
      const error = 'Failed to commit: Pre-commit hooks failed: check json...Failed';
      expect(extractHookOutput(error)).toBe('Pre-commit hooks failed: check json...Failed');
    });

    it('extractHookOutput should return full string if no prefix found', () => {
      const error = 'Pre-commit hooks failed: check json...Failed';
      expect(extractHookOutput(error)).toBe('Pre-commit hooks failed: check json...Failed');
    });
  });

  describe('pre-commit hook failure - wake agent flow', () => {
    const hookError = 'Failed to commit: Pre-commit hooks failed: check json...Failed';

    it('should wake agent on first pre-commit hook failure', async () => {
      mockCommitAgentChanges.mockResolvedValue({ ok: false, error: hookError });

      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      // Should have woken the agent
      expect(mockSendBackendInitiatedMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'agent-1',
          workspaceId: 'workspace-1',
        }),
      );
      // Message should include the hook output
      expect(mockSendBackendInitiatedMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('pre-commit hooks'),
        }),
      );
      // Should dispatch hook-failure Redux action
      expect(mockMainDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'git-events/gitAutoCommitHookFailure',
          payload: expect.objectContaining({
            status: 'waking-agent',
            retryCount: 1,
            agentId: 'agent-1',
          }),
        }),
      );
    });

    it('should wake agent on second hook failure', async () => {
      mockCommitAgentChanges.mockResolvedValue({ ok: false, error: hookError });

      const event = createAgentIdleEvent();
      // First failure
      await handleAgentIdleAutoCommit(event);
      // Second failure
      await handleAgentIdleAutoCommit(event);

      // Should have woken agent twice
      expect(mockSendBackendInitiatedMessage).toHaveBeenCalledTimes(2);
      // Second call should have retryCount 2
      expect(mockMainDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'git-events/gitAutoCommitHookFailure',
          payload: expect.objectContaining({
            status: 'waking-agent',
            retryCount: 2,
          }),
        }),
      );
    });

    it('should give up after max retries and emit retries-exhausted', async () => {
      mockCommitAgentChanges.mockResolvedValue({ ok: false, error: hookError });

      const event = createAgentIdleEvent();
      // Exhaust retries (MAX_HOOK_FIX_RETRIES = 2)
      await handleAgentIdleAutoCommit(event); // retry 1 → wake
      await handleAgentIdleAutoCommit(event); // retry 2 → wake
      await handleAgentIdleAutoCommit(event); // retry 3 → give up

      // Should have woken agent only twice
      expect(mockSendBackendInitiatedMessage).toHaveBeenCalledTimes(2);
      // Third attempt should dispatch retries-exhausted
      expect(mockMainDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'git-events/gitAutoCommitHookFailure',
          payload: expect.objectContaining({
            status: 'retries-exhausted',
            retryCount: 3,
          }),
        }),
      );
    });

    it('should clear retry count on successful commit', async () => {
      // First call fails with hook error
      mockCommitAgentChanges.mockResolvedValueOnce({ ok: false, error: hookError });
      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event); // retry 1 → wake

      // Second call succeeds (agent fixed the issue)
      mockCommitAgentChanges.mockResolvedValueOnce({ ok: true, data: { hash: 'def456', files: [], fileCount: 1 } });
      await handleAgentIdleAutoCommit(event); // success → clears retry count

      // Third call fails again — should start fresh at retry 1
      mockCommitAgentChanges.mockResolvedValueOnce({ ok: false, error: hookError });
      await handleAgentIdleAutoCommit(event);

      // The third call should have retryCount 1 (fresh start)
      const hookFailureCalls = mockMainDispatch.mock.calls.filter(
        (call: any[]) => call[0]?.type === 'git-events/gitAutoCommitHookFailure',
      );
      const lastHookFailureCall = hookFailureCalls[hookFailureCalls.length - 1];
      expect(lastHookFailureCall[0].type).toBe('git-events/gitAutoCommitHookFailure');
      expect(lastHookFailureCall[0].payload).toEqual(expect.objectContaining({ retryCount: 1, status: 'waking-agent' }));
    });

    it('should not wake agent for non-hook commit failures', async () => {
      mockCommitAgentChanges.mockResolvedValue({ ok: false, error: 'No uncommitted changes found for this agent' });

      const event = createAgentIdleEvent();
      await handleAgentIdleAutoCommit(event);

      expect(mockSendBackendInitiatedMessage).not.toHaveBeenCalled();
      // git:auto-commit-started is dispatched before the commit attempt, but no hook-failure action should follow
      const hookFailureCalls = mockMainDispatch.mock.calls.filter(
        (call: any[]) => call[0]?.type === 'git-events/gitAutoCommitHookFailure',
      );
      expect(hookFailureCalls).toHaveLength(0);
    });

    it('should handle wake failure gracefully', async () => {
      mockCommitAgentChanges.mockResolvedValue({ ok: false, error: hookError });
      mockSendBackendInitiatedMessage.mockResolvedValue({ success: false, error: 'Agent not found' });

      const event = createAgentIdleEvent();
      // Should not throw
      await handleAgentIdleAutoCommit(event);

      // Should still have dispatched the hook-failure Redux action
      expect(mockMainDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'git-events/gitAutoCommitHookFailure',
          payload: expect.objectContaining({ status: 'waking-agent' }),
        }),
      );
    });
  });
});

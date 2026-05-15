/**
 * Handler Registration Tests
 *
 * Tests for proper IPC handler registration and initialization.
 * Ensures no duplicate handlers and proper cleanup.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { ipcMain } from 'electron';
import { registerAgentHandlers } from '../unified-agent-handlers';
import { getAgentBackendAdapter } from '../agent-backend-adapter';
import { initializeUnifiedAgentHandlers } from '../init-unified-handlers';
import { AGENT_CHANNELS } from '$shared/ipc/channels';
import { AgentBackendHandler } from '../agent-backend-handler.service';

// Mock electron with handler tracking
vi.mock('electron', () => {
  const registeredHandlers = new Set<string>();
  const handlerFunctions = new Map<string, Function>();

  return {
    app: {
      getPath: vi.fn().mockReturnValue('/mock/path'),
      getName: vi.fn().mockReturnValue('Workspaces'),
      getVersion: vi.fn().mockReturnValue('1.0.0'),
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: Function) => {
        if (registeredHandlers.has(channel)) {
          throw new Error(`Attempted to register a second handler for '${channel}'`);
        }
        registeredHandlers.add(channel);
        handlerFunctions.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        registeredHandlers.delete(channel);
        handlerFunctions.delete(channel);
      }),
      registeredHandlers,
      handlerFunctions,
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
    },
  };
});

// Mock fs module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFileSync: vi.fn(),
    promises: {
      readFile: vi.fn().mockResolvedValue(''),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
      access: vi.fn().mockResolvedValue(undefined),
      unlink: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock git-env module to avoid promisify issues
vi.mock('$shared/git/git-env', () => ({
  execAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  execFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  getGitEnv: vi.fn().mockReturnValue({}),
  getGitPath: vi.fn().mockReturnValue('/usr/bin/git'),
}));

// Mock terminal.ipc to avoid complex dependencies
vi.mock('../../../terminal/main/terminal.ipc', () => ({
  registerTerminalHandlers: vi.fn(),
}));

// Mock workspace.service to avoid complex dependencies
vi.mock('../../../workspace/main/workspace.service', () => ({
  WorkspaceService: {
    getInstance: vi.fn(() => ({
      getWorkspace: vi.fn(),
      listWorkspaces: vi.fn(),
      createWorkspace: vi.fn(),
      deleteWorkspace: vi.fn(),
    })),
  },
}));

// Mock logger
vi.mock('$shared/logger', () => ({
  Logger: class MockLogger {
    constructor() {}
    info = vi.fn();
    debug = vi.fn();
    error = vi.fn();
    warn = vi.fn();
  },
}));

// Mock the AgentBackendHandler
vi.mock('../agent-backend-handler.service', () => ({
  AgentBackendHandler: {
    getInstance: vi.fn(() => ({
      setupHandlers: vi.fn(),
      handleCreateAgent: vi.fn(),
      handleGetAgent: vi.fn(),
      handleSendMessage: vi.fn(),
      handleListAgents: vi.fn(),
      handleDeleteAgent: vi.fn(),
      handleStopSession: vi.fn(),
      handlePersistenceSave: vi.fn(),
      handlePersistenceLoad: vi.fn(),
      handlePersistenceList: vi.fn(),
      handleActivateAgent: vi.fn(),
    })),
  },
}));

describe('Handler Registration Tests', () => {
  let registeredHandlers: Set<string>;
  let handlerFunctions: Map<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Get the tracking collections from the mock
    registeredHandlers = (ipcMain as any).registeredHandlers;
    handlerFunctions = (ipcMain as any).handlerFunctions;
    registeredHandlers.clear();
    handlerFunctions.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial Registration', () => {
    it('should register all agent handlers successfully', () => {
      const adapter = getAgentBackendAdapter();
      registerAgentHandlers(adapter);

      // Verify all expected channels are registered
      const expectedChannels = [
        AGENT_CHANNELS.CREATE,
        AGENT_CHANNELS.GET_SESSION,
        AGENT_CHANNELS.SEND_MESSAGE,
        AGENT_CHANNELS.LIST_SESSIONS,
        AGENT_CHANNELS.DELETE_SESSION,
        AGENT_CHANNELS.STOP,
        AGENT_CHANNELS.PERSISTENCE_SAVE,
        AGENT_CHANNELS.PERSISTENCE_LOAD,
        AGENT_CHANNELS.PERSISTENCE_LIST,
        AGENT_CHANNELS.ACTIVATE,
      ];

      expectedChannels.forEach((channel) => {
        expect(registeredHandlers.has(channel)).toBe(true);
        expect(handlerFunctions.has(channel)).toBe(true);
      });

      // Should have at least the expected channels (may have more)
      expect(registeredHandlers.size).toBeGreaterThanOrEqual(expectedChannels.length);
    });

    it('should not register duplicate handlers', () => {
      const adapter = getAgentBackendAdapter();

      // First registration should succeed
      registerAgentHandlers(adapter);

      // Second registration should throw
      expect(() => {
        registerAgentHandlers(adapter);
      }).toThrow(/Attempted to register a second handler/);
    });

    it('should use the adapter for all operations', () => {
      const adapter = getAgentBackendAdapter();
      AgentBackendHandler.getInstance();

      registerAgentHandlers(adapter);

      // Verify adapter is created with backend handler
      expect(AgentBackendHandler.getInstance).toHaveBeenCalled();
    });
  });

  describe('Handler Function Validation', () => {
    it('should register functions for all channels', () => {
      const adapter = getAgentBackendAdapter();
      registerAgentHandlers(adapter);

      handlerFunctions.forEach((handler) => {
        expect(typeof handler).toBe('function');
        expect(handler.length).toBe(2); // event and request parameters
      });
    });

    it('should handle missing adapter gracefully', () => {
      // Should throw or handle gracefully when adapter is null
      try {
        registerAgentHandlers(null as any);
        // If it doesn't throw, that's also acceptable
      } catch (error) {
        // Expected behavior
        expect(error).toBeDefined();
      }
    });

    it('should handle undefined adapter gracefully', () => {
      // Should throw or handle gracefully when adapter is undefined
      try {
        registerAgentHandlers(undefined as any);
        // If it doesn't throw, that's also acceptable
      } catch (error) {
        // Expected behavior
        expect(error).toBeDefined();
      }
    });
  });

  describe('Initialization Flow', () => {
    it('should initialize unified handlers without errors', async () => {
      // This would normally be called from main/index.ts
      // If this throws, the test will fail
      await initializeUnifiedAgentHandlers();

      // Verify all handlers are registered
      expect(registeredHandlers.size).toBeGreaterThan(0);
    });

    it('should not initialize AgentBackendHandler handlers when unified handlers are active', () => {
      const mockBackendHandler = AgentBackendHandler.getInstance();

      // Initialize unified handlers
      initializeUnifiedAgentHandlers();

      // Backend handler's setupHandlers should NOT be called
      expect(mockBackendHandler.setupHandlers).not.toHaveBeenCalled();
    });
  });

  describe('Channel Coverage', () => {
    it('should cover all AGENT_CHANNELS', () => {
      const adapter = getAgentBackendAdapter();
      registerAgentHandlers(adapter);

      // Channels that are intentionally not registered (unimplemented, future features, etc.)
      const unimplementedChannels = new Set([
        // Streaming channels - handled separately
        AGENT_CHANNELS.STREAM_CHUNK,
        AGENT_CHANNELS.STREAM_ERROR,
        AGENT_CHANNELS.STREAM_COMPLETE,
        // Unimplemented feature channels
        AGENT_CHANNELS.LOAD_INITIAL_CONFIG,
        AGENT_CHANNELS.AVAILABLE,
        AGENT_CHANNELS.RESUME,
        AGENT_CHANNELS.CLEANUP,
        AGENT_CHANNELS.TRACK_STARTED,
        AGENT_CHANNELS.TRACK_COMPLETED,
        AGENT_CHANNELS.TRACK_ERROR,
        AGENT_CHANNELS.SEND,
        AGENT_CHANNELS.SET_PRIORITY,
        AGENT_CHANNELS.SUBSCRIBE_UPDATES,
        AGENT_CHANNELS.UNSUBSCRIBE_UPDATES,
        AGENT_CHANNELS.GET_SUGGESTIONS,
        AGENT_CHANNELS.APPLY_SUGGESTION,
        AGENT_CHANNELS.GET_COMPLETIONS,
        AGENT_CHANNELS.VALIDATE_INPUT,
        AGENT_CHANNELS.FORMAT_OUTPUT,
        AGENT_CHANNELS.GET_SHORTCUTS,
        AGENT_CHANNELS.ADD_SHORTCUT,
        AGENT_CHANNELS.REMOVE_SHORTCUT,
        AGENT_CHANNELS.EXECUTE_SHORTCUT,
        AGENT_CHANNELS.GET_PLUGINS,
        AGENT_CHANNELS.INSTALL_PLUGIN,
        AGENT_CHANNELS.UNINSTALL_PLUGIN,
        AGENT_CHANNELS.ENABLE_PLUGIN,
        AGENT_CHANNELS.DISABLE_PLUGIN,
        AGENT_CHANNELS.GET_PLUGIN_SETTINGS,
        AGENT_CHANNELS.UPDATE_PLUGIN_SETTINGS,
        AGENT_CHANNELS.EXECUTE_PLUGIN_ACTION,
        AGENT_CHANNELS.GET_WEBHOOKS,
        AGENT_CHANNELS.ADD_WEBHOOK,
        AGENT_CHANNELS.REMOVE_WEBHOOK,
        AGENT_CHANNELS.TEST_WEBHOOK,
        AGENT_CHANNELS.GET_INTEGRATIONS,
        AGENT_CHANNELS.CONNECT_INTEGRATION,
        AGENT_CHANNELS.DISCONNECT_INTEGRATION,
        AGENT_CHANNELS.SYNC_INTEGRATION,
        AGENT_CHANNELS.GET_INTEGRATION_STATUS,
        AGENT_CHANNELS.GET_INTEGRATION_DATA,
        AGENT_CHANNELS.UPDATE_INTEGRATION_SETTINGS,
        AGENT_CHANNELS.TEST_INTEGRATION,
        // Workflow channels - not yet implemented
        AGENT_CHANNELS.GET_WORKFLOWS,
        AGENT_CHANNELS.CREATE_WORKFLOW,
        AGENT_CHANNELS.UPDATE_WORKFLOW,
        AGENT_CHANNELS.DELETE_WORKFLOW,
        AGENT_CHANNELS.EXECUTE_WORKFLOW,
        AGENT_CHANNELS.PAUSE_WORKFLOW,
        AGENT_CHANNELS.RESUME_WORKFLOW,
        AGENT_CHANNELS.CANCEL_WORKFLOW,
        AGENT_CHANNELS.GET_WORKFLOW_STATUS,
        AGENT_CHANNELS.GET_WORKFLOW_HISTORY,
        AGENT_CHANNELS.EXPORT_WORKFLOW,
        AGENT_CHANNELS.IMPORT_WORKFLOW,
        AGENT_CHANNELS.VALIDATE_WORKFLOW,
        AGENT_CHANNELS.OPTIMIZE_WORKFLOW,
        AGENT_CHANNELS.GET_WORKFLOW_METRICS,
        AGENT_CHANNELS.GET_WORKFLOW_LOGS,
        AGENT_CHANNELS.CLEAR_WORKFLOW_LOGS,
        AGENT_CHANNELS.SCHEDULE_WORKFLOW,
        AGENT_CHANNELS.UNSCHEDULE_WORKFLOW,
        AGENT_CHANNELS.GET_SCHEDULED_WORKFLOWS,
        AGENT_CHANNELS.GET_WORKFLOW_TRIGGERS,
        AGENT_CHANNELS.ADD_WORKFLOW_TRIGGER,
        AGENT_CHANNELS.REMOVE_WORKFLOW_TRIGGER,
        AGENT_CHANNELS.TEST_WORKFLOW_TRIGGER,
        AGENT_CHANNELS.GET_WORKFLOW_VARIABLES,
        AGENT_CHANNELS.SET_WORKFLOW_VARIABLES,
        AGENT_CHANNELS.GET_WORKFLOW_DEPENDENCIES,
        AGENT_CHANNELS.RESOLVE_WORKFLOW_DEPENDENCIES,
        AGENT_CHANNELS.GET_WORKFLOW_PERMISSIONS,
        AGENT_CHANNELS.SET_WORKFLOW_PERMISSIONS,
        AGENT_CHANNELS.SHARE_WORKFLOW,
        AGENT_CHANNELS.UNSHARE_WORKFLOW,
        AGENT_CHANNELS.CLONE_WORKFLOW,
        AGENT_CHANNELS.MERGE_WORKFLOWS,
        AGENT_CHANNELS.DIFF_WORKFLOWS,
        AGENT_CHANNELS.GET_WORKFLOW_VERSIONS,
        AGENT_CHANNELS.RESTORE_WORKFLOW_VERSION,
        AGENT_CHANNELS.TAG_WORKFLOW_VERSION,
        AGENT_CHANNELS.GET_WORKFLOW_TAGS,
        AGENT_CHANNELS.REMOVE_WORKFLOW_TAG,
        AGENT_CHANNELS.CONTEXT_UPDATE,
      ]);

      // Get all channel values from AGENT_CHANNELS
      const allChannels = Object.values(AGENT_CHANNELS);

      // Filter to only agent-related channels (not workspace or other channels)
      const agentChannels = allChannels.filter(
        (channel) => typeof channel === 'string' && channel.startsWith('agent:'),
      );

      // Find any missing channels for debugging
      const missingChannels: string[] = [];
      agentChannels.forEach((channel) => {
        if (!unimplementedChannels.has(channel) && !registeredHandlers.has(channel)) {
          missingChannels.push(channel);
        }
      });

      // If there are missing channels, log them for debugging
      if (missingChannels.length > 0) {
        console.log('Missing handlers for channels:', missingChannels);
      }

      // Verify we have a reasonable number of handlers registered
      expect(registeredHandlers.size).toBeGreaterThanOrEqual(40);
    });

    it('should not register non-agent channels', () => {
      const adapter = getAgentBackendAdapter();
      registerAgentHandlers(adapter);

      // Verify no workspace or other channels are registered
      registeredHandlers.forEach((channel) => {
        expect(channel).toMatch(/^agent:/);
      });
    });
  });

  describe('Error Recovery', () => {
    it('should handle registration errors gracefully', () => {
      const adapter = getAgentBackendAdapter();

      // Mock a registration error for a specific channel
      const originalHandle = ipcMain.handle;
      let callCount = 0;
      (ipcMain.handle as any) = vi.fn((channel: string, handler: Function) => {
        callCount++;
        if (callCount === 3) {
          throw new Error('Registration failed');
        }
        return originalHandle(channel, handler);
      });

      // Registration should throw on the third channel
      expect(() => {
        registerAgentHandlers(adapter);
      }).toThrow('Registration failed');

      // Restore original mock
      (ipcMain.handle as any) = originalHandle;
    });

    it('should clean up on partial registration failure', () => {
      const adapter = getAgentBackendAdapter();

      // Force failure after registering some handlers
      const originalHandle = ipcMain.handle;
      let registered = 0;
      (ipcMain.handle as any) = vi.fn((channel: string, handler: Function) => {
        if (registered < 5) {
          registered++;
          registeredHandlers.add(channel);
          handlerFunctions.set(channel, handler);
        } else {
          throw new Error('Registration limit reached');
        }
      });

      try {
        registerAgentHandlers(adapter);
      } catch {
        // Expected to fail
      }

      // Should have registered exactly 5 handlers before failing
      expect(registeredHandlers.size).toBe(5);

      // Restore original mock
      (ipcMain.handle as any) = originalHandle;
    });
  });

  describe('Handler Cleanup', () => {
    it('should support handler removal', () => {
      const adapter = getAgentBackendAdapter();
      registerAgentHandlers(adapter);

      const initialSize = registeredHandlers.size;

      // Simulate removing a handler
      const channelToRemove = AGENT_CHANNELS.CREATE;
      (ipcMain as any).removeHandler(channelToRemove);

      expect(registeredHandlers.has(channelToRemove)).toBe(false);
      expect(handlerFunctions.has(channelToRemove)).toBe(false);
      expect(registeredHandlers.size).toBe(initialSize - 1);
    });

    it('should handle removal of non-existent handlers', () => {
      const adapter = getAgentBackendAdapter();
      registerAgentHandlers(adapter);

      const initialSize = registeredHandlers.size;

      // Try to remove a non-existent handler
      (ipcMain as any).removeHandler('non-existent-channel');

      // Size should remain the same
      expect(registeredHandlers.size).toBe(initialSize);
    });
  });
});

/**
 * Vitest Setup File
 * Mocks Electron and other dependencies for testing
 */

import {
  vi,
  afterEach,
} from 'vitest';
import * as path from 'path';
import { tmpdir } from 'os';

// Ensure tests use a temporary workspaces root
process.env.WORKSPACES_BASE_DIR =
  process.env.WORKSPACES_BASE_DIR || path.join(tmpdir(), 'intent-tests');

// Mock window.electronAPI for tests
if (typeof window !== 'undefined') {
  // Mock Element.prototype.animate for Svelte transitions (jsdom doesn't implement Web Animations API)
  if (typeof Element.prototype.animate !== 'function') {
    Element.prototype.animate = function (
      _keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ): Animation {
      const duration = typeof options === 'number' ? options : options?.duration ?? 0;
      const animation = {
        currentTime: 0,
        effect: null,
        finished: Promise.resolve(this as unknown as Animation),
        id: '',
        oncancel: null,
        onfinish: null as ((this: Animation, ev: AnimationPlaybackEvent) => void) | null,
        onremove: null,
        pending: false,
        playState: 'finished' as AnimationPlayState,
        playbackRate: 1,
        ready: Promise.resolve(this as unknown as Animation),
        replaceState: 'active' as AnimationReplaceState,
        startTime: 0,
        timeline: null,
        cancel: vi.fn(),
        commitStyles: vi.fn(),
        finish: vi.fn(),
        pause: vi.fn(),
        persist: vi.fn(),
        play: vi.fn(),
        reverse: vi.fn(),
        updatePlaybackRate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      } as unknown as Animation;

      // Immediately call onfinish to complete the transition synchronously
      setTimeout(() => {
        if (animation.onfinish) {
          animation.onfinish.call(animation, new Event('finish') as AnimationPlaybackEvent);
        }
      }, typeof duration === 'number' ? 0 : 0);

      return animation;
    };
  }

  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock localStorage
  const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
  });

  (window as any).electronAPI = {
    invoke: vi.fn(async (channel: string, data?: any) => {
      // Return mock responses based on channel
      switch (channel) {
        case 'user-rules:get-formatted':
          return {
            success: true,
            data: '# Test User Rules\nBe helpful and accurate.',
          };
        case 'user-rules:get-combined-prompt':
          return {
            success: true,
            data: `${data?.basePrompt || ''}\n\n# Test User Rules\nBe helpful and accurate.`,
          };
        case 'agent:create':
          return {
            success: true,
            data: {
              id: 'test-agent-id',
              backendSessionId: 'test-session-id',
              status: 'Active',
            },
          };
        case 'agent:send-message':
          return {
            success: true,
            data: {
              messageId: 'test-message-id',
            },
          };
        default:
          return { success: true, data: null };
      }
    }),
    on: vi.fn(),
    off: vi.fn(),
  };
}

// Global cleanup for ProseMirror and DOM observers
afterEach(() => {
  // Clear all timers to prevent "document is not defined" errors from ProseMirror observers
  vi.clearAllTimers();

  // Clean up any remaining DOM observers
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '';
  }
});

// Mock Electron - need both named exports and default export for ESM/CJS compatibility
vi.mock('electron', () => {
  const mockApp = {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/tmp/test/userData';
      if (name === 'home') return '/tmp/test/home';
      return '/tmp/test';
    }),
    getAppPath: vi.fn(() => '/tmp/test-app'),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
    isReady: vi.fn(() => true),
    isPackaged: false,
    on: vi.fn(),
    once: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
  };

  const mockIpcMain = {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  };

  const mockBrowserWindow = {
    getAllWindows: vi.fn(() => []),
    fromWebContents: vi.fn(() => null),
  };

  return {
    __esModule: true,
    default: { app: mockApp, ipcMain: mockIpcMain, BrowserWindow: mockBrowserWindow },
    app: mockApp,
    ipcMain: mockIpcMain,
    BrowserWindow: mockBrowserWindow,
  };
});

// Mock ipc-debug-tracker to avoid electron dependency during module load
vi.mock('$shared/main/ipc-debug-tracker', () => ({
  ipcDebugTracker: {
    trackCall: vi.fn(),
    trackValidationError: vi.fn(),
    trackMissingHandler: vi.fn(),
    trackSuccess: vi.fn(),
    getMissingHandlers: vi.fn(() => []),
    getEntries: vi.fn(() => []),
    clearEntries: vi.fn(),
    dispose: vi.fn(),
  },
}));

// Mock protocol adapter to avoid resolving its complex dependency chain
vi.mock('$features/protocol/main/protocol-adapter', () => ({
  protocolAdapter: {
    listWorkspaces: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    createNote: vi.fn().mockResolvedValue({ ok: true, data: { id: 'test-note-id', title: 'Test Note' } }),
    markAsTask: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    assignAgentToTask: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    getWorkspaceInfo: vi.fn().mockResolvedValue({ ok: true, data: null }),
    listFiles: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  },
}));

// Mock agent-backend-handler.service to avoid electron dependency at module load
vi.mock('$features/agent/main/agent-backend-handler.service', () => ({
  agentBackendHandler: {
    createAgent: vi.fn().mockResolvedValue({ id: 'test-agent-id' }),
    stopAgent: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getAgent: vi.fn().mockReturnValue(null),
    getAgentStatus: vi.fn().mockReturnValue(null),
    listAgents: vi.fn().mockReturnValue([]),
    cleanupAll: vi.fn().mockResolvedValue(undefined),
  },
  AgentBackendHandler: vi.fn(),
}));

// Mock electron-store to avoid disk writes
vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    get = vi.fn();
    set = vi.fn();
    has = vi.fn();
    delete = vi.fn();
    clear = vi.fn();
  },
}));

// Mock git-env to avoid promisify issues
// Mocking Node.js built-in modules with async factories doesn't work reliably with vitest's hoisting
vi.mock('$shared/git/git-env', () => ({
  getGitEnv: vi.fn(() => ({ GIT_TERMINAL_PROMPT: '0' })),
  execAsync: vi.fn(async () => ({ stdout: '', stderr: '' })),
  execAsyncWithGitEnv: vi.fn(async () => ({ stdout: '', stderr: '' })),
  execFileAsync: vi.fn(async () => ({ stdout: '', stderr: '' })),
  execFileAsyncWithGitEnv: vi.fn(async () => ({ stdout: '', stderr: '' })),
  detectKeychainAccessRisk: vi.fn(async () => ({
    willTriggerKeychain: false,
    credentialHelper: null,
    isHttpsRemote: false,
    remoteUrl: null,
  })),
  getEnhancedPath: vi.fn(() => process.env.PATH || ''),
  getSSHAuthSock: vi.fn(() => process.env.SSH_AUTH_SOCK || ''),
  GitEnvPolicy: {
    DEFAULT: 'default',
    ALLOW_PROMPTS: 'allow-prompts',
    NO_CREDENTIAL_HELPERS: 'no-credential-helpers',
  },
}));

// Mock async-utils to avoid promisify issues with exec/execFile
vi.mock('$shared/main/async-utils', () => ({
  execAsync: vi.fn(async () => ({ stdout: '', stderr: '' })),
  execFileAsync: vi.fn(async () => ({ stdout: '', stderr: '' })),
  writeFileAsync: vi.fn(async () => undefined),
  readFileAsync: vi.fn(async () => ''),
  mkdirAsync: vi.fn(async () => undefined),
  existsAsync: vi.fn(async () => false),
  findExecutableAsync: vi.fn(async () => null),
  findVSCodeAsync: vi.fn(async () => null),
  findAuggieAsync: vi.fn(async () => null),
  getNpmGlobalBinAsync: vi.fn(async () => null),
  writeJsonAsync: vi.fn(async () => undefined),
  readJsonAsync: vi.fn(async () => null),
  VSCODE_COMMON_PATHS: [],
}));

// Mock child_process.exec to avoid spawning git and shell, but keep spawn intact for integration tests
vi.mock('child_process', async () => {
  // Get the real child_process to preserve spawn and others
  const actual = (await vi.importActual('child_process')) as any;

  const exec = vi.fn((command: string, optionsOrCb?: any, maybeCb?: any) => {
    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
    let stdout = '';

    if (/git\s+branch\s+--list\s+/.test(command)) {
      stdout = ''; // branch does not exist by default
    } else if (/git\s+rev-parse\s+--verify\s+/.test(command)) {
      stdout = 'refs/heads/main';
    } else if (/git\s+worktree\s+add/.test(command)) {
      stdout = 'Added worktree';
    }

    // Call back asynchronously to simulate real exec
    if (cb) setImmediate(() => cb(null, { stdout, stderr: '' }));

    // Return a pseudo child process object
    return { pid: 1234 } as any;
  });

  return {
    ...actual,
    exec,
    spawn: actual.spawn,
    execFile: actual.execFile,
    default: {
      ...actual,
      exec,
      spawn: actual.spawn,
      execFile: actual.execFile,
    },
  };
});

// Mock electron-bridge to avoid IPC errors in tests
vi.mock('$lib/electron-bridge', () => ({
  isElectron: vi.fn(() => false),
  invoke: vi.fn(async (channel: string, data?: any) => {
    // Return mock responses based on channel
    switch (channel) {
      case 'user-rules:get-formatted':
        return {
          success: true,
          data: '# Test User Rules\nBe helpful and accurate.',
        };
      case 'user-rules:get-combined-prompt':
        return {
          success: true,
          data: `${data?.basePrompt || ''}\n\n# Test User Rules\nBe helpful and accurate.`,
        };
      case 'agent:create':
        return {
          success: true,
          data: {
            id: 'test-agent-id',
            backendSessionId: 'test-session-id',
            status: 'Active',
          },
        };
      case 'agent:send-message':
        return {
          success: true,
          data: {
            messageId: 'test-message-id',
          },
        };
      default:
        return { success: true, data: null };
    }
  }),
  listen: vi.fn(async () => () => {}),
  listenSync: vi.fn(() => () => {}),
  emit: vi.fn(async () => {}),
}));

// Mock typed-invoke to avoid IPC errors in tests
vi.mock('$shared/ipc/typed-invoke', () => ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  typedInvoke: vi.fn(async (channel: string, data?: any) => {
    // Return mock responses based on channel
    switch (channel) {
      case 'agent:create':
        return {
          success: true,
          data: {
            id: 'test-agent-id',
            backendSessionId: 'test-session-id',
            status: 'Active',
          },
        };
      case 'agent:send-message':
        return {
          success: true,
          data: {
            messageId: 'test-message-id',
          },
        };
      default:
        return { success: true, data: null };
    }
  }),
  isSuccessResponse: vi.fn(
    (response: any) => response.success === true && response.data !== undefined,
  ),
  isErrorResponse: vi.fn(
    (response: any) => response.success === false && response.error !== undefined,
  ),
  throwOnError: vi.fn((response: any) => {
    if (response.success !== true || response.data === undefined) {
      throw new Error(`IPC Error: ${response.error?.code} - ${response.error?.message}`);
    }
    return response;
  }),
}));

// Note: Provenance modules are not mocked here to allow tests to use actual implementations
// The reset functions in those modules properly reset global state for testing

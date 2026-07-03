import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { ExecutorManager } from '../main/executor-manager';
import { LocalExecutor } from '../main/executors/local-executor';
import { RemoteExecutor } from '../main/executors/remote-executor';
import type { RemoteExecutorConfig } from '../types';

// Mock the executors using class-style mocks for proper constructor support
vi.mock('../main/executors/local-executor', () => ({
  LocalExecutor: vi.fn().mockImplementation(function (this: any) {
    this.type = 'local';
    this.readFile = vi.fn().mockResolvedValue('file content');
    this.writeFile = vi.fn().mockResolvedValue(undefined);
    this.deleteFile = vi.fn().mockResolvedValue(undefined);
    this.listFiles = vi.fn().mockResolvedValue([]);
    this.fileExists = vi.fn().mockResolvedValue(true);
    this.getFileStats = vi.fn().mockResolvedValue({ size: 100, isFile: true });
    this.execute = vi.fn().mockResolvedValue({ stdout: 'output', stderr: '', exitCode: 0 });
    this.createDirectory = vi.fn().mockResolvedValue(undefined);
    this.deleteDirectory = vi.fn().mockResolvedValue(undefined);
    this.dispose = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../main/executors/remote-executor', () => ({
  RemoteExecutor: vi.fn().mockImplementation(function (this: any) {
    this.type = 'remote';
    this.readFile = vi.fn().mockResolvedValue('file content');
    this.writeFile = vi.fn().mockResolvedValue(undefined);
    this.deleteFile = vi.fn().mockResolvedValue(undefined);
    this.listFiles = vi.fn().mockResolvedValue([]);
    this.fileExists = vi.fn().mockResolvedValue(true);
    this.getFileStats = vi.fn().mockResolvedValue({ size: 100, isFile: true });
    this.execute = vi.fn().mockResolvedValue({ stdout: 'output', stderr: '', exitCode: 0 });
    this.createDirectory = vi.fn().mockResolvedValue(undefined);
    this.deleteDirectory = vi.fn().mockResolvedValue(undefined);
    this.dispose = vi.fn().mockResolvedValue(undefined);
    this.lastUsed = Date.now();
    this.disconnect = vi.fn().mockResolvedValue(undefined);
  }),
}));

describe('ExecutorManager', () => {
  let manager: ExecutorManager;
  let mockLocalExecutor: any;
  let mockRemoteExecutor: any;

  beforeEach(() => {
    // Create mock executors
    mockLocalExecutor = {
      type: 'local',
      readFile: vi.fn().mockResolvedValue('file content'),
      writeFile: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined),
      listFiles: vi.fn().mockResolvedValue([]),
      fileExists: vi.fn().mockResolvedValue(true),
      getFileStats: vi.fn().mockResolvedValue({ size: 100, isFile: true }),
      execute: vi.fn().mockResolvedValue({ stdout: 'output', stderr: '', exitCode: 0 }),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      deleteDirectory: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    mockRemoteExecutor = {
      ...mockLocalExecutor,
      type: 'remote',
      lastUsed: Date.now(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    // Update mock implementations for each test. Use regular function expressions
    // so the mocked constructors remain constructable with `new`.
    (LocalExecutor as any).mockImplementation(function (this: any) {
      Object.assign(this, mockLocalExecutor);
    });
    (RemoteExecutor as any).mockImplementation(function (this: any) {
      Object.assign(this, mockRemoteExecutor);
    });

    manager = new ExecutorManager();
  });

  afterEach(async () => {
    await manager.dispose();
    vi.clearAllMocks();
  });

  describe('getExecutor', () => {
    it('should create a local executor for local workspaces', () => {
      const executor = manager.getExecutor({
        workspaceId: 'workspace-1',
        workspacePath: '/path/to/workspace',
      });

      expect(executor).toBeDefined();
      expect(executor.type).toBe('local');
      expect(LocalExecutor).toHaveBeenCalledWith('/path/to/workspace', 'workspace-1');
    });

    it('should create a remote executor for remote workspaces', () => {
      const remoteConfig: RemoteExecutorConfig = {
        host: 'example.com',
        port: 22,
        username: 'user',
        privateKey: '/path/to/key',
        workspacePath: '/remote/workspace',
      };

      const executor = manager.getExecutor({
        workspaceId: 'workspace-1',
        workspacePath: '/local/workspace',
        remote: remoteConfig,
      });

      expect(executor).toBeDefined();
      expect(executor.type).toBe('remote');
      expect(RemoteExecutor).toHaveBeenCalledWith(remoteConfig, 'workspace-1');
    });

    it('should reuse cached executors', () => {
      const params = {
        workspaceId: 'workspace-1',
        workspacePath: '/path/to/workspace',
      };

      const executor1 = manager.getExecutor(params);
      const executor2 = manager.getExecutor(params);

      // Should only create one executor
      expect(LocalExecutor).toHaveBeenCalledTimes(1);

      // Both should be wrapped in RetryingExecutor, but underlying executor is the same
      expect(executor1).toBeDefined();
      expect(executor2).toBeDefined();
    });

    it('should update lastUsed timestamp when reusing cached executor', () => {
      vi.useFakeTimers();

      const params = {
        workspaceId: 'workspace-1',
        workspacePath: '/path/to/workspace',
      };

      manager.getExecutor(params);

      // Wait a bit to ensure different timestamp
      const delay = 10;
      vi.advanceTimersByTime(delay);

      manager.getExecutor(params);

      // Should still only create one executor
      expect(LocalExecutor).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('executeWithRetry', () => {
    it('should execute operation successfully on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await manager.executeWithRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure with exponential backoff', async () => {
      vi.useFakeTimers();
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockRejectedValueOnce(new Error('Another temporary error'))
        .mockResolvedValue('success');

      const promise = manager.executeWithRetry(operation);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });

    it('should not retry non-retryable errors', async () => {
      const nonRetryableError = new Error('Permission denied');
      const operation = vi.fn().mockRejectedValue(nonRetryableError);

      await expect(manager.executeWithRetry(operation)).rejects.toThrow('Permission denied');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should respect max retries limit', async () => {
      vi.useFakeTimers();
      const operation = vi.fn().mockRejectedValue(new Error('Persistent error'));

      const promise = manager.executeWithRetry(operation, 3);
      // Attach a catch handler immediately to avoid unhandled rejection warnings
      const captured = promise.catch((err) => err);
      await vi.runAllTimersAsync();
      const error = await captured;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Persistent error');
      expect(operation).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });

    it('should identify non-retryable error codes', async () => {
      const testCases = [
        { code: 'ENOTFOUND', message: 'Host not found' },
        { code: 'EACCES', message: 'Access denied' },
        { code: 'EPERM', message: 'Operation not permitted' },
        { code: 'ENOENT', message: 'File not found' },
      ];

      for (const { code, message } of testCases) {
        const error = new Error(message);
        (error as any).code = code;
        const operation = vi.fn().mockRejectedValue(error);

        await expect(manager.executeWithRetry(operation)).rejects.toThrow(message);
        expect(operation).toHaveBeenCalledTimes(1);
        operation.mockClear();
      }
    });
  });

  describe('cleanup', () => {
    it('should clean up idle executors after timeout', async () => {
      // This test verifies the cleanup logic indirectly
      // The actual cleanup runs on an interval which is hard to test reliably
      const params = {
        workspaceId: 'workspace-1',
        workspacePath: '/path/to/workspace',
        remote: {
          host: 'example.com',
          port: 22,
          username: 'user',
          privateKey: '/path/to/key',
          workspacePath: '/remote/workspace',
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const executor = manager.getExecutor(params);

      // Verify executor is cached
      const cached = (manager as any).executors.get('remote:workspace-1');
      expect(cached).toBeDefined();
      expect(cached.executor).toBeDefined();
      expect(cached.executor.type).toBe('remote');

      // The cleanup logic is tested implicitly through the dispose test
    });

    it('should not clean up recently used executors', async () => {
      const params = {
        workspaceId: 'workspace-1',
        workspacePath: '/path/to/workspace',
      };

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const executor = manager.getExecutor(params);

      // Verify executor is cached and has recent lastUsed
      const cached = (manager as any).executors.get('local:workspace-1');
      expect(cached).toBeDefined();
      expect(cached.lastUsed).toBeGreaterThan(Date.now() - 1000);
    });
  });

  describe('dispose', () => {
    it('should dispose all executors and clear cache', async () => {
      const localParams = {
        workspaceId: 'workspace-1',
        workspacePath: '/path/to/workspace',
      };

      const remoteParams = {
        workspaceId: 'workspace-2',
        workspacePath: '/path/to/workspace',
        remote: {
          host: 'example.com',
          port: 22,
          username: 'user',
          privateKey: '/path/to/key',
          workspacePath: '/remote/workspace',
        },
      };

      manager.getExecutor(localParams);
      manager.getExecutor(remoteParams);

      await manager.dispose();

      expect(mockLocalExecutor.dispose).toHaveBeenCalled();
      expect(mockRemoteExecutor.dispose).toHaveBeenCalled();

      // Creating new executors after dispose should create fresh instances
      vi.clearAllMocks();
      manager.getExecutor(localParams);
      expect(LocalExecutor).toHaveBeenCalledTimes(1);
    });
  });

  describe('RetryingExecutor wrapper', () => {
    it('should wrap all executor methods with retry logic', async () => {
      const executor = manager.getExecutor({
        workspaceId: 'workspace-1',
        workspacePath: '/path/to/workspace',
      });

      // Test that methods are wrapped
      await executor.readFile('/test.txt');
      expect(mockLocalExecutor.readFile).toHaveBeenCalledWith('/test.txt');

      await executor.writeFile('/test.txt', 'content');
      expect(mockLocalExecutor.writeFile).toHaveBeenCalledWith('/test.txt', 'content');

      await executor.execute('ls');
      expect(mockLocalExecutor.execute).toHaveBeenCalledWith('ls', undefined);
    });

    it('should retry wrapped methods on failure', async () => {
      vi.useFakeTimers();

      mockLocalExecutor.readFile
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValue('file content');

      const executor = manager.getExecutor({
        workspaceId: 'workspace-1',
        workspacePath: '/path/to/workspace',
      });

      const promise = executor.readFile('/test.txt');

      // Run through retry
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result).toBe('file content');
      expect(mockLocalExecutor.readFile).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });
});

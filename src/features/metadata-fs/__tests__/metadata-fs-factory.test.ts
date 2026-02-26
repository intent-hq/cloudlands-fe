import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mock fns are available inside the hoisted vi.mock factory
const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mocked = {
    ...actual,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  };
  return { ...mocked, default: mocked };
});

// Mock Logger (must be a class since it's used with `new`)
vi.mock('$shared/logger', () => ({
  Logger: class {
    info = vi.fn();
    debug = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Mock remote-rpc-manager (needed by RemoteMetadataFS constructor path)
vi.mock('$shared/main/remote-rpc-manager', () => ({
  remoteRPCManager: {
    getClient: vi.fn(),
  },
}));

// Spy on CachedRemoteMetadataFS constructor to verify config args
const { mockCachedRemoteConstructor } = vi.hoisted(() => ({
  mockCachedRemoteConstructor: vi.fn(),
}));

vi.mock('../main/cached-remote-metadata-fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../main/cached-remote-metadata-fs')>();
  class SpiedCachedRemoteMetadataFS extends actual.CachedRemoteMetadataFS {
    constructor(config: ConstructorParameters<typeof actual.CachedRemoteMetadataFS>[0]) {
      mockCachedRemoteConstructor(config);
      super(config);
    }
  }
  return { ...actual, CachedRemoteMetadataFS: SpiedCachedRemoteMetadataFS };
});

import { getMetadataFS, clearMetadataFSCache } from '../main/metadata-fs-factory';
import { LocalMetadataFS } from '../main/local-metadata-fs';
import { CachedRemoteMetadataFS } from '../main/cached-remote-metadata-fs';
import { WorkspaceConfig } from '$shared/main/config';

describe('getMetadataFS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMetadataFSCache();
  });

  it('returns LocalMetadataFS for a local workspace', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ isRemote: false }));

    const fs = getMetadataFS('local-workspace-id');

    expect(fs).toBeInstanceOf(LocalMetadataFS);
  });

  it('returns CachedRemoteMetadataFS for a remote workspace', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ isRemote: true }));

    const fs = getMetadataFS('remote-workspace-id');

    expect(fs).toBeInstanceOf(CachedRemoteMetadataFS);
  });

  it('defaults to LocalMetadataFS when workspace.json does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const fs = getMetadataFS('missing-workspace');

    expect(fs).toBeInstanceOf(LocalMetadataFS);
  });

  it('defaults to LocalMetadataFS when workspace.json is unreadable', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const fs = getMetadataFS('broken-workspace');

    expect(fs).toBeInstanceOf(LocalMetadataFS);
  });

  it('caches instances per workspace ID', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ isRemote: false }));

    const first = getMetadataFS('cached-ws');
    const second = getMetadataFS('cached-ws');

    expect(first).toBe(second);
    // Should only read the file once
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });

  it('returns different instances for different workspace IDs', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ isRemote: false }));

    const a = getMetadataFS('ws-a');
    const b = getMetadataFS('ws-b');

    expect(a).not.toBe(b);
  });

  it('clearMetadataFSCache resets the cache', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ isRemote: false }));

    const before = getMetadataFS('ws-clear');
    clearMetadataFSCache();
    const after = getMetadataFS('ws-clear');

    expect(before).not.toBe(after);
  });

  it('passes correct localBasePath and remoteBasePath to CachedRemoteMetadataFS', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ isRemote: true }));

    getMetadataFS('my-remote-ws');

    expect(mockCachedRemoteConstructor).toHaveBeenCalledWith({
      workspaceId: 'my-remote-ws',
      localBasePath: WorkspaceConfig.paths.metadata('my-remote-ws'),
      remoteBasePath: '~/intent/workspaces/my-remote-ws/.workspace',
    });
  });
});


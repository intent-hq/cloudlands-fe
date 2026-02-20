/**
 * Unit Tests for Mention Providers
 *
 * Tests FolderProvider, NoteProvider, TaskProvider, PersonalityProvider, RuleProvider, CommandProvider
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FolderProvider,
  NoteProvider,
  TaskProvider,
  PersonalityProvider,
  RuleProvider,
  CommandProvider,
} from '../../src/lib/services/mentions/providers';
import type { SearchContext } from '../../src/lib/services/mentions/types';

// Mock electron-bridge
vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(),
}));

describe('FolderProvider', () => {
  let provider: FolderProvider;
  let mockInvoke: any;

  beforeEach(async () => {
    provider = new FolderProvider();
    const electronBridge = await import('$lib/electron-bridge');
    mockInvoke = electronBridge.invoke as any;
    vi.clearAllMocks();
  });

  it('should have correct properties', () => {
    expect(provider.id).toBe('folder');
    expect(provider.triggers).toEqual(['@folder', '@dir']);
  });

  it('should return folders from workspace:list-files', async () => {
    // Mock workspace:get-by-id call
    mockInvoke.mockResolvedValueOnce({ success: true, data: { worktreePath: '/workspace/root' } });

    // Mock file:list call with folders
    mockInvoke.mockResolvedValueOnce({
      success: true,
      data: [
        { name: 'src', path: '/workspace/root/src', isFile: false },
        { name: 'lib', path: '/workspace/root/lib', isFile: false },
      ],
    });

    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      type: 'folder',
      label: 'src',
      icon: '📁',
    });
  });

  it('should use fallback folders when IPC fails', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('src', context);

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.label === 'src')).toBe(true);
  });

  it('should filter folders by query', async () => {
    mockInvoke.mockResolvedValue({ folders: [] });

    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('test', context);

    // Should filter fallback folders
    expect(results.every((r) => r.label.toLowerCase().includes('test'))).toBe(true);
  });
});

describe('NoteProvider', () => {
  let provider: NoteProvider;
  let mockInvoke: any;

  beforeEach(async () => {
    provider = new NoteProvider();
    const electronBridge = await import('$lib/electron-bridge');
    mockInvoke = electronBridge.invoke as any;
    vi.clearAllMocks();
  });

  it('should have correct properties', () => {
    expect(provider.id).toBe('note');
    expect(provider.triggers).toEqual(['@note', '@n']);
    expect(provider.supportsRanges).toBe(true);
  });

  it('should return notes from notes:list', async () => {
    const mockNotes = [
      { id: 'note-1', title: 'Spec', content: 'Specification' },
      { id: 'note-2', title: 'Plan', content: 'Planning doc' },
    ];

    mockInvoke.mockResolvedValue({ success: true, data: mockNotes });

    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      type: 'note',
      label: 'Spec',
      icon: '📝',
    });
  });

  it('should cache notes for synchronous access', async () => {
    const mockNotes = [{ id: 'note-1', title: 'Spec', content: 'Test' }];
    mockInvoke.mockResolvedValue({ success: true, data: mockNotes });

    const context: SearchContext = { workspaceId: 'test-workspace' };
    await provider.search('', context);

    // getCachedNotes should return the cached results
    const cached = provider.getCachedNotes();
    expect(cached).toHaveLength(1);
    expect(cached[0].label).toBe('Spec');
  });

  it('should return default notes when cache is expired', () => {
    // Don't populate cache, should return defaults
    const cached = provider.getCachedNotes();

    expect(cached.length).toBeGreaterThan(0);
    expect(cached.some((n) => n.id === 'spec')).toBe(true);
  });

  it('should use fallback notes when IPC fails', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(results.length).toBeGreaterThan(0);
  });
});

describe('TaskProvider', () => {
  let provider: TaskProvider;

  beforeEach(() => {
    provider = new TaskProvider();
  });

  it('should have correct properties', () => {
    expect(provider.id).toBe('task');
    expect(provider.triggers).toEqual(['@task', '@todo']);
  });

  it('should return mock tasks', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      type: 'task',
      icon: '📋',
    });
  });

  it('should filter tasks by query', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('auth', context);

    expect(results.every((r) => r.label.toLowerCase().includes('auth'))).toBe(true);
  });
});

describe('PersonalityProvider', () => {
  let provider: PersonalityProvider;

  beforeEach(() => {
    provider = new PersonalityProvider();
  });

  it('should have correct properties', () => {
    expect(provider.id).toBe('personality');
    expect(provider.triggers).toEqual(['@personality', '@persona']);
  });

  it('should return personality options', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      type: 'personality',
    });
  });

  it('should filter personalities by query', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('helper', context);

    expect(results.every((r) => r.label.toLowerCase().includes('helper'))).toBe(true);
  });

  it('should include promptToken in meta', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(results[0].meta?.promptToken).toBeDefined();
  });
});

describe('RuleProvider', () => {
  let provider: RuleProvider;

  beforeEach(() => {
    provider = new RuleProvider();
  });

  it('should have correct properties', () => {
    expect(provider.id).toBe('rule');
    expect(provider.triggers).toEqual(['@rule', '@augment']);
  });

  it('should return rule files', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      type: 'rule',
      icon: '📚',
    });
  });

  it('should filter rules by query', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('cli', context);

    expect(results.every((r) => r.label.toLowerCase().includes('cli'))).toBe(true);
  });

  it('should include path in meta', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(results[0].meta?.path).toBeDefined();
    expect(results[0].meta?.path).toContain('.augment/rules/');
  });
});

describe('CommandProvider', () => {
  let provider: CommandProvider;

  beforeEach(() => {
    provider = new CommandProvider();
  });

  it('should have correct properties', () => {
    expect(provider.id).toBe('command');
    expect(provider.triggers).toEqual(['@cmd', '@command']);
  });

  it('should return special commands', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      type: 'command',
    });
  });

  it('should include default context command', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    const hasDefaultContext = results.some((r) => r.id === 'use-default-context');
    expect(hasDefaultContext).toBe(true);
  });

  it('should include clear context command', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    const hasClearContext = results.some((r) => r.id === 'clear-context');
    expect(hasClearContext).toBe(true);
  });

  it('should filter commands by query', async () => {
    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('clear', context);

    expect(results.every((r) => r.label.toLowerCase().includes('clear'))).toBe(true);
  });
});

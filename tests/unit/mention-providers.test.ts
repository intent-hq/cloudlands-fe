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

// Mock the daemon transport (FolderProvider → search.fileNames)
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendReconnected: vi.fn(() => () => {}),
}));

// Mock the appClient (NoteProvider → note.list / workspace list)
vi.mock('$lib/client', () => ({
  appClient: {
    notes: { list: vi.fn() },
    workspaces: { list: vi.fn() },
  },
}));

describe('FolderProvider', () => {
  let provider: FolderProvider;
  let mockBackendRequest: any;

  beforeEach(async () => {
    provider = new FolderProvider();
    const transport = await import('$lib/client/live/backend-transport');
    mockBackendRequest = transport.backendRequest as any;
    vi.clearAllMocks();
  });

  it('should have correct properties', () => {
    expect(provider.id).toBe('folder');
    expect(provider.triggers).toEqual(['@folder', '@dir']);
  });

  it('should derive folders from search.fileNames results', async () => {
    mockBackendRequest.mockResolvedValueOnce({
      requestId: 'srch-1',
      files: ['src/main.ts', 'lib/util.ts'],
      truncated: false,
    });

    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(mockBackendRequest).toHaveBeenCalledWith('search.fileNames', {
      workspaceId: 'test-workspace',
      pattern: '',
      limit: 200,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      type: 'folder',
      label: 'src',
      icon: '📁',
    });
  });

  it('should return empty results when the daemon request fails — never fabricated data', async () => {
    mockBackendRequest.mockRejectedValue(new Error('daemon error'));

    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('src', context);

    expect(results).toEqual([]);
  });

  it('should return empty results without a workspaceId (no wire call)', async () => {
    const results = await provider.search('src', {} as SearchContext);

    expect(mockBackendRequest).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('should filter derived folders by query', async () => {
    mockBackendRequest.mockResolvedValueOnce({
      requestId: 'srch-1',
      files: ['tests/foo.test.ts', 'src/main.ts'],
      truncated: false,
    });

    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('test', context);

    expect(results.every((r) => r.label.toLowerCase().includes('test'))).toBe(true);
  });
});

describe('NoteProvider', () => {
  let provider: NoteProvider;
  let mockNotesList: any;
  let mockWorkspacesList: any;

  beforeEach(async () => {
    provider = new NoteProvider();
    const { appClient } = await import('$lib/client');
    mockNotesList = appClient.notes.list as any;
    mockWorkspacesList = appClient.workspaces.list as any;
    vi.clearAllMocks();
    mockWorkspacesList.mockResolvedValue([]);
  });

  it('should have correct properties', () => {
    expect(provider.id).toBe('note');
    expect(provider.triggers).toEqual(['@note', '@n']);
    expect(provider.supportsRanges).toBe(true);
  });

  it('should return notes from the live notes client (note.list)', async () => {
    const mockNotes = [
      { id: 'note-1', title: 'Spec', content: 'Specification' },
      { id: 'note-2', title: 'Plan', content: 'Planning doc' },
    ];

    mockNotesList.mockResolvedValue(mockNotes);

    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(mockNotesList).toHaveBeenCalledWith('test-workspace');
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      type: 'note',
      label: 'Spec',
      icon: '📝',
    });
  });

  it('should cache notes for synchronous access', async () => {
    const mockNotes = [{ id: 'note-1', title: 'Spec', content: 'Test' }];
    mockNotesList.mockResolvedValue(mockNotes);

    const context: SearchContext = { workspaceId: 'test-workspace' };
    await provider.search('', context);

    // getCachedNotes should return the cached results
    const cached = provider.getCachedNotes();
    expect(cached).toHaveLength(1);
    expect(cached[0].label).toBe('Spec');
  });

  it('should return no notes when cache is expired — never fabricated defaults', () => {
    // Don't populate cache; must NOT return fake default notes
    const cached = provider.getCachedNotes();

    expect(cached).toEqual([]);
  });

  it('should return empty results when the daemon request fails — never fabricated data', async () => {
    mockNotesList.mockRejectedValue(new Error('daemon error'));
    mockWorkspacesList.mockRejectedValue(new Error('daemon error'));

    const context: SearchContext = { workspaceId: 'test-workspace' };
    const results = await provider.search('', context);

    expect(results).toEqual([]);
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
    expect(provider.triggers).toEqual(['@rule', '@intent']);
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
    expect(results[0].meta?.path).toContain('.intent/rules/');
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

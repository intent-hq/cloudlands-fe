/**
 * Third-Party Sources Tests
 *
 * Tests for the third-party sources functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThirdPartySourcesService } from '../main/third-party-sources.service';
import { ThirdPartySourcesRepository } from '../main/third-party-sources.repository';
import { MetadataExtractor } from '../metadata-extractor';
import type { ThirdPartySource } from '../../../shared/types';
import { ThirdPartySourceType } from '../../../shared/types';
import * as fs from 'fs/promises';

// Mock dependencies
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  access: vi.fn(),
  unlink: vi.fn(),
}));

// Mock Redux store bridge (services now dispatch domain events via mainDispatch)
vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: any) => action),
  getMainStore: vi.fn(),
  getMainState: vi.fn(),
}));

vi.mock('../../../store/main/slices/source-events/source-events-slice', () => ({
  sourceCreated: vi.fn((payload: any) => ({ type: 'source-events/sourceCreated', payload })),
  sourceUpdated: vi.fn((payload: any) => ({ type: 'source-events/sourceUpdated', payload })),
  sourceDeleted: vi.fn((payload: any) => ({ type: 'source-events/sourceDeleted', payload })),
}));


describe('ThirdPartySourcesService', () => {
  let service: ThirdPartySourcesService;
  let repository: ThirdPartySourcesRepository;
  let metadataExtractor: MetadataExtractor;

  beforeEach(() => {
    repository = new ThirdPartySourcesRepository();
    metadataExtractor = new MetadataExtractor();

    // Mock repository methods
    vi.spyOn(repository, 'save').mockResolvedValue(undefined);
    vi.spyOn(repository, 'findById').mockResolvedValue(null);
    vi.spyOn(repository, 'findByWorkspace').mockResolvedValue([]);
    vi.spyOn(repository, 'delete').mockResolvedValue(undefined);

    // Mock metadata extractor
    vi.spyOn(metadataExtractor, 'extract').mockResolvedValue({
      ok: true,
      data: {
        title: 'Default Title',
        description: 'Default description',
        favicon: 'https://example.com/favicon.ico',
        metadata: {
          extractedContent: 'Default content',
        },
      },
    });

    service = new ThirdPartySourcesService(repository, metadataExtractor);

    // Mock fs methods
    (fs.mkdir as any).mockResolvedValue(undefined);
    (fs.writeFile as any).mockResolvedValue(undefined);
    (fs.readFile as any).mockResolvedValue('{}');
    (fs.readdir as any).mockResolvedValue([]);
    (fs.access as any).mockRejectedValue(new Error('Not found'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSource', () => {
    it('should create a new third-party source', async () => {
      const mockMetadata = {
        title: 'Test Issue',
        description: 'Test description',
        favicon: 'https://example.com/favicon.ico',
        metadata: {
          extractedContent: 'Test content',
        },
      };

      vi.spyOn(metadataExtractor, 'extract').mockResolvedValue({
        ok: true,
        data: mockMetadata,
      });

      const result = await service.createSource({
        workspaceId: 'test-workspace',
        url: 'https://linear.app/test/issue/TEST-123',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.url).toBe('https://linear.app/test/issue/TEST-123');
        expect(result.data.type).toBe('LinearIssue');
        expect(result.data.title).toBe('Test Issue');
        expect(result.data.description).toBe('Test description');
      }
    });

    it('should detect source type from URL', async () => {
      const testCases = [
        { url: 'https://linear.app/test/issue/TEST-123', expectedType: 'LinearIssue' },
        { url: 'https://github.com/owner/repo/issues/123', expectedType: 'github_issue' },
        { url: 'https://github.com/owner/repo/pull/456', expectedType: 'GithubPR' },
        { url: 'https://example.atlassian.net/browse/JIRA-789', expectedType: 'jira_ticket' },
        { url: 'https://docs.google.com/document/d/abc123', expectedType: 'google_doc' },
        { url: 'https://www.notion.so/page-123', expectedType: 'notion_page' },
        { url: 'https://example.com/random-page', expectedType: 'webpage' },
      ];

      for (const { url, expectedType } of testCases) {
        const result = await service.createSource({
          workspaceId: 'test-workspace',
          url,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.type).toBe(expectedType);
        }
      }
    });
  });

  describe('listByWorkspace', () => {
    it('should list sources for a workspace', async () => {
      const mockSources: ThirdPartySource[] = [
        {
          id: 'source-1',
          workspaceId: 'test-workspace',
          type: ThirdPartySourceType.LinearIssue,
          url: 'https://linear.app/test/issue/TEST-1',
          title: 'Test Issue 1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'source-2',
          workspaceId: 'test-workspace',
          type: ThirdPartySourceType.GitHubPR,
          url: 'https://github.com/owner/repo/pull/123',
          title: 'Test PR',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      // Mock the repository method to return the mock sources
      vi.spyOn(repository, 'findByWorkspace').mockResolvedValue(mockSources);

      const result = await service.listByWorkspace('test-workspace');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].id).toBe('source-1');
        expect(result.data[1].id).toBe('source-2');
      }
    });
  });

  describe('refreshMetadata', () => {
    it('should refresh metadata for a source', async () => {
      const existingSource: ThirdPartySource = {
        id: 'source-1',
        workspaceId: 'test-workspace',
        type: ThirdPartySourceType.LinearIssue,
        url: 'https://linear.app/test/issue/TEST-1',
        title: 'Old Title',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Mock the repository to return the existing source
      vi.spyOn(repository, 'findById').mockResolvedValue(existingSource);

      const newMetadata = {
        title: 'Updated Title',
        description: 'Updated description',
        favicon: 'https://example.com/new-favicon.ico',
        metadata: {
          extractedContent: 'Updated content',
        },
      };

      vi.spyOn(metadataExtractor, 'extract').mockResolvedValue({
        ok: true,
        data: newMetadata,
      });

      const result = await service.refreshMetadata('test-workspace', 'source-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.title).toBe('Updated Title');
        expect(result.data.description).toBe('Updated description');
      }
    });
  });
});

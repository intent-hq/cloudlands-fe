/**
 * Tests for RenameWorkspaceTool
 * Tests the logic for detecting when a workspace title is custom vs auto-generated
 */

import { describe, it, expect, vi } from 'vitest';
import { RenameWorkspaceTool } from '../workspace-management-tools';

describe('RenameWorkspaceTool', () => {
  describe('custom title detection', () => {
    it('should allow rename when title is empty', async () => {
      const mockProtocolAdapter = {
        getWorkspace: vi.fn().mockResolvedValue({
          id: 'package-create-2',
          title: '',
          branch: 'package-create-2',
        }),
        updateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      };

      const tool = new RenameWorkspaceTool(mockProtocolAdapter, 'package-create-2');

      const call = {
        arguments: { title: 'Add dark mode' },
        context: {},
      } as any;

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockProtocolAdapter.updateWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'package-create-2',
          title: 'Add dark mode',
        })
      );
    });

    it('should allow rename when title equals workspace ID (intent-based slug)', async () => {
      const mockProtocolAdapter = {
        getWorkspace: vi.fn().mockResolvedValue({
          id: 'package-create-2',
          title: 'package-create-2', // Title matches ID - not custom
          branch: 'package-create-2',
        }),
        updateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      };

      const tool = new RenameWorkspaceTool(mockProtocolAdapter, 'package-create-2');

      const call = {
        arguments: { title: 'Add dark mode' },
        context: {},
      } as any;

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockProtocolAdapter.updateWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'package-create-2',
          title: 'Add dark mode',
        })
      );
    });

    it('should allow rename when title equals random adjective-animal slug', async () => {
      const mockProtocolAdapter = {
        getWorkspace: vi.fn().mockResolvedValue({
          id: 'amber-forest',
          title: 'amber-forest', // Title matches random slug - not custom
          branch: 'amber-forest',
        }),
        updateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      };

      const tool = new RenameWorkspaceTool(mockProtocolAdapter, 'amber-forest');

      const call = {
        arguments: { title: 'Add dark mode' },
        context: {},
      } as any;

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockProtocolAdapter.updateWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'amber-forest',
          title: 'Add dark mode',
        })
      );
    });

    it('should skip rename when title differs from ID (user-set custom title)', async () => {
      const mockProtocolAdapter = {
        getWorkspace: vi.fn().mockResolvedValue({
          id: 'package-create-2',
          title: 'Fix login bug', // Different from ID - user-set custom title
          branch: 'fix-login-bug',
        }),
        updateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      };

      const tool = new RenameWorkspaceTool(mockProtocolAdapter, 'package-create-2');

      const call = {
        arguments: { title: 'Add dark mode' },
        context: {},
      } as any;

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockProtocolAdapter.updateWorkspace).not.toHaveBeenCalled();
      expect(result.content[0]?.text).toContain('already has a custom title');
      expect(result.content[0]?.text).toContain('Fix login bug');
    });

    it('should skip rename when workspace has meaningful custom title', async () => {
      const mockProtocolAdapter = {
        getWorkspace: vi.fn().mockResolvedValue({
          id: 'amber-forest',
          title: 'User Story: Add Search', // Custom title
          branch: 'add-search',
        }),
        updateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      };

      const tool = new RenameWorkspaceTool(mockProtocolAdapter, 'amber-forest');

      const call = {
        arguments: { title: 'Different title' },
        context: {},
      } as any;

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockProtocolAdapter.updateWorkspace).not.toHaveBeenCalled();
      expect(result.content[0]?.text).toContain('already has a custom title');
    });
  });

  describe('title with spaces', () => {
    it('should trim whitespace before comparing to ID', async () => {
      const mockProtocolAdapter = {
        getWorkspace: vi.fn().mockResolvedValue({
          id: 'package-create-2',
          title: 'package-create-2  ', // Extra spaces but same as ID
          branch: 'package-create-2',
        }),
        updateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
      };

      const tool = new RenameWorkspaceTool(mockProtocolAdapter, 'package-create-2');

      const call = {
        arguments: { title: 'Add dark mode' },
        context: {},
      } as any;

      const result = await tool.execute(call);

      expect(result.isError).toBe(false);
      expect(mockProtocolAdapter.updateWorkspace).toHaveBeenCalled();
    });
  });
});


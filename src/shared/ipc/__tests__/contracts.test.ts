/**
 * IPC Contracts Tests
 *
 * Tests for IPC type contracts and validation
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import type { AgentIpc, WorkspaceIpc, FileIpc, TerminalIpc, IpcResponse } from '../contracts';
import {
  AgentCreateRequestSchema,
  AgentGetRequestSchema,
  AgentSendMessageRequestSchema,
  AgentListRequestSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceGetRequestSchema,
  FileReadRequestSchema,
  FileWriteRequestSchema,
  TerminalCreateRequestSchema,
  TerminalWriteRequestSchema,
  validateIpcRequest,
  tryValidateIpcRequest,
} from '../request-validation';
import {
  AgentId,
  WorkspaceId,
} from '../../types/branded-ids';

describe('IPC Contracts', () => {
  describe('Agent IPC Contracts', () => {
    it('should validate agent create request', () => {
      const request: AgentIpc.CreateRequest = {
        workspaceId: WorkspaceId('550e8400-e29b-41d4-a716-446655440000'),
        workspacePath: '/path/to/workspace',
        name: 'Test Agent',
        model: 'gpt-4',
        systemPrompt: 'You are helpful',
      };

      const validated = AgentCreateRequestSchema.parse(request);
      expect(validated.name).toBe('Test Agent');
      expect(validated.workspacePath).toBe('/path/to/workspace');
    });

    it('should reject invalid workspace ID', () => {
      const request = {
        // Use a single word without hyphens - not a valid slug format
        workspaceId: 'invalid',
        workspacePath: '/path',
        name: 'Agent',
      };

      expect(() => AgentCreateRequestSchema.parse(request)).toThrow();
    });

    it('should validate agent get request', () => {
      const request: AgentIpc.GetRequest = {
        agentId: AgentId('550e8400-e29b-41d4-a716-446655440000'),
        workspaceId: WorkspaceId('550e8400-e29b-41d4-a716-446655440001'),
      };

      const validated = AgentGetRequestSchema.parse(request);
      expect(validated.agentId).toBeDefined();
    });

    it('should validate agent send message request', () => {
      const request: AgentIpc.SendMessageRequest = {
        agentId: AgentId('550e8400-e29b-41d4-a716-446655440000'),
        content: 'Hello agent',
      };

      const validated = AgentSendMessageRequestSchema.parse(request);
      expect(validated.content).toBe('Hello agent');
    });

    it('should reject empty message content', () => {
      const request = {
        agentId: AgentId('550e8400-e29b-41d4-a716-446655440000'),
        content: '',
      };

      expect(() => AgentSendMessageRequestSchema.parse(request)).toThrow();
    });

    it('should validate agent list request', () => {
      const request: AgentIpc.ListRequest = {
        workspaceId: WorkspaceId('550e8400-e29b-41d4-a716-446655440000'),
        includeDeleted: false,
      };

      const validated = AgentListRequestSchema.parse(request);
      expect(validated.includeDeleted).toBe(false);
    });
  });

  describe('Workspace IPC Contracts', () => {
    it('should validate workspace create request', () => {
      const request: WorkspaceIpc.CreateRequest = {
        title: 'My Workspace',
        path: '/path/to/workspace',
      };

      const validated = WorkspaceCreateRequestSchema.parse(request);
      expect(validated.title).toBe('My Workspace');
    });

    it('should allow empty workspace title (title is optional)', () => {
      // Title is optional in WorkspaceCreateRequestSchema - workspaces can start with blank titles
      const request = {
        title: '',
        path: '/path',
      };

      const validated = WorkspaceCreateRequestSchema.parse(request);
      expect(validated.title).toBe('');
    });

    it('should validate workspace get request', () => {
      const request: WorkspaceIpc.GetRequest = {
        workspaceId: WorkspaceId('550e8400-e29b-41d4-a716-446655440000'),
      };

      const validated = WorkspaceGetRequestSchema.parse(request);
      expect(validated.workspaceId).toBeDefined();
    });
  });

  describe('File IPC Contracts', () => {
    it('should validate file read request', () => {
      const request: FileIpc.ReadRequest = {
        path: '/path/to/file.txt',
        encoding: 'utf8',
      };

      const validated = FileReadRequestSchema.parse(request);
      expect(validated.path).toBe('/path/to/file.txt');
      expect(validated.encoding).toBe('utf8');
    });

    it('should validate file write request', () => {
      const request: FileIpc.WriteRequest = {
        path: '/path/to/file.txt',
        content: 'Hello world',
      };

      const validated = FileWriteRequestSchema.parse(request);
      expect(validated.content).toBe('Hello world');
    });
  });

  describe('Terminal IPC Contracts', () => {
    it('should validate terminal create request', () => {
      const request: TerminalIpc.CreateRequest = {
        workspaceId: WorkspaceId('550e8400-e29b-41d4-a716-446655440000'),
        cwd: '/home/user',
        shell: '/bin/bash',
      };

      const validated = TerminalCreateRequestSchema.parse(request);
      expect(validated.cwd).toBe('/home/user');
    });

    it('should validate terminal write request', () => {
      const request: TerminalIpc.WriteRequest = {
        terminalId: 'term-123',
        data: 'ls -la\n',
      };

      const validated = TerminalWriteRequestSchema.parse(request);
      expect(validated.data).toBe('ls -la\n');
    });
  });

  describe('Validation Functions', () => {
    it('should validate using validateIpcRequest', () => {
      const request = {
        workspaceId: '550e8400-e29b-41d4-a716-446655440000',
        workspacePath: '/path',
        name: 'Agent',
      };

      const validated = validateIpcRequest('agent:create', request);
      expect(validated.name).toBe('Agent');
    });

    it('should throw on invalid request', () => {
      const request = {
        workspaceId: 'invalid',
        workspacePath: '/path',
        name: 'Agent',
      };

      expect(() => validateIpcRequest('agent:create', request)).toThrow();
    });

    it('should return null on tryValidateIpcRequest error', () => {
      const request = {
        workspaceId: 'invalid',
        workspacePath: '/path',
        name: 'Agent',
      };

      const result = tryValidateIpcRequest('agent:create', request);
      expect(result).toBeNull();
    });
  });

  describe('IPC Response Types', () => {
    it('should create success response', () => {
      const response: IpcResponse<{ id: string }> = {
        success: true,
        data: { id: '123' },
      };

      expect(response.success).toBe(true);
      expect(response.data?.id).toBe('123');
    });

    it('should create error response', () => {
      const response: IpcResponse<any> = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      };

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('NOT_FOUND');
    });
  });
});

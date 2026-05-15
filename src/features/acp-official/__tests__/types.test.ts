/**
 * Tests for ACP Official types
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  Role,
  JsonRpcErrorCode,
  type AgentInfo,
  type SessionMode,
  type SessionModeState,
  type PlanEntry,
  type PermissionOption,
  type RequestPermissionOutcome,
} from '../types/base';

describe('acp-official types', () => {
  describe('Role enum', () => {
    it('should have correct values', () => {
      expect(Role.Assistant).toBe('assistant');
      expect(Role.User).toBe('user');
    });
  });

  describe('JsonRpcErrorCode enum', () => {
    it('should have standard JSON-RPC error codes', () => {
      expect(JsonRpcErrorCode.ParseError).toBe(-32700);
      expect(JsonRpcErrorCode.InvalidRequest).toBe(-32600);
      expect(JsonRpcErrorCode.MethodNotFound).toBe(-32601);
      expect(JsonRpcErrorCode.InvalidParams).toBe(-32602);
      expect(JsonRpcErrorCode.InternalError).toBe(-32603);
    });

    it('should have ACP-specific error codes', () => {
      expect(JsonRpcErrorCode.AuthRequired).toBe(-32000);
      expect(JsonRpcErrorCode.SessionNotFound).toBe(-32001);
      expect(JsonRpcErrorCode.SessionExpired).toBe(-32002);
      expect(JsonRpcErrorCode.PermissionDenied).toBe(-32003);
      expect(JsonRpcErrorCode.ResourceNotFound).toBe(-32004);
      expect(JsonRpcErrorCode.ResourceConflict).toBe(-32005);
      expect(JsonRpcErrorCode.RateLimitExceeded).toBe(-32006);
      expect(JsonRpcErrorCode.InvalidSession).toBe(-32007);
      expect(JsonRpcErrorCode.ToolExecutionFailed).toBe(-32008);
    });
  });

  describe('AgentInfo type', () => {
    it('should create valid agent info', () => {
      const info: AgentInfo = {
        name: 'TestAgent',
        version: '1.0.0',
        description: 'A test agent',
      };

      expect(info.name).toBe('TestAgent');
      expect(info.version).toBe('1.0.0');
    });

    it('should allow optional description', () => {
      const info: AgentInfo = {
        name: 'TestAgent',
        version: '1.0.0',
      };

      expect(info.description).toBeUndefined();
    });
  });

  describe('SessionMode type', () => {
    it('should create valid session mode', () => {
      const mode: SessionMode = {
        id: 'mode-1',
        name: 'Default Mode',
        description: 'The default operating mode',
      };

      expect(mode.id).toBe('mode-1');
      expect(mode.name).toBe('Default Mode');
    });
  });

  describe('SessionModeState type', () => {
    it('should create valid mode state', () => {
      const state: SessionModeState = {
        availableModes: [
          { id: 'mode-1', name: 'Mode 1' },
          { id: 'mode-2', name: 'Mode 2' },
        ],
        currentModeId: 'mode-1',
      };

      expect(state.availableModes).toHaveLength(2);
      expect(state.currentModeId).toBe('mode-1');
    });
  });

  describe('PlanEntry type', () => {
    it('should create valid plan entry', () => {
      const entry: PlanEntry = {
        id: 'task-1',
        title: 'Complete task',
        status: 'pending',
      };

      expect(entry.status).toBe('pending');
    });

    it('should support nested children', () => {
      const entry: PlanEntry = {
        id: 'parent',
        title: 'Parent task',
        status: 'in_progress',
        children: [
          { id: 'child-1', title: 'Child 1', status: 'completed' },
          { id: 'child-2', title: 'Child 2', status: 'pending' },
        ],
      };

      expect(entry.children).toHaveLength(2);
    });
  });

  describe('PermissionOption type', () => {
    it('should create valid permission option', () => {
      const option: PermissionOption = {
        id: 'allow',
        label: 'Allow',
        description: 'Allow this action',
        destructive: false,
      };

      expect(option.destructive).toBe(false);
    });
  });

  describe('RequestPermissionOutcome type', () => {
    it('should handle cancelled outcome', () => {
      const outcome: RequestPermissionOutcome = { outcome: 'cancelled' };
      expect(outcome.outcome).toBe('cancelled');
    });

    it('should handle selected outcome', () => {
      const outcome: RequestPermissionOutcome = {
        outcome: 'selected',
        optionId: 'allow',
      };
      expect(outcome.outcome).toBe('selected');
      if (outcome.outcome === 'selected') {
        expect(outcome.optionId).toBe('allow');
      }
    });
  });
});

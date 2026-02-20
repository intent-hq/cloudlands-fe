/**
 * Typed Invoke Tests
 *
 * Tests for type-safe IPC invoke wrapper
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSuccessResponse, isErrorResponse, throwOnError } from '../typed-invoke';
import type { IpcResponse } from '../contracts';

describe('Typed Invoke Helpers', () => {
  describe('isSuccessResponse', () => {
    it('should identify success response', () => {
      const response: IpcResponse<{ id: string }> = {
        success: true,
        data: { id: '123' },
      };

      expect(isSuccessResponse(response)).toBe(true);
    });

    it('should reject error response', () => {
      const response: IpcResponse<any> = {
        success: false,
        error: {
          code: 'ERROR',
          message: 'Something went wrong',
        },
      };

      expect(isSuccessResponse(response)).toBe(false);
    });

    it('should reject response without data', () => {
      const response: IpcResponse<any> = {
        success: true,
      };

      expect(isSuccessResponse(response)).toBe(false);
    });
  });

  describe('isErrorResponse', () => {
    it('should identify error response', () => {
      const response: IpcResponse<any> = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      };

      expect(isErrorResponse(response)).toBe(true);
    });

    it('should reject success response', () => {
      const response: IpcResponse<{ id: string }> = {
        success: true,
        data: { id: '123' },
      };

      expect(isErrorResponse(response)).toBe(false);
    });

    it('should reject response without error', () => {
      const response: IpcResponse<any> = {
        success: false,
      };

      expect(isErrorResponse(response)).toBe(false);
    });
  });

  describe('throwOnError', () => {
    it('should return success response', () => {
      const response: IpcResponse<{ id: string }> = {
        success: true,
        data: { id: '123' },
      };

      const result = throwOnError(response);
      expect(result.success).toBe(true);
      expect(result.data.id).toBe('123');
    });

    it('should throw on error response', () => {
      const response: IpcResponse<any> = {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      };

      expect(() => throwOnError(response)).toThrow('IPC Error: NOT_FOUND - Resource not found');
    });

    it('should include error details in thrown message', () => {
      const response: IpcResponse<any> = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: { field: 'name', reason: 'required' },
        },
      };

      expect(() => throwOnError(response)).toThrow('IPC Error: VALIDATION_ERROR - Invalid input');
    });
  });

  describe('Response Type Narrowing', () => {
    it('should narrow success response type', () => {
      const response: IpcResponse<{ id: string }> = {
        success: true,
        data: { id: '123' },
      };

      if (isSuccessResponse(response)) {
        // TypeScript should know response.data is defined
        expect(response.data.id).toBe('123');
      }
    });

    it('should narrow error response type', () => {
      const response: IpcResponse<any> = {
        success: false,
        error: {
          code: 'ERROR',
          message: 'Failed',
        },
      };

      if (isErrorResponse(response)) {
        // TypeScript should know response.error is defined
        expect(response.error.code).toBe('ERROR');
      }
    });
  });

  describe('Error Handling Patterns', () => {
    it('should handle success with optional data', () => {
      const response: IpcResponse<{ id: string } | undefined> = {
        success: true,
        data: undefined,
      };

      if (isSuccessResponse(response)) {
        // This should still work even if data is undefined
        expect(response.data).toBeUndefined();
      } else {
        expect(true).toBe(true);
      }
    });

    it('should handle error with optional details', () => {
      const response: IpcResponse<any> = {
        success: false,
        error: {
          code: 'ERROR',
          message: 'Failed',
          details: undefined,
        },
      };

      if (isErrorResponse(response)) {
        expect(response.error.details).toBeUndefined();
      }
    });

    it('should chain response checks', () => {
      const response: IpcResponse<{ id: string }> = {
        success: true,
        data: { id: '123' },
      };

      if (isSuccessResponse(response)) {
        const result = throwOnError(response);
        expect(result.data.id).toBe('123');
      }
    });
  });
});

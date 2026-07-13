/**
 * IPC Response Formatter Tests
 *
 * Tests for consistent error and success response formatting
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  formatIpcSuccess,
  formatIpcError,
} from '../ipc-response-formatter';
import { ZodError } from 'zod';

describe('IPC Response Formatter', () => {
  describe('formatIpcSuccess', () => {
    it('should format success response with data', () => {
      const data = { id: '123', name: 'Test' };
      const response = formatIpcSuccess(data);

      expect(response.success).toBe(true);
      expect(response.data).toEqual(data);
      expect(response.error).toBeUndefined();
    });

    it('should format success response with null data', () => {
      const response = formatIpcSuccess(null);

      expect(response.success).toBe(true);
      expect(response.data).toBeNull();
    });

    it('should format success response with undefined data', () => {
      const response = formatIpcSuccess(undefined);

      expect(response.success).toBe(true);
      expect(response.data).toBeUndefined();
    });
  });

  describe('formatIpcError', () => {
    it('should format Error with message', () => {
      const error = new Error('Something went wrong');
      const response = formatIpcError(error, 'test:channel');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('INTERNAL_ERROR');
      expect(response.error?.message).toBe('Something went wrong');
    });

    it('should format string error', () => {
      const response = formatIpcError('String error message', 'test:channel');

      expect(response.success).toBe(false);
      expect(response.error?.message).toBe('String error message');
    });

    it('should format unknown error', () => {
      const response = formatIpcError({}, 'test:channel');

      expect(response.success).toBe(false);
      expect(response.error?.message).toBe('An unknown error occurred');
    });

    it('should include stack trace in details', () => {
      const error = new Error('Test error');
      const response = formatIpcError(error);

      expect(response.error?.details?.stack).toBeDefined();
      expect(response.error?.details?.stack).toContain('Error: Test error');
    });

    it('should format validation errors', () => {
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['name'],
          message: 'Expected string, received number',
        },
      ]);

      const response = formatIpcError(zodError, 'test:channel');

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe('VALIDATION_ERROR');
      expect(response.error?.details?.issues).toBeDefined();
      expect(response.error?.details?.issues.length).toBeGreaterThan(0);
    });

    it('should handle errors without channel', () => {
      const error = new Error('Test');
      const response = formatIpcError(error);

      expect(response.success).toBe(false);
      expect(response.error?.message).toBe('Test');
    });
  });

  describe('Error Code Mapping', () => {
    it('should map custom error types', () => {
      class NotFoundError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'NotFoundError';
        }
      }

      const error = new NotFoundError('Resource not found');
      const response = formatIpcError(error);

      expect(response.error?.code).toBe('NOT_FOUND');
    });

    it('should default to INTERNAL_ERROR for unknown types', () => {
      const error = new Error('Unknown');
      const response = formatIpcError(error);

      expect(response.error?.code).toBe('INTERNAL_ERROR');
    });
  });
});

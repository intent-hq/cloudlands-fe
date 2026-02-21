import { describe, expect, it } from 'vitest';

import {
  shouldSuppressMonacoConsoleError,
  shouldSuppressMonacoUnhandledRejection,
} from './monaco-error-suppression';

describe('monaco-error-suppression', () => {
  it('suppresses nested Canceled unhandled rejections', () => {
    expect(
      shouldSuppressMonacoUnhandledRejection({ error: { name: 'Canceled', message: 'Canceled' } }),
    ).toBe(true);
  });

  it('does not suppress unrelated unhandled rejections', () => {
    expect(shouldSuppressMonacoUnhandledRejection({ error: { message: 'Boom' } })).toBe(false);
  });

  it('suppresses inmemory TS worker rejection even when wrapped', () => {
    expect(
      shouldSuppressMonacoUnhandledRejection({
        error: { message: 'Could not find source file inmemory://model.ts' },
      }),
    ).toBe(true);
  });

  it('suppresses console.error when message is in a nested error object', () => {
    expect(
      shouldSuppressMonacoConsoleError([
        '[ERROR] [ErrorBoundary] Caught unhandled rejection:',
        { error: { message: 'Canceled' } },
      ]),
    ).toBe(true);
  });

  describe('TextMate grammar tokenization errors', () => {
    it('suppresses "trying to pop an empty stack" console errors', () => {
      expect(
        shouldSuppressMonacoConsoleError([
          'Error: ruby: trying to pop an empty stack in rule: (unknown)',
        ]),
      ).toBe(true);
    });

    it('suppresses "trying to pop an empty stack" unhandled rejections', () => {
      expect(
        shouldSuppressMonacoUnhandledRejection({
          message: 'ruby: trying to pop an empty stack in rule: (unknown)',
        }),
      ).toBe(true);
    });

    it('suppresses wrapped "trying to pop an empty stack" errors', () => {
      expect(
        shouldSuppressMonacoConsoleError([
          '[Monaco]',
          { error: { message: 'trying to pop an empty stack in rule: test' } },
        ]),
      ).toBe(true);
    });
  });

  describe('no diff result available error', () => {
    it('suppresses "no diff result available" console.error', () => {
      expect(shouldSuppressMonacoConsoleError(['Error: no diff result available'])).toBe(true);
    });

    it('suppresses "no diff result available" when message is in Error object', () => {
      const error = new Error('no diff result available');
      expect(shouldSuppressMonacoConsoleError([error])).toBe(true);
    });

    it('suppresses "no diff result available" unhandled rejection', () => {
      expect(
        shouldSuppressMonacoUnhandledRejection({ message: 'no diff result available' }),
      ).toBe(true);
    });

    it('suppresses "no diff result available" when wrapped in error object', () => {
      expect(
        shouldSuppressMonacoUnhandledRejection({
          error: { message: 'no diff result available' },
        }),
      ).toBe(true);
    });

    it('suppresses "no diff result available" Error instance rejection', () => {
      expect(
        shouldSuppressMonacoUnhandledRejection(new Error('no diff result available')),
      ).toBe(true);
    });
  });

  describe('isInHiddenArea error', () => {
    it('suppresses "isInHiddenArea" console.error', () => {
      expect(
        shouldSuppressMonacoConsoleError([
          "TypeError: Cannot read properties of undefined (reading 'isInHiddenArea')",
        ]),
      ).toBe(true);
    });

    it('suppresses "isInHiddenArea" when message is in Error object', () => {
      const error = new TypeError(
        "Cannot read properties of undefined (reading 'isInHiddenArea')",
      );
      expect(shouldSuppressMonacoConsoleError([error])).toBe(true);
    });

    it('suppresses "isInHiddenArea" unhandled rejection', () => {
      expect(
        shouldSuppressMonacoUnhandledRejection({
          message: "Cannot read properties of undefined (reading 'isInHiddenArea')",
        }),
      ).toBe(true);
    });

    it('suppresses "isInHiddenArea" when wrapped in error object', () => {
      expect(
        shouldSuppressMonacoUnhandledRejection({
          error: { message: "Cannot read properties of undefined (reading 'isInHiddenArea')" },
        }),
      ).toBe(true);
    });

    it('suppresses "isInHiddenArea" Error instance rejection', () => {
      expect(
        shouldSuppressMonacoUnhandledRejection(
          new TypeError("Cannot read properties of undefined (reading 'isInHiddenArea')"),
        ),
      ).toBe(true);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { classifyBenignError } from './benign-error-classification';

function errorWithStack(message: string, stack: string): Error {
  const error = new Error(message);
  error.stack = stack;
  return error;
}

describe('classifyBenignError', () => {
  describe('svelte-effect-depth', () => {
    it('matches the Svelte error code in a message or an ErrorEvent-like shape', () => {
      expect(classifyBenignError(new Error('effect_update_depth_exceeded'))).toBe(
        'svelte-effect-depth',
      );
      expect(
        classifyBenignError({
          message: 'Uncaught https://svelte.dev/e/effect_update_depth_exceeded',
          error: undefined,
        }),
      ).toBe('svelte-effect-depth');
    });

    it('matches the human message and the name / code probes the boundary used to check', () => {
      expect(classifyBenignError('Maximum update depth exceeded')).toBe('svelte-effect-depth');
      expect(classifyBenignError({ message: 'x', name: 'effect_update_depth_exceeded' })).toBe(
        'svelte-effect-depth',
      );
      expect(classifyBenignError({ message: 'x', code: 'effect_update_depth_exceeded' })).toBe(
        'svelte-effect-depth',
      );
    });
  });

  it('classifies ResizeObserver loop warnings', () => {
    expect(
      classifyBenignError(
        new Error('ResizeObserver loop completed with undelivered notifications'),
      ),
    ).toBe('resize-observer');
  });

  describe('monaco', () => {
    it('classifies Canceled as an Error, a bare string reason, a name-only shape and a string dump', () => {
      const canceled = new Error('Canceled');
      canceled.name = 'Canceled';
      expect(classifyBenignError(canceled)).toBe('monaco');
      expect(classifyBenignError('Canceled')).toBe('monaco');
      expect(classifyBenignError({ name: 'Canceled', message: 'operation aborted' })).toBe(
        'monaco',
      );
      expect(classifyBenignError('Canceled: Canceled')).toBe('monaco');
    });

    it('classifies the ViewZones isInHiddenArea race and inmemory TS worker lookups', () => {
      expect(
        classifyBenignError(
          new Error("Cannot read properties of undefined (reading 'isInHiddenArea')"),
        ),
      ).toBe('monaco');
      expect(
        classifyBenignError(new Error("Could not find source file: 'inmemory://model/3'.")),
      ).toBe('monaco');
    });

    it('matches isInHiddenArea on the ErrorEvent message even when the nested error differs', () => {
      expect(
        classifyBenignError({
          message: 'Uncaught TypeError: isInHiddenArea',
          error: new Error('opaque error'),
        }),
      ).toBe('monaco');
      expect(
        classifyBenignError({
          message: 'Uncaught TypeError: something else',
          error: new Error('opaque error'),
        }),
      ).toBeNull();
    });

    it('matches wrapper shapes whose message and nested error each carry part of a rule', () => {
      expect(
        classifyBenignError({
          message: 'TextModel got disposed',
          error: new Error('opaque error'),
        }),
      ).toBe('monaco');
      expect(
        classifyBenignError({
          message: 'Could not find source file',
          error: new Error('inmemory://model/3'),
        }),
      ).toBe('monaco');
      expect(
        classifyBenignError({
          message: 'Could not find source file',
          error: new Error('file:///tmp/model.ts'),
        }),
      ).toBeNull();
    });

    it('classifies disposal noise handled by the Monaco util', () => {
      expect(
        classifyBenignError({
          message: 'TextModel got disposed before DiffEditorWidget model got reset',
        }),
      ).toBe('monaco');
    });
  });

  describe('webview-stale-guest', () => {
    it('classifies the exact stale-guest detach error in every input shape', () => {
      expect(classifyBenignError(new Error('Invalid guestInstanceId: 3'))).toBe(
        'webview-stale-guest',
      );
      expect(classifyBenignError('Invalid guestInstanceId: 3')).toBe('webview-stale-guest');
      expect(
        classifyBenignError({
          message: 'Uncaught Error: Invalid guestInstanceId: 3',
          error: new Error('Invalid guestInstanceId: 3'),
        }),
      ).toBe('webview-stale-guest');
    });

    it('does not classify a message that merely embeds the stale-guest pattern', () => {
      expect(
        classifyBenignError(new Error('Failed: Invalid guestInstanceId: 12 during attach')),
      ).toBe(null);
      expect(classifyBenignError(new Error('Access denied to guestInstanceId: 12'))).toBeNull();
    });
  });

  describe('bits-ui-cleanup', () => {
    it('classifies a bits-ui stack frame, the .current shape and the minified snippet call', () => {
      expect(
        classifyBenignError(
          errorWithStack(
            'handler is not a function',
            'TypeError\n at node_modules/bits-ui/dist/x.js:1:1',
          ),
        ),
      ).toBe('bits-ui-cleanup');
      expect(classifyBenignError(new Error('this.state.current is not a function'))).toBe(
        'bits-ui-cleanup',
      );
      expect(classifyBenignError(new Error('n.call is not a function'))).toBe('bits-ui-cleanup');
    });

    it('does not classify "is not a function" without a bits-ui signature', () => {
      expect(
        classifyBenignError(
          errorWithStack('foo.bar is not a function', 'TypeError\n at src/app.ts:1:1'),
        ),
      ).toBeNull();
      expect(classifyBenignError(new Error('someLongName.call is not a function'))).toBeNull();
    });
  });

  describe('svelte-transition-reset', () => {
    it('requires both the reset message and a transitions stack frame', () => {
      const message = "Cannot read properties of undefined (reading 'reset')";
      expect(
        classifyBenignError(
          errorWithStack(
            message,
            'TypeError\n at svelte/src/internal/client/dom/elements/transitions.js:1:1',
          ),
        ),
      ).toBe('svelte-transition-reset');
      expect(
        classifyBenignError(errorWithStack(message, 'TypeError\n at src/app.ts:1:1')),
      ).toBeNull();
    });
  });

  it('returns null for unrelated errors and empty inputs', () => {
    expect(classifyBenignError(new Error('boom'))).toBeNull();
    expect(classifyBenignError('Something else went wrong')).toBeNull();
    expect(
      classifyBenignError({ message: 'Uncaught Error: boom', error: new Error('boom') }),
    ).toBeNull();
    expect(classifyBenignError(null)).toBeNull();
    expect(classifyBenignError(undefined)).toBeNull();
    expect(classifyBenignError(42)).toBeNull();
    expect(classifyBenignError({})).toBeNull();
  });
});

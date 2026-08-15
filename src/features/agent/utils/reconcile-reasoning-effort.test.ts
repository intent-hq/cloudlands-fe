import { describe, expect, it } from 'vitest';

import { reconcileReasoningEffort } from './reconcile-reasoning-effort';

describe('reconcileReasoningEffort', () => {
  it('keeps the current effort when the new model advertises it', () => {
    expect(reconcileReasoningEffort('high', ['low', 'high', 'max'])).toBe('high');
  });

  it('selects the nearest canonical effort when the current one is unsupported', () => {
    expect(reconcileReasoningEffort('xhigh', ['low', 'high'])).toBe('high');
    expect(reconcileReasoningEffort('low', ['minimal', 'medium'])).toBe('minimal');
  });

  it('clears to the provider default when no canonical fallback is advertised', () => {
    expect(reconcileReasoningEffort('high', undefined)).toBeNull();
    expect(reconcileReasoningEffort('ultra', ['low', 'medium'])).toBeNull();
    expect(reconcileReasoningEffort('high', ['custom'])).toBeNull();
  });
});
